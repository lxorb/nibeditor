/** A machine on a Hetzner server of its own (docs/online-terminal.md 4.15): a CX43 (8
 *  vCPU, 16 GB, 160 GB), always on, in Nuremberg or else Falkenstein, reached only
 *  through a Cloudflare Tunnel.
 *
 *  `start` makes what is missing and nothing else, so it is safe to ask again at any
 *  point: the tunnel and its hostname, then the server - found by its label
 *  `nib-machine=<id>`, made only where there is none, after the budget breaker says the
 *  month's fixed costs may grow by its price. A made server sets itself up from its
 *  cloud-init (cloudinit.ts) for a few minutes; `Machine` waits for `nibd` on its alarm
 *  meanwhile. There is no sleep, snapshot, backup or restore: the disk is a disk.
 *
 *  The link is a WebSocket to `https://m-<id>.nibeditor.com/link`: Cloudflare's edge lets
 *  it through only with the Access service token (where Access is set up), `cloudflared`
 *  on the server checks the same, and `nibd` takes it only with the machine's secret. */

import type { Env } from '../types'
import type { MachineHost } from '@nib/online'
import type { Refusal } from '@nib/online/wire'
import { bundleSha } from './bundle'
import { cloudInit, sshKeyOf } from './cloudinit'
import { Hetzner, HetznerError, type ServerType } from './hetzner'
import { type Access, Tunnels } from './tunnel'

/** The server type, and where it is made, nearest Zurich first: Nuremberg answered a
 *  connection in 16.6 ms from ETH Zurich and Falkenstein in 18.4 ms (2026-10-06). */
const SERVER_TYPE = 'cx43'
const LOCATIONS = ['nbg1', 'fsn1']

/** The label every Hetzner resource of a machine carries. */
const LABEL = 'nib-machine'

/** What Hetzner answers where a type cannot be had in a location just now. */
const UNAVAILABLE = new Set([
  'resource_unavailable',
  'placement_error',
  'unavailable',
  'resource_limit_exceeded',
])

/** How often, and how far apart, a link is tried: once the server answers at all it
 *  answers at once, and `Machine` tries again on its alarm while it is being set up. */
const LINK_TRIES = 3
const LINK_WAIT = 1000

/** Where a machine's link secret is kept: `Machine`'s storage, under its own key. */
const SECRET = 'secret'

/** A start the host refuses for a reason the person is told: the budget, so far. */
export class HostRefused extends Error {
  constructor(readonly refusal: Refusal) {
    super(`refused: ${refusal}`)
    this.name = 'HostRefused'
  }
}

/** What the Worker needs for Hetzner machines, by the names the manager sets them under;
 *  the ones missing, for the admin route and for a start's refusal. */
export function hetznerMissing(env: Env): string[] {
  const needed: [string, string | undefined][] = [
    ['HETZNER_TOKEN', env.HETZNER_TOKEN],
    ['MACHINE_TUNNEL_TOKEN', env.MACHINE_TUNNEL_TOKEN],
    ['CF_ACCOUNT_ID', env.CF_ACCOUNT_ID],
    ['CF_ZONE_ID', env.CF_ZONE_ID],
  ]
  return needed.filter(([, value]) => !value).map(([name]) => name)
}

/** Whether the budget allows a new fixed cost of `monthly` in `currency` a month. */
export type MayCost = (monthly: number, currency: string) => Promise<boolean>

/** Everything the host talks to, made from the environment or handed in by a test. */
export interface Setup {
  hetzner: Hetzner
  tunnels: Tunnels
  /** The Access service token the link is sent with, where Access is set up. */
  service: { id: string; secret: string } | null
  /** What `cloudflared` checks the Access token against, where it is set up. */
  access: Access | null
  /** The zone the machines' hostnames are in, and the origin the bundle comes from. */
  domain: string
  origin: string
  mayCost: MayCost
  fetcher: typeof fetch
}

export function setupOf(env: Env, mayCost: MayCost): Setup | null {
  if (hetznerMissing(env).length) return null
  const origin = new URL(env.APP_ORIGIN).origin
  return {
    hetzner: new Hetzner(env.HETZNER_TOKEN ?? ''),
    tunnels: new Tunnels(
      env.MACHINE_TUNNEL_TOKEN ?? '',
      env.CF_ACCOUNT_ID ?? '',
      env.CF_ZONE_ID ?? '',
    ),
    service:
      env.MACHINE_ACCESS_ID && env.MACHINE_ACCESS_SECRET
        ? { id: env.MACHINE_ACCESS_ID, secret: env.MACHINE_ACCESS_SECRET }
        : null,
    access:
      env.MACHINE_ACCESS_TEAM && env.MACHINE_ACCESS_AUD
        ? { team: env.MACHINE_ACCESS_TEAM, aud: env.MACHINE_ACCESS_AUD }
        : null,
    domain: new URL(origin).hostname,
    origin,
    mayCost,
    fetcher: (input, init) => fetch(input, init),
  }
}

