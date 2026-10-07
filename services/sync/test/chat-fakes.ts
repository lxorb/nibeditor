/** A chat's `ChatLog`, driven without a Durable Object under it.
 *
 *  The same idea as room.ts and hub-fakes.ts: the class the Worker exports is a plain
 *  one, so a state whose SQLite is Node's own, sockets that keep what was said to them,
 *  and a namespace that makes one real object per chat are the whole runtime a test
 *  needs. Node's SQLite has FTS5 as a Durable Object's does, so the words index runs
 *  for real. The clock is Vitest's; the alarm fires when a test says so. */

import { DatabaseSync } from 'node:sqlite'
import type { ServerFrame } from '@nib/chats/wire'
import { ChatLog, type Person } from '../src/chats/log'
import type { Env } from '../src/types'

/** What the runtime pairs a request and its automatic answer with. Not in Node. */
class Pair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
Object.assign(globalThis, { WebSocketRequestResponsePair: Pair })

/** A Durable Object's SQL cursor over rows Node already read. */
class Cursor<T> {
  constructor(private readonly rows: T[]) {}

  toArray(): T[] {
    return this.rows
  }

  one(): T {
    if (this.rows.length !== 1) throw new Error(`expected one row, got ${this.rows.length}`)
    return this.rows[0] as T
  }

  [Symbol.iterator]() {
    return this.rows[Symbol.iterator]()
  }
}

/** A Durable Object's `storage.sql` over Node's SQLite. The schema, the one script of
 *  many statements, is run whole, as `exec` runs one. */
class Sql {
  constructor(private readonly db: () => DatabaseSync) {}

  exec(query: string, ...bindings: (string | number | null)[]) {
    const db = this.db()
    if (!bindings.length && /^\s*create /i.test(query) && query.trim().includes(';')) {
      db.exec(query)
      return new Cursor([])
    }
    // Stepping a statement that names no rows runs it and reads nothing, which is what
    // the runtime's cursor does too.
    return new Cursor(db.prepare(query).all(...bindings) as Record<string, unknown>[])
  }
}

/** A socket: every frame said down it, read back as what it is. */
export class ChatSocket {
  readonly said: ServerFrame[] = []
  closedWith: { code: number | undefined; reason: string | undefined } | null = null
  private attachment: unknown = null

  constructor(readonly tags: string[] = []) {}

  send(data: string) {
    this.said.push(JSON.parse(data) as ServerFrame)
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason }
  }

  get closed(): boolean {
    return this.closedWith !== null
  }

  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value)
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment)
  }

  /** Everything said since the last look. */
  take(): ServerFrame[] {
    return this.said.splice(0, this.said.length)
  }

  /** Only the frames of one kind, from everything said since the last look. */
  takeOf<T extends ServerFrame['t']>(t: T): Extract<ServerFrame, { t: T }>[] {
    return this.take().filter((one): one is Extract<ServerFrame, { t: T }> => one.t === t)
  }
}

/** A Durable Object's state, as much of it as a `ChatLog` uses. */
class ChatState {
  private database = new DatabaseSync(':memory:')
  private sockets: ChatSocket[] = []
  alarm: number | null = null

  readonly storage = {
    sql: new Sql(() => this.database),
    transactionSync: <T>(work: () => T): T => {
      this.database.exec('begin')
      try {
        const done = work()
        this.database.exec('commit')
        return done
      } catch (error) {
        this.database.exec('rollback')
        throw error
      }
    },
    getAlarm: () => Promise.resolve(this.alarm),
    setAlarm: (at: number) => {
      this.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: () => {
      this.alarm = null
      return Promise.resolve()
    },
    /** Everything the object kept, as a fresh SQLite is. */
    deleteAll: () => {
      this.database.close()
      this.database = new DatabaseSync(':memory:')
      this.alarm = null
      return Promise.resolve()
    },
  }

  /** The object's SQLite, for a test to read what it holds. */
  get db(): DatabaseSync {
    return this.database
  }

  /** The runtime's answer to `beat`, which a test never needs to see. */
  setWebSocketAutoResponse(_pair: Pair) {
    return undefined
  }

  acceptWebSocket(socket: ChatSocket, tags: string[] = []) {
    socket.tags.push(...tags)
    this.sockets.push(socket)
  }

  getWebSockets(tag?: string): ChatSocket[] {
    return this.sockets.filter((one) => tag === undefined || one.tags.includes(tag))
  }

  /** A socket the runtime is done with. */
  drop(socket: ChatSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  waitUntil(work: Promise<unknown>) {
    void work
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }
}

export interface Held {
  log: ChatLog
  state: ChatState
}

/** The chats of a whole Worker, one object per chat id, made the first time one is
 *  asked for. A request a route makes runs the real `fetch` on the real class; every
 *  ask is kept, headers and all, so a test can say what a route told an object. */
export function chatLogs(env: Env): {
  CHATS: DurableObjectNamespace
  of(chat: string): Held
  asked: { chat: string; ask: string; headers: Headers }[]
} {
  const made = new Map<string, Held>()
  const asked: { chat: string; ask: string; headers: Headers }[] = []

  const of = (chat: string) => {
    const held =
      made.get(chat) ??
      (() => {
        const state = new ChatState()
        return { log: new ChatLog(state as unknown as DurableObjectState, env), state }
      })()
    made.set(chat, held)
    return held
  }

  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({
          chat: String(id),
          ask: request.headers.get('x-nib-chat-ask') ?? '',
          headers: request.headers,
        })
        return of(String(id)).log.fetch(request)
      },
    }),
  }
  return { CHATS: namespace as unknown as DurableObjectNamespace, of, asked }
}

/** A socket let into a chat as the door would let it in, and its hello said. The door's
 *  request names the chat and its space before the socket is taken; so does this. */
export async function open(
  held: Held,
  person: Person,
  where: { chat: string; space: string },
  since?: number,
): Promise<ChatSocket> {
  await held.log.fetch(
    new Request('https://chats.invalid/', {
      headers: { 'x-nib-chat-ask': 'events', 'x-nib-chat': where.chat, 'x-nib-space': where.space },
    }),
  )
  const socket = new ChatSocket()
  await held.log.enter(socket as unknown as WebSocket, person)
  await say(held, socket, since === undefined ? { t: 'hello' } : { t: 'hello', since })
  return socket
}

/** A frame from a device. */
export async function say(held: Held, socket: ChatSocket, frame: unknown): Promise<void> {
  await held.log.webSocketMessage(
    socket as unknown as WebSocket,
    typeof frame === 'string' ? frame : JSON.stringify(frame),
  )
}

/** A socket closed from the device's side, and the runtime done with it. */
export async function hangUp(held: Held, socket: ChatSocket): Promise<void> {
  socket.closedWith = { code: 1000, reason: undefined }
  await held.log.webSocketClose(socket as unknown as WebSocket)
  held.state.drop(socket)
}

/** The alarm, if it is due by the clock as it stands. Answers whether it fired. */
export async function fire(held: Held): Promise<boolean> {
  const at = held.state.alarm
  if (at === null || at > Date.now()) return false
  held.state.alarm = null
  await held.log.alarm()
  return true
}
