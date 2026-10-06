/** A machine, driven without Cloudflare under it: a fake host, a link that keeps what
 *  was sent down it, sockets that keep what was said to them, and a namespace that
 *  makes one real `Machine` per id. The state is the hub's stand-in (hub-fakes.ts), the
 *  clock Vitest's. */

import type { MachineHost } from '@nib/online'
import { linkFrame, type MachineFrame, type NibdFrame } from '@nib/online/wire'
import { unframe } from '@nib/sync-core/wire'
import { Machine, type Viewer } from '../src/machines/machine'
import type { Env } from '../src/types'
import { HubState } from './hub-fakes'

/** The link to `nibd`: what `Machine` sent down it, and a way to close it. A ping is
 *  answered with a pong, as `nibd` answers it, until the link is made `silent`: a
 *  `nibd` that froze, or a connection half open. */
class FakeLink {
  readonly sent: MachineFrame[] = []
  /** What `nibd` answers a `sleep` with, as it does: every screen saved. */
  onSleep: (() => void) | null = null
  silent = false
  closed = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  send(bytes: Uint8Array) {
    const frame = unframe(bytes) as MachineFrame
    this.sent.push(frame)
    if (frame.t === 'sleep') queueMicrotask(() => this.onSleep?.())
    if (frame.t === 'ping' && !this.silent) queueMicrotask(() => this.say({ t: 'pong' }))
  }

  /** A frame from `nibd`, as the runtime hands a link's message over. */
  say(frame: NibdFrame) {
    const bytes = linkFrame(frame)
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    for (const one of this.listeners.get('message') ?? []) one({ data })
  }

  addEventListener(kind: string, listener: (event: unknown) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener])
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const one of this.listeners.get('close') ?? []) one({})
  }

  take(): MachineFrame[] {
    return this.sent.splice(0, this.sent.length)
  }
}

/** The host: what it was asked, in order, and the link it handed out. */
class FakeHost implements MachineHost {
  readonly calls: string[] = []
  /** Whether an instance runs. */
  up = false
  link_: FakeLink | null = null
  onSleep: (() => void) | null = null
  snapshots = 0
  backups = 0
  /** Set to make the next start throw. */
  failStart = false
  /** How many of the next links fail. */
  failLinks = 0
  /** What the next backup throws, if anything. */
  failBackup: Error | null = null
  /** Set to make a restore from a backup never answer. */
  hangRestore = false

  start(_id: string, image: string): Promise<void> {
    this.calls.push(`start ${image}`)
    if (this.failStart) {
      this.failStart = false
      return Promise.reject(new Error('no room'))
    }
    this.up = true
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.calls.push('stop')
    this.up = false
    return Promise.resolve()
  }

  running(): Promise<boolean> {
    return Promise.resolve(this.up)
  }

  link(): Promise<WebSocket> {
    this.calls.push('link')
    if (this.failLinks > 0) {
      this.failLinks -= 1
      return Promise.reject(new Error('nibd answered 401'))
    }
    this.link_ = new FakeLink()
    this.link_.onSleep = this.onSleep
    return Promise.resolve(this.link_ as unknown as WebSocket)
  }

  snapshot(): Promise<string> {
    this.calls.push('snapshot')
    return Promise.resolve(`snap-${String(++this.snapshots)}`)
  }

  backup(_id: string, dir: string): Promise<string> {
    this.calls.push(`backup ${dir}`)
    const failure = this.failBackup
    this.failBackup = null
    if (failure) return Promise.reject(failure)
    const id = `backup-${String(++this.backups)}`
    return Promise.resolve(JSON.stringify({ id, key: `${id}.tar.zst` }))
  }

  restore(_id: string, from: { snapshot?: string; backup?: string }): Promise<void> {
    this.calls.push(
      from.snapshot ? `restore snapshot ${from.snapshot}` : `restore backup ${from.backup ?? ''}`,
    )
    if (from.backup && this.hangRestore) return new Promise<void>(() => undefined)
    return Promise.resolve()
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }
}

/** A person's socket: the text frames said to it, parsed, and the binary ones. */
export class MachineSocket {
  readonly said: { t: string; [key: string]: unknown }[] = []
  readonly bytes: Uint8Array[] = []
  readyState = 1
  closedWith: { code: number | undefined; reason: string | undefined } | null = null
  readonly tags: string[] = []
  private attachment: unknown = null

  send(data: string | Uint8Array) {
    if (typeof data === 'string') this.said.push(JSON.parse(data) as { t: string })
    else this.bytes.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closedWith = { code, reason }
  }

  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value)
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment)
  }

  /** The text frames of one kind said so far. */
  of(t: string) {
    return this.said.filter((one) => one.t === t)
  }
}

export interface Running {
  machine: Machine
  state: HubState
  host: FakeHost
}

/** A machine named `id` for `user`, told who it is the way a route tells it. */
export async function machine(env: Env, id: string, user: string): Promise<Running> {
  const state = new HubState()
  const host = new FakeHost()
  const made = new Machine(state as unknown as DurableObjectState, env, host)
  host.onSleep = () => void made.fromNibd({ t: 'saved' })
  await made.fetch(
    new Request('https://machine.invalid/state', {
      headers: { 'x-nib-machine': 'state', 'x-nib-id': id, 'x-nib-user': user },
    }),
  )
  return { machine: made, state, host }
}

/** A socket let in the way the door lets it in. */
export async function join(
  running: Running,
  viewer: Partial<Viewer> & { who: string },
  wake = 'no',
): Promise<MachineSocket> {
  const socket = new MachineSocket()
  await running.machine.enter(
    socket as unknown as WebSocket,
    {
      device: `device-${viewer.who}`,
      term: 'term-1',
      session: 'session-1',
      guest: false,
      role: 'read',
      owns: false,
      typing: 'owner',
      cols: 80,
      rows: 24,
      seen: Date.now(),
      ...viewer,
    },
    wake,
  )
  return socket
}

/** A frame from the app. */
export async function say(running: Running, socket: MachineSocket, frame: unknown) {
  await running.machine.webSocketMessage(
    socket as unknown as WebSocket,
    typeof frame === 'string' ? frame : JSON.stringify(frame),
  )
}

/** A frame from `nibd`. */
export async function nibd(running: Running, frame: NibdFrame) {
  await running.machine.fromNibd(frame)
}

/** The alarm, if it is due by the clock. Answers whether it fired. */
export async function fire(running: Running): Promise<boolean> {
  const { state } = running
  if (state.alarm === null || state.alarm > Date.now()) return false
  state.alarm = null
  await running.machine.alarm()
  return true
}

/** A namespace that keeps what the door told it, as the hub door's test does. */
export function doorway(): {
  MACHINES: DurableObjectNamespace
  asked: { id: string; headers: Headers }[]
} {
  const asked: { id: string; headers: Headers }[] = []
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({ id: String(id), headers: request.headers })
        return Promise.resolve(Response.json({ state: 'asleep' }))
      },
    }),
  }
  return { MACHINES: namespace as unknown as DurableObjectNamespace, asked }
}