/** A machine's names: its hostname, its server's and its tunnel's. */
export function namesOf(id: string, domain: string) {
  const slug = id
    .replace(/^m_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40)
  return {
    hostname: `m-${slug}.${domain}`,
    server: `nib-${slug}`,
    tunnel: `nib-machine-${slug}`,
  }
}

/** Whether a hostname is a machine's own (`namesOf`), under the app's domain. */
export function isMachineHost(hostname: string, origin: string): boolean {
  const domain = new URL(origin).hostname.replaceAll('.', '\\.')
  return new RegExp(`^m-[0-9a-f]{32}\\.${domain}$`).test(hostname.toLowerCase())
}

/** The firewall's inbound rules: none at all, which lets nothing in, or SSH alone while
 *  the owner's emergency key is set. Outbound is left open (no outbound rule). */
export function firewallRules(ssh: boolean): unknown[] {
  return ssh
    ? [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '22',
          source_ips: ['0.0.0.0/0', '::/0'],
          description: 'the owner’s emergency SSH key',
        },
      ]
    : []
}

interface Row {
  ssh_key: string | null
}

export class HetznerHost implements MachineHost {
  readonly alwaysOn = true

  constructor(
    private readonly env: Env,
    private readonly storage: Pick<DurableObjectStorage, 'get'>,
    private readonly setup: Setup | null,
  ) {}

  private need(): Setup {
    if (this.setup) return this.setup
    throw new Error(
      `Hetzner machines are not set up: ${hetznerMissing(this.env).join(', ')} missing`,
    )
  }

  private names(id: string) {
    return namesOf(id, this.need().domain)
  }

  async start(id: string, _image: string, env: Record<string, string>): Promise<void> {
    const setup = this.need()
    const names = this.names(id)

    // The way in first, so a server that comes up finds its tunnel waiting.
    const tunnel = await setup.tunnels.tunnel(names.tunnel)
    await setup.tunnels.route(tunnel, names.hostname, setup.access)
    await setup.tunnels.hostname(names.hostname, tunnel)

    const found = await setup.hetzner.serverLabelled(LABEL, id)
    if (found) {
      if (found.status === 'off') await setup.hetzner.powerOn(found.id)
      await this.record(id, {
        server_id: found.id,
        server_status: found.status === 'off' ? 'starting' : found.status,
      })
      return
    }

    const secret = env.NIBD_SECRET
    const bundle = await bundleSha()
    if (!secret) throw new Error('no link secret for the new server')
    if (!bundle) throw new Error('this Worker carries no machine bundle')

    const row = await this.env.DB.prepare('select ssh_key from machines where id = ?')
      .bind(id)
      .first<Row>()
    const sshKey = row?.ssh_key ? sshKeyOf(row.ssh_key) : null

    const type = await setup.hetzner.serverType(SERVER_TYPE)
    const places = LOCATIONS.filter((one) => !type.available.length || type.available.includes(one))
    const first = places[0]
    if (!first)
      throw new HetznerError(
        503,
        'resource_unavailable',
        `no ${SERVER_TYPE} to be had in ${LOCATIONS.join(' or ')}`,
      )
    const { monthly: ipv4, currency } = await setup.hetzner.ipv4(first)
    if (!(await setup.mayCost(priceIn(type, first) + ipv4, currency)))
      throw new HostRefused('budget')

    const firewall =
      (await setup.hetzner.firewallLabelled(LABEL, id)) ??
      (await setup.hetzner.createFirewall(
        names.server,
        { [LABEL]: id },
        firewallRules(sshKey !== null),
      ))
    const userData = cloudInit({
      secret,
      tunnel: await setup.tunnels.tokenOf(tunnel),
      zone: env.TZ ?? 'UTC',
      origin: setup.origin,
      bundle,
      sshKey,
    })

    let last: unknown = null
    for (const location of places) {
      try {
        const made = await setup.hetzner.createServer({
          name: names.server,
          serverType: SERVER_TYPE,
          location,
          userData,
          labels: { [LABEL]: id },
          firewall,
        })
        const ip = location === first ? ipv4 : (await setup.hetzner.ipv4(location)).monthly
        await this.record(id, {
          server_id: made.id,
          server_status: made.status,
          region: made.location || location,
          size: SERVER_TYPE,
          spec: JSON.stringify({ cores: type.cores, memory: type.memory, disk: type.disk }),
          price_month: Math.round((priceIn(type, location) + ip) * 100) / 100,
          price_currency: currency,
        })
        return
      } catch (error) {
        if (!(error instanceof HetznerError) || !UNAVAILABLE.has(error.code)) throw error
        last = error
      }
    }
    throw last instanceof Error ? last : new Error(`no ${SERVER_TYPE} could be made`)
  }

