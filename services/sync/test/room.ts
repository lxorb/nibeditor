/** A room, driven without a Durable Object under it.
 *
 *  The class the Worker exports is a plain one: a constructor that takes the
 *  object's state and the bindings, and methods the runtime calls when a socket
 *  says something. Give it a state that keeps its storage in a Map and sockets
 *  that keep what was sent to them in an array, and everything the room does can
 *  be watched from a test - the handshake, two clients converging, the log
 *  folding into a snapshot, the settle writing the note.
 *
 *  What this stands in for is the runtime, not the protocol: the messages that
 *  cross are the real ones, encoded and decoded by the same @nib/rooms both ends
 *  of the real thing use. The room really is running against workerd in the
 *  end-to-end test, where two browsers type into one note; see
 *  test/e2e/collaborate.py. */

import type { RoomKind } from '../src/rooms/kind'
import { NoteRoom } from '../src/rooms/room'
import type { Env } from '../src/types'

/** What the room sends down a socket, and what a test reads back. */
export class FakeSocket {
  readonly sent: Uint8Array[] = []
  closed = false
  /** Why the room closed it, when it was the room that did. */
  closedWith: { code?: number; reason?: string } | null = null
  /** What the room attached to this socket, which the real runtime keeps for it
   *  across a sleep. */
  private attachment: unknown = null

  send(data: Uint8Array | string) {
    if (typeof data !== 'string') this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.closed = true
    this.closedWith = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    }
  }

  serializeAttachment(value: unknown) {
    this.attachment = value
  }

  deserializeAttachment(): unknown {
    return this.attachment
  }

  /** Everything sent since the last time a test looked. */
  take(): Uint8Array[] {
    return this.sent.splice(0, this.sent.length)
  }
}

/** A Durable Object's state, as much of it as a room uses. */
export class FakeState {
  readonly kept = new Map<string, unknown>()
  private sockets: FakeSocket[] = []
  private alarm: number | null = null

  readonly storage = {
    get: (key: string): Promise<unknown> => Promise.resolve(this.kept.get(key)),
    list: (options: { prefix: string }): Promise<Map<string, unknown>> => {
      const found = new Map<string, unknown>()
      for (const [key, value] of this.kept) {
        if (key.startsWith(options.prefix)) found.set(key, value)
      }
      return Promise.resolve(found)
    },
    put: (first: string | Record<string, unknown>, second?: unknown): Promise<void> => {
      const entries = typeof first === 'string' ? { [first]: second } : first
      for (const [key, value] of Object.entries(entries)) this.kept.set(key, value)
      return Promise.resolve()
    },
    delete: (keys: string | string[]): Promise<number> => {
      let gone = 0
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (this.kept.delete(key)) gone++
      }
      return Promise.resolve(gone)
    },
    /** Everything the object kept, alarm included - what resetting a room is made
     *  of; see `crossed` in rooms/room.ts. */
    deleteAll: (): Promise<void> => {
      this.kept.clear()
      this.alarm = null
      return Promise.resolve()
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

  /** Whether a settle is pending, and taking it means it has fired. */
  takeAlarm(): number | null {
    const at = this.alarm
    this.alarm = null
    return at
  }

  acceptWebSocket(socket: FakeSocket) {
    this.sockets.push(socket)
  }

  getWebSockets(): FakeSocket[] {
    return this.sockets
  }

  /** A socket the runtime has finished with, taken out of the list the way the
   *  real one is once its close handler has run. */
  drop(socket: FakeSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }

  /** Why the object asked the runtime to end it, when it did. The real one throws
   *  the whole object away and there is nothing left to ask; here it is recorded,
   *  and the room refuses the request it was handling either way. */
  aborted: string | null = null

  abort(reason?: string) {
    this.aborted = reason ?? ''
  }

  waitUntil(work: Promise<unknown>) {
    this.pending.push(work)
  }

  private readonly pending: Promise<unknown>[] = []

  /** Everything the room asked to finish after the message it was handling. The
   *  runtime waits for these; a test has to say when. */
  async idle(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0, this.pending.length))
  }
}

/** A room and the state under it, with the pair typed as the runtime types them.
 *  The casts are here and nowhere else: this file is the stand-in, so it is where
 *  the shapes are promised to line up. */
export function room(env: Env): { room: NoteRoom; state: FakeState } {
  const state = new FakeState()
  const made = new NoteRoom(state as unknown as DurableObjectState, env)
  return { room: made, state }
}

/** A device joining, with everything the room greeted it with waiting on it.
 *  `writes` is what the door decided; see rooms/index.ts. `kind` is what the door
 *  read off the file's name: a note's words, or the objects on a plane. `who` is
 *  the account or the guest the socket carries, which the room writes down so a
 *  revocation can find it. */
export async function join(
  made: NoteRoom,
  note: { id: string; spaceId: string; kind?: RoomKind; who?: string },
  writes = true,
): Promise<FakeSocket> {
  const socket = new FakeSocket()
  await made.enter(
    socket as unknown as WebSocket,
    { noteId: note.id, spaceId: note.spaceId, kind: note.kind ?? 'words' },
    { writes, who: note.who ?? '' },
  )
  return socket
}

/** The rooms of a whole Worker, so a route can reach the object somebody's
 *  sockets are actually in. One room per note id, made the first time it is asked
 *  for, which is how the runtime names them; see rooms/index.ts.
 *
 *  Unlike `doorway`, this one leads somewhere: a request the route makes runs the
 *  real `fetch` on the real class, which is what lets a revocation be watched
 *  reaching a socket. */
export function running(env: Env): {
  ROOMS: DurableObjectNamespace
  of(noteId: string): { room: NoteRoom; state: FakeState }
  /** Every room made so far, by note id. */
  all(): ReadonlyMap<string, { room: NoteRoom; state: FakeState }>
} {
  const made = new Map<string, { room: NoteRoom; state: FakeState }>()

  const of = (noteId: string) => {
    const held = made.get(noteId) ?? room(env)
    made.set(noteId, held)
    return held
  }

  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => of(String(id)).room.fetch(request),
    }),
  }

  return { ROOMS: namespace as unknown as DurableObjectNamespace, of, all: () => made }
}

/** A namespace that leads nowhere, so the door can be watched deciding without a
 *  runtime to make a Durable Object in. What it keeps is the headers the door
 *  sent, which are the whole of what it tells a room.
 *
 *  `failing` is how many of the first asks throw the way a stub does when the
 *  object it named has gone - a deploy, an overload - so that what the door does
 *  about one can be watched. Past that many it answers. */
export function doorway(failing = 0): { ROOMS: DurableObjectNamespace; asked: Headers[] } {
  const asked: Headers[] = []
  let left = failing

  const stub = {
    fetch: (request: Request) => {
      asked.push(request.headers)
      if (left-- > 0) {
        return Promise.reject(new Error('Durable Object reset because its code was updated.'))
      }

      // Not 101: a Response cannot be built with that status outside the
      // runtime, and the door only passes on whatever it is handed.
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  }

  const namespace = {
    idFromName: () => 'one',
    get: () => stub,
  }

  return { ROOMS: namespace as unknown as DurableObjectNamespace, asked }
}

/** A message from a socket to the room, with whatever it set going settled. */
export async function say(
  made: NoteRoom,
  state: FakeState,
  socket: FakeSocket,
  message: Uint8Array,
): Promise<void> {
  // Copied, because a view onto a larger buffer is not what a socket delivers.
  await made.webSocketMessage(socket as unknown as WebSocket, message.slice().buffer)
  await state.idle()
}
