/** An account's hub, driven without a Durable Object under it.
 *
 *  The same idea as room.ts: the class the Worker exports is a plain one, so a state
 *  that keeps its storage in a Map, sockets that keep what was said to them, and a
 *  namespace that makes one real hub per id are the whole runtime a test needs. Two
 *  things are the runtime's own and are stood in for here on purpose, because they
 *  are what the hub's idea of time is made of: the moment a socket last had `beat`
 *  answered for it (`beat`), and the alarm (`fire`). The clock itself is Vitest's,
 *  set by the tests; nothing a device sends ever reaches it. */

import { vi } from 'vitest'
import { sha256 } from '../src/crypto'
import { AccountHub, BEAT, BEAT_ANSWER, type Joining } from '../src/hub/hub'
import type { FromHub } from '../src/hub/frames'
import type { Env } from '../src/types'
import { signIn, type TestEnv } from './harness'

/** What the runtime pairs a request and its automatic answer with. Not in Node. */
class Pair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
Object.assign(globalThis, { WebSocketRequestResponsePair: Pair })

/** A hub socket: what was said down it, and the runtime's record of its beats. */
export class HubSocket {
  readonly said: FromHub[] = []
  readyState = 1
  closedWith: { code: number | undefined; reason: string | undefined } | null = null
  /** The last time the runtime answered this socket's `beat`, or null for never. */
  beatAt: Date | null = null
  private attachment: unknown = null

  constructor(readonly tags: string[] = []) {}

  send(data: string) {
    this.said.push(JSON.parse(data) as FromHub)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closedWith = { code, reason }
  }

  serializeAttachment(value: unknown) {
    // Kept the way the runtime keeps it: a copy, so a test cannot reach in.
    this.attachment = structuredClone(value)
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment)
  }

  /** Everything said since the last time a test looked. */
  take(): FromHub[] {
    return this.said.splice(0, this.said.length)
  }
}

/** A Durable Object's state, as much of it as a hub uses. */
export class HubState {
  readonly kept = new Map<string, unknown>()
  private sockets: HubSocket[] = []
  alarm: number | null = null
  autoResponse: Pair | null = null

  readonly storage = {
    get: (key: string | string[]): Promise<unknown> =>
      Promise.resolve(
        Array.isArray(key)
          ? new Map(key.filter((one) => this.kept.has(one)).map((one) => [one, this.copy(one)]))
          : this.copy(key),
      ),
    put: (first: string | Record<string, unknown>, second?: unknown): Promise<void> => {
      const entries = typeof first === 'string' ? { [first]: second } : first
      for (const [key, value] of Object.entries(entries)) {
        this.kept.set(key, structuredClone(value))
      }
      return Promise.resolve()
    },
    delete: (keys: string | string[]): Promise<boolean | number> => {
      if (typeof keys === 'string') return Promise.resolve(this.kept.delete(keys))
      return Promise.resolve(keys.filter((key) => this.kept.delete(key)).length)
    },
    deleteAll: (): Promise<void> => {
      this.kept.clear()
      this.alarm = null
      return Promise.resolve()
    },
    list: (options: { prefix: string }): Promise<Map<string, unknown>> => {
      const found = new Map<string, unknown>()
      for (const key of [...this.kept.keys()].sort()) {
        if (key.startsWith(options.prefix)) found.set(key, this.copy(key))
      }
      return Promise.resolve(found)
    },
    getAlarm: (): Promise<number | null> => Promise.resolve(this.alarm),
    setAlarm: (at: number): Promise<void> => {
      this.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: (): Promise<void> => {
      this.alarm = null
      return Promise.resolve()
    },
  }

  private copy(key: string): unknown {
    const value = this.kept.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }

  setWebSocketAutoResponse(pair: Pair) {
    this.autoResponse = pair
  }

  acceptWebSocket(socket: HubSocket, tags: string[] = []) {
    socket.tags.push(...tags)
    this.sockets.push(socket)
  }

  getWebSockets(tag?: string): HubSocket[] {
    return this.sockets.filter((one) => tag === undefined || one.tags.includes(tag))
  }

  getTags(socket: HubSocket): string[] {
    return socket.tags
  }

  getWebSocketAutoResponseTimestamp(socket: HubSocket): Date | null {
    return socket.beatAt
  }

  /** A socket the runtime has finished with, gone from the list as it is once its
   *  close handler has run. */
  drop(socket: HubSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }

  waitUntil(work: Promise<unknown>) {
    void work
  }
}

/** A hub and the state under it, with the casts in one place: this file is the
 *  stand-in, so it is where the shapes are promised to line up. */
export function hub(env: Env): { hub: AccountHub; state: HubState } {
  const state = new HubState()
  const made = new AccountHub(state as unknown as DurableObjectState, env)
  return { hub: made, state }
}

/** The hubs of a whole Worker, one per id, made the first time one is asked for. A
 *  request a route makes runs the real `fetch` on the real class. */
export function hubs(env: Env): {
  HUB: DurableObjectNamespace
  of(id: string): { hub: AccountHub; state: HubState }
  asked: { id: string; ask: string; headers: Headers }[]
} {
  const made = new Map<string, { hub: AccountHub; state: HubState }>()
  const asked: { id: string; ask: string; headers: Headers }[] = []

  const of = (id: string) => {
    const held = made.get(id) ?? hub(env)
    made.set(id, held)
    return held
  }

  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({
          id: String(id),
          ask: request.headers.get('x-nib-hub') ?? '',
          headers: request.headers,
        })
        return of(String(id)).hub.fetch(request)
      },
    }),
  }

  return { HUB: namespace as unknown as DurableObjectNamespace, of, asked }
}

