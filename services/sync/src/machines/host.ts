/** The host behind `Machine` (docs/online-terminal.md, 6.1): Cloudflare Containers,
 *  through the Durable Object's own `ctx.container`.
 *
 *  Sandbox SDK 1.0 (pinned in package.json) moved starting and stopping a container
 *  into the application's own Durable Object, and keeps for itself only the file
 *  helpers and the R2 directory backups. So the container is `Machine`'s own, and this
 *  file is the one place that touches it; the backups are the one piece of the SDK,
 *  handed in by the machines' entry (entry.ts), because the SDK imports
 *  `cloudflare:workers`, which neither the main deploy nor the tests can load.
 *
 *  What is not provable without Cloudflare: that `nibd` answers on its port within the
 *  link's tries, that a snapshot restores, and the per-instance CA. See
 *  docs/online-terminal-live.md. */

import type { Env } from '../types'
import type { MachineHost } from '@nib/online'

/** The port `nibd` listens on in the machine, and the path its link answers. */
const NIBD_PORT = 7680
const LINK_URL = 'http://nibd/link'

/** How long the container waits with nobody's request after `Machine` goes quiet.
 *  `Machine` decides sleep itself on its minute alarm; this is only the backstop for an
 *  object that died without saying so (4.4). */
const BACKSTOP = 20 * 60 * 1000

/** How long the link waits for `nibd` to answer after a start: a cold start is 1-3 s. */
const LINK_TRIES = 40
const LINK_WAIT = 250

/** The small machine as an instance: ½ vCPU, 2 GiB, an 8 GB disk (decision 3). */
const SMALL_INSTANCE = { vcpu: 0.5, memoryMib: 2048, diskMb: 8000 }

/** Where a machine's link secret is kept across an object restart. */
export const SECRET = 'secret'

/** The SDK's directory backups, as the host needs them; see entry.ts. */
export interface Backups {
  /** Routes the container's backup traffic to the gateway; before any other intercept. */
  intercept(): Promise<void>
  /** Answers the backup's record, serialised. */
  backup(dir: string, name: string): Promise<string>
  restore(record: string): Promise<void>
}

type MakeBackups = (container: Container, ctx: DurableObjectState, env: Env) => Backups

/** How HTTP and HTTPS leave a machine; see `egressOf`. */
type Egress = 'open' | 'web'

/** What the entry hands the host: the backups, and the outbound gateway for `web`. */
export interface Wiring {
  backups: MakeBackups
  outbound: (ctx: DurableObjectState) => Fetcher
}

let wiring: Wiring | null = null

/** Set once, by entry.ts, as the module loads. */
export function wire(given: Wiring): void {
  wiring = given
}

/** How a machine's traffic leaves it (4.8).
 *
 *  `web`: the internet off, so nothing leaves but HTTP and HTTPS, and those go through
 *  nib's outbound gateway (entry.ts), which refuses private and metadata addresses and
 *  forwards the rest. With Sandbox SDK 1.0 that gateway is the only way HTTPS leaves a
 *  container whose internet is off, and it holds the cleartext while it forwards it -
 *  which is what 4.8's rule forbids for the AI providers' traffic.
 *
 *  `open`: the internet on and no handler at all, so no code of nib's ever sees a
 *  byte; nothing but Cloudflare's own figures meter it, and other ports are open.
 *
 *  The design's rule is "never the other way round", so `open` is the default and
 *  `web` is one variable away; which to run is Emil's call at going live. */
function egressOf(env: Env): Egress {
  return env.MACHINE_EGRESS === 'web' ? 'web' : 'open'
}

/** The host over `ctx.container`. Ids are the object's own: one container per object. */
export class ContainerHost implements MachineHost {
  /** A snapshot to boot the next start from, set by `restore`. */
  private boot: string | null = null
  private backups: Backups | null = null

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  private get container(): Container {
    const container = this.ctx.container
    if (!container) throw new Error('this object has no container bound')
    return container
  }

  private backupsOf(): Backups {
    if (!wiring) throw new Error('the machines entry did not wire the backups')
    this.backups ??= wiring.backups(this.container, this.ctx, this.env)
    return this.backups
  }