  /** What the row says about the server, as the API last said it. */
  private async record(id: string, fields: Record<string, string | number>): Promise<void> {
    const entries = Object.entries(fields)
    const sets = entries.map(([key], at) => `${key} = ?${String(at + 2)}`).join(', ')
    await this.env.DB.prepare(`update machines set ${sets} where id = ?1`)
      .bind(id, ...entries.map(([, value]) => value))
      .run()
  }

  /** Always on: there is nothing to stop. A machine is ended by `remove`. */
  stop(): Promise<void> {
    return Promise.resolve()
  }

  async running(id: string): Promise<boolean> {
    if (!this.setup) return false
    const server = await this.setup.hetzner.serverLabelled(LABEL, id)
    return server?.status === 'running'
  }

  async link(id: string): Promise<WebSocket> {
    const setup = this.need()
    const secret = await this.storage.get<string>(SECRET)
    const url = `https://${this.names(id).hostname}/link`
    const headers: Record<string, string> = {
      upgrade: 'websocket',
      authorization: `Bearer ${secret ?? ''}`,
    }
    if (setup.service) {
      headers['cf-access-client-id'] = setup.service.id
      headers['cf-access-client-secret'] = setup.service.secret
    }
    let last: unknown = null
    for (let tried = 0; tried < LINK_TRIES; tried++) {
      if (tried) await wait(LINK_WAIT)
      try {
        const answer = await setup.fetcher(url, { headers })
        const socket = answer.webSocket
        if (socket) {
          socket.accept()
          return socket
        }
        last = new Error(`nibd answered ${String(answer.status)}`)
        // Refused for good: a wrong secret or token is not cured by asking again.
        if (answer.status === 401 || answer.status === 403) break
      } catch (error) {
        last = error
      }
    }
    throw last instanceof Error ? last : new Error('nibd did not answer')
  }

  snapshot(): Promise<string> {
    return Promise.reject(new Error('a machine that is always on keeps its own disk'))
  }

  backup(): Promise<string> {
    return Promise.reject(new Error('a machine that is always on keeps its own disk'))
  }

  restore(): Promise<void> {
    return Promise.resolve()
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }

  /** A hard power cycle, through the API: the server answers nothing, so nothing on it
   *  can be asked to restart. */
  async reboot(id: string): Promise<void> {
    const setup = this.need()
    const server = await setup.hetzner.serverLabelled(LABEL, id)
    if (!server) throw new Error('the machine has no server')
    await setup.hetzner.reset(server.id)
    await this.record(id, { server_status: 'starting' })
  }

  /** The server, its firewall, its tunnel and its hostname, deleted; whichever is gone
   *  already is skipped, so this finishes what an earlier try began. A Worker never set
   *  up for Hetzner made none of them. */
  async remove(id: string): Promise<void> {
    if (!this.setup) return
    const { hetzner, tunnels } = this.setup
    const names = this.names(id)
    const server = await hetzner.serverLabelled(LABEL, id)
    if (server) await hetzner.deleteServer(server.id)
    const firewall = await hetzner.firewallLabelled(LABEL, id)
    if (firewall !== null) await deleteWhenFree(hetzner, firewall)
    await tunnels.remove(names.tunnel, names.hostname)
  }
}

/** The server type's monthly price in a location, with VAT. */
function priceIn(type: ServerType, location: string): number {
  return type.prices.find((one) => one.location === location)?.monthly ?? 0
}

/** A firewall is still in use for the moment its server takes to go: asked again a few
 *  times, and left for the next sweep if it is still held. */
async function deleteWhenFree(hetzner: Hetzner, id: number): Promise<void> {
  for (let tried = 0; ; tried++) {
    try {
      await hetzner.deleteFirewall(id)
      return
    } catch (error) {
      const busy = error instanceof HetznerError && error.code === 'resource_in_use'
      if (!busy || tried >= 4) throw error
      await wait(2000)
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