/** A device's socket, let in the way the door lets it in. */
export function connect(
  made: AccountHub,
  joining: Partial<Joining> & { device: string; who: string },
): HubSocket {
  const socket = new HubSocket()
  made.enter(socket as unknown as WebSocket, {
    session: '',
    guest: false,
    ...joining,
  })
  return socket
}

/** A frame from a device, whatever it holds. */
export async function send(made: AccountHub, socket: HubSocket, frame: unknown): Promise<void> {
  await made.webSocketMessage(
    socket as unknown as WebSocket,
    typeof frame === 'string' ? frame : JSON.stringify(frame),
  )
}

/** The runtime answering a socket's `beat` now, without the hub hearing a thing. */
export function beat(state: HubState, socket: HubSocket): void {
  if (state.autoResponse?.request !== BEAT || state.autoResponse.response !== BEAT_ANSWER) {
    throw new Error('the hub did not ask the runtime to answer beats')
  }
  socket.beatAt = new Date(Date.now())
}

/** The alarm, if it is due by the clock as it stands. Answers whether it fired. */
export async function fire(made: AccountHub, state: HubState): Promise<boolean> {
  if (state.alarm === null || state.alarm > Date.now()) return false
  state.alarm = null
  await made.alarm()
  return true
}

/** A socket closed from the device's side, and the runtime done with it. */
export async function hangUp(made: AccountHub, state: HubState, socket: HubSocket) {
  socket.readyState = 3
  await made.webSocketClose(socket as unknown as WebSocket)
  state.drop(socket)
}

/** The hubs of a whole Worker; see `hubs`. */
export type Hubs = ReturnType<typeof hubs>

/** A computer of an account: signed in through the real sign-in, with a hub socket
 *  that said hello under that session, beating, and - unless `keyed` is false -
 *  holding the web key. Expects Vitest's clock: a second code to one address waits
 *  out the gap between two codes, so the clock is moved past it for whoever signs
 *  in next. */
export interface Computer {
  token: string
  id: string
  user: string
  session: string
  socket: HubSocket
}

export async function computer(
  env: TestEnv,
  running: Hubs,
  email: string,
  name: string,
  keyed = true,
): Promise<Computer> {
  const token = await signIn(env, email)
  const user = (env.db.prepare('select id from users where email = ?').get(email) as { id: string })
    .id
  const session = (
    env.db.prepare('select id from sessions where token_hash = ?').get(await sha256(token)) as {
      id: string
    }
  ).id

  const id = `device-${name.toLowerCase()}`
  const { hub: made, state } = running.of(user)
  const socket = connect(made, { device: id, who: user, session })
  const hello = { t: 'hello', device: id, name, platform: 'windows', app: '1.0.0' }
  await send(made, socket, hello)
  if (keyed) {
    env.db
      .prepare('insert into web_keys (user_id, device_id, wrapped, generation) values (?, ?, ?, 1)')
      .run(user, id, 'w'.repeat(60))
    await send(made, socket, hello)
  }

  vi.setSystemTime(Date.now() + 31_000)
  beat(state, socket)
  socket.take()
  return { token, id, user, session, socket }
}

/** Every socket of one account's hub, answered a beat now. */
export function beatAll(state: HubState): void {
  for (const socket of state.getWebSockets()) beat(state, socket)
}