  async start(id: string, image: string, env: Record<string, string>): Promise<void> {
    const container = this.container
    if (!container.running) {
      const egress = egressOf(this.env)
      const common = {
        instance: SMALL_INSTANCE,
        enableInternet: egress === 'open',
        env,
        labels: { machine: id.slice(0, 64) },
      }
      const snapshot = this.boot
      this.boot = null
      if (snapshot) container.start({ ...common, containerSnapshot: { id: snapshot } })
      else container.start({ ...common, image: container.images[image] ?? image })
    }

    try {
      // The backups' intercept first: an intercept registered after the catch-all
      // never receives anything.
      await this.backupsOf().intercept()
      if (egressOf(this.env) === 'web' && wiring) {
        const outbound = wiring.outbound(this.ctx)
        await container.interceptAllOutboundHttp(outbound)
        await container.interceptOutboundHttps('*', outbound)
      }
      await container.setInactivityTimeout(BACKSTOP)
    } catch (error) {
      await container.destroy()
      throw error
    }
  }

  async stop(_id: string, grace: number): Promise<void> {
    const container = this.container
    // Read afresh each time: `running` is the runtime's, and changes under us.
    const running = () => container.running
    if (!running()) return
    container.signal(15)
    const until = Date.now() + grace
    while (running() && Date.now() < until) await wait(LINK_WAIT)
    if (running()) await container.destroy('stopped')
  }

  async link(_id: string): Promise<WebSocket> {
    const secret = await this.ctx.storage.get<string>(SECRET)
    let last: unknown = null
    for (let tried = 0; tried < LINK_TRIES; tried++) {
      try {
        const answer = await this.container.getTcpPort(NIBD_PORT).fetch(LINK_URL, {
          headers: { upgrade: 'websocket', authorization: `Bearer ${secret ?? ''}` },
        })
        const socket = answer.webSocket
        if (socket) {
          socket.accept()
          return socket
        }
        last = new Error(`nibd answered ${String(answer.status)}`)
      } catch (error) {
        last = error
      }
      await wait(LINK_WAIT)
    }
    throw last instanceof Error ? last : new Error('nibd did not answer')
  }

  async snapshot(id: string): Promise<string> {
    const made = await this.container.snapshotContainer({ name: id.slice(0, 64) })
    return made.id
  }

  backup(id: string, dir: string): Promise<string> {
    return this.backupsOf().backup(dir, id)
  }

  async restore(_id: string, from: { snapshot?: string; backup?: string }): Promise<void> {
    if (from.snapshot) this.boot = from.snapshot
    if (from.backup) await this.backupsOf().restore(from.backup)
  }

  /** The runtime gives a Durable Object no per-instance CPU or egress figures, so the
   *  meter counts from what `nibd` reports; see `Machine`. */
  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }
}

/** A machine that is a `nibd` already running on this computer, for an end-to-end drive
 *  under `wrangler dev` with no container at all.
 *
 *  Chosen by `MACHINE_DEV_NIBD` (its address, `http://127.0.0.1:<port>`) and
 *  `MACHINE_DEV_SECRET` (the secret that `nibd` was started with), which only a
 *  `.dev.vars` sets; an address that is not this computer's is refused, so a deployed
 *  Worker can never be pointed at one. Starting, stopping and saving are nothing here:
 *  the `nibd` is the drive's, and so is its home. */
export class DevHost implements MachineHost {
  constructor(
    private readonly address: string,
    private readonly secret: string,
  ) {}

  /** The dev host, if the environment asks for one and it is this computer's. */
  static of(env: Env): DevHost | null {
    const address = env.MACHINE_DEV_NIBD
    if (!address) return null
    const host = new URL(address).hostname
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') return null
    return new DevHost(address, env.MACHINE_DEV_SECRET ?? '')
  }

  start(): Promise<void> {
    return Promise.resolve()
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  async link(): Promise<WebSocket> {
    const answer = await fetch(new URL('/link', this.address), {
      headers: { upgrade: 'websocket', authorization: `Bearer ${this.secret}` },
    })
    const socket = answer.webSocket
    if (!socket) throw new Error(`nibd answered ${String(answer.status)}`)
    socket.accept()
    return socket
  }

  snapshot(): Promise<string> {
    return Promise.resolve('dev')
  }

  backup(): Promise<string> {
    return Promise.reject(new Error('a dev machine keeps no backups'))
  }

  restore(): Promise<void> {
    return Promise.resolve()
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
