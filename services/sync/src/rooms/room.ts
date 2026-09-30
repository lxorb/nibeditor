/** One file, being written in by several devices at once.
 *
 *  A room is a Durable Object: one instance in the world per file, which is what
 *  makes it the place the sockets meet. It holds the file as a Yjs document, so
 *  two devices that both wrote - at the same moment, or an hour apart with one of
 *  them on a train - end up with the same content and nobody is asked to choose.
 *
 *  Three things happen here and nothing else does. Sockets are joined and their
 *  messages handed to the protocol (see @nib/rooms, which is the wire). Updates
 *  are written down and folded into a snapshot when the pile grows, so waking a
 *  room is one read. And the content is settled into the note store a moment after
 *  the typing stops, as an ordinary save with the version moved on, so everything
 *  else that reads notes - the file sync, publishing, the connector, the glasses,
 *  exports, search - carries on knowing nothing about any of this.
 *
 *  A note and a canvas are both rooms and this is both of them. What differs is
 *  only what the document holds - one `Y.Text` of prose, or a map of the objects on
 *  a plane - and that lives in kind.ts, decided from the file's name. One object
 *  class rather than two, because everything here is the same either way: a room
 *  is named by the file's id, so there is one instance per file whichever kind it
 *  is, and a second class would be this whole file again for the sake of one
 *  seed and one serialiser.
 *
 *  The sockets hibernate: the runtime may take this object out of memory between
 *  messages and put it back on the next one, and while it is away the room costs
 *  nothing. That is why nothing that matters is held in a field. The open sockets
 *  are asked of the runtime, what each socket announced is kept on the socket
 *  itself, and the settle is an alarm rather than a timer. */

import { Awareness } from 'y-protocols/awareness'
import {
  awarenessState,
  awarenessUpdate,
  forget,
  isEdit,
  unattended,
  receive,
  syncStep1,
  syncUpdate,
} from '@nib/rooms'
import { fold } from '@nib/rooms/fold'
import {
  ackFrame,
  epochFrame,
  frame,
  MOST_UPDATE_BYTES,
  NEW_EPOCH,
  type PushAnswer,
  unframe,
} from '@nib/sync-core'
import * as Y from 'yjs'
import { byteLength, sha256 } from '../crypto'
import { note as noted } from '../failed'
import { pokeSpace } from '../hub/poke'
import { MAX_NOTE_BYTES, noteBeside, noteKey, saveNote } from '../notes'
import { fits } from '../storage'
import { revive } from '../sync2/ops'
import type { Env, Note } from '../types'
import { deviceIn, versionKey } from '../versions'
import { ingested, seedOf, snapshotKey } from './epoch'
import {
  fileOf,
  fill,
  kindOf,
  leavesAPlane,
  neverHeld,
  roomKind,
  takeInto,
  writesOf,
  type RoomKind,
} from './kind'
import { RoomState, TOO_LARGE_IN_A_ROOM } from './state'

/** How long after the last keystroke the words are written into the note store.
 *  The same pause the app waits before it writes a note to disk, so somebody who
 *  has stopped typing sees one settle rather than two. */
const SETTLE_DELAY = 1_200

/** How many awareness entries one socket is remembered as having announced. A
 *  device is one caret and announces one; a handful covers a client that reloaded
 *  its document without closing the socket. The point of the number is that there
 *  is one: see `announced`. */
const MOST_ANNOUNCED = 32

/** Which file this room is, learned from the first join and kept in storage so
 *  that a room woken by an alarm knows what to write, and what shape what it
 *  holds is in. */
export interface Held {
  noteId: string
  spaceId: string
  kind: RoomKind
  /** The note's version this room's document is level with: the one it was seeded
   *  from, or the one its last settle wrote. What it is for is noticing that
   *  something else has written the note since - a device whose socket is down
   *  pushing the file it holds, the connector, a rollback - because the settle is a
   *  whole-file write and the words in a version the room never saw are not the
   *  room's to drop. See `keptBeside`.
   *
   *  Absent for a room written down before there was a reason to keep it, which is
   *  read as "level with whatever is there": one settle later it says so. */
  version?: number
  /** And the words that version said, as this room's own document settles into. What
   *  it answers is whether the room is carrying anything at all: a document that
   *  still says exactly this has heard no keystroke since, so a note that has moved
   *  under it moved for somebody else's reasons and there is nothing here to write on
   *  top of it. See `caughtUp` and the settle.
   *
   *  Written at the moment it becomes true - the seed, and every settle that lands -
   *  because that is the only moment anything can honestly say it. Absent for a room
   *  written down before this was kept, which is a room that says nothing about
   *  itself until its next settle. */
  hash?: string
  /** The epoch of the document this room holds, for a note on sync v2, and the hash of
   *  the words it was seeded from. Absent for a room that has only ever held a v1
   *  note, which is epoch 0. See `startEpoch`. */
  epoch?: number
  epochBase?: string
  /** The document's version the bucket's snapshot is of, so a settle that changed
   *  nothing does not write the same snapshot again. */
  snapshot?: number
}

/** What a socket has announced, kept on the socket so that a room which was
 *  asleep still knows whose carets to take away when it closes - and whether it
 *  was let in to write, which the door decided and this object only enforces,
 *  and whose socket it is, which is the one thing about the person the room keeps.
 *
 *  `who` is an id and nothing else: the room cannot look anybody up and does not
 *  know what it names. What it is for is being told "this one is not in the space
 *  any more" and finding the sockets that answer to it; see `revoke`. */
interface Attached {
  clients: number[]
  mayWrite: boolean
  who: string
  /** Whether it offered `nib.v2`, and so hears the room's acknowledgements and its
   *  new epochs; a socket without it is a v1 app and hears neither. */
  v2?: boolean
  /** The device on the other end, when it said which: whose the words it types are,
   *  for the tree's rule that a device's own writing never stands against its own
   *  delete. */
  device?: string
}

/** What the door decided about the person on the other end of a socket. */
export interface Joining {
  writes: boolean
  who: string
  v2?: boolean
  device?: string
  /** The note's epoch as the door read it, which may be newer than the one this room
   *  holds; see `caughtUpWithEpoch`. */
  epoch?: number
}

/** How long a row saying somebody has a file open is believed. Well past any
 *  sitting a room stays awake for, and a bound on rows a close never came for. */
const OPEN_FOR = 24 * 60 * 60 * 1000

/** What a socket is closed with when the room will take no more keystrokes: the web
 *  socket's own "message too big", which is what this is. The client knows the code
 *  and shows the reason; see `TOO_LARGE` in apps/desktop/src/lib/rooms/door.ts. */
const TOO_LARGE = 1009

/** What a room kept about itself, read back. A room written down before there
 *  were two kinds says nothing about which it is, and a note is what it was. */
function heldIn(value: unknown): Held | null {
  if (typeof value !== 'object' || value === null) return null

  const held = value as Partial<Held>
  if (typeof held.noteId !== 'string' || typeof held.spaceId !== 'string') return null

  return {
    noteId: held.noteId,
    spaceId: held.spaceId,
    kind: kindOf(held.kind),
    ...(typeof held.version === 'number' ? { version: held.version } : {}),
    ...(typeof held.hash === 'string' && held.hash ? { hash: held.hash } : {}),
    ...(typeof held.epoch === 'number' ? { epoch: held.epoch } : {}),
    ...(typeof held.epochBase === 'string' ? { epochBase: held.epochBase } : {}),
    ...(typeof held.snapshot === 'number' ? { snapshot: held.snapshot } : {}),
  }
}

function attachedTo(socket: WebSocket): Partial<Attached> | null {
  const held: unknown = socket.deserializeAttachment()
  return held && typeof held === 'object' ? held : null
}

function announcedBy(socket: WebSocket): number[] {
  const clients = attachedTo(socket)?.clients
  return Array.isArray(clients) ? clients.filter((one) => typeof one === 'number') : []
}

/** Whether this socket was let in to write. A socket whose attachment says
 *  nothing may not: the only way to lose the flag is a shape this version did
 *  not write, and refusing is the safe answer to that. */
function mayWrite(socket: WebSocket): boolean {
  return attachedTo(socket)?.mayWrite === true
}

/** Whose socket this is, or nothing for one joined before the room was told. */
function whoOf(socket: WebSocket): string {
  const held = attachedTo(socket)?.who
  return typeof held === 'string' ? held : ''
}

/** Whether a socket speaks sync v2; see `Attached`. */
function speaksV2(socket: WebSocket): boolean {
  return attachedTo(socket)?.v2 === true
}

/** The device a socket said it is, if it said. */
function deviceIdOf(socket: WebSocket): string | undefined {
  const device = attachedTo(socket)?.device
  return typeof device === 'string' && device ? device : undefined
}

/** A socket's attachment with some of it changed and the rest kept, which is how every
 *  write to one is made: a field one write knows about is not one the next drops. */
function attach(socket: WebSocket, change: Partial<Attached>) {
  const device = deviceIdOf(socket)
  const kept: Attached = {
    clients: announcedBy(socket),
    mayWrite: mayWrite(socket),
    who: whoOf(socket),
    ...(speaksV2(socket) ? { v2: true } : {}),
    ...(device === undefined ? {} : { device }),
  }
  socket.serializeAttachment({ ...kept, ...change } satisfies Attached)
}

/** What a change an HTTP request brought is marked as having come from, so the room
 *  can tell it from a socket's. */
const PUSHED = 'push'

/** How many pushes a room remembers the answer to, so one whose answer was lost is
 *  answered the same way when it comes again; see `PushDoc` in @nib/sync-core. A device
 *  resends only its latest, so a few dozen covers every device a note has. */
const REMEMBERED_PUSHES = 64

interface Remembered {
  push: string
  seq: number
  sv: Uint8Array
}

function rememberedIn(value: unknown): Remembered[] {
  if (!Array.isArray(value)) return []
  return value.filter((one: unknown): one is Remembered => {
    if (typeof one !== 'object' || one === null) return false
    const { push, seq, sv } = one as Partial<Remembered>
    return typeof push === 'string' && typeof seq === 'number' && sv instanceof Uint8Array
  })
}

/** A pushed document as the room reads it, off the envelope the route framed. */
interface Pushed {
  push: string
  epoch: number
  seq: number
  base: Uint8Array
  update: Uint8Array
  device?: string
  name?: string
}

function pushedIn(value: unknown): Pushed | null {
  if (typeof value !== 'object' || value === null) return null
  const { push, epoch, seq, base, update, device, name } = value as Record<string, unknown>
  if (typeof push !== 'string' || typeof epoch !== 'number' || typeof seq !== 'number') return null
  if (!(base instanceof Uint8Array) || !(update instanceof Uint8Array)) return null
  return {
    push,
    epoch,
    seq,
    base,
    update,
    ...(typeof device === 'string' ? { device } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  }
}

/** What a push to the room answers, before the route names the document. */
type Unnamed<T> = T extends unknown ? Omit<T, 'id'> : never
type RoomAnswer = Unnamed<PushAnswer>

/** What an ingest answers: the note as it now stands, a 409 for a v1 save that named
 *  an older version, or why nothing was written. */
export type Ingested = { note: Note } | { conflict: true } | { refused: string }

/** A whole text to ingest, as the route sent it. */
interface Ingesting {
  text: string
  base?: number
  name?: string
  device?: string
}

function ingestIn(body: Uint8Array): Ingesting | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(body))
  } catch {
    // Only the route sends this, so a body that does not parse is a bug there, and
    // what it gets is the refusal below.
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { text, base, name, device } = value as Record<string, unknown>
  if (typeof text !== 'string') return null
  return {
    text,
    ...(typeof base === 'number' ? { base } : {}),
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof device === 'string' ? { device } : {}),
  }
}

/** What a v1 app's socket is closed with when its room starts a new document: the code
 *  its own join logic reads as "this room was rebuilt", which drops the document it
 *  held and meets the room again from the file, rather than reconnecting and merging
 *  two documents made separately from the same words. See `REBUILT` in the app's
 *  rooms/door.ts. */
const REBUILT = 1012

/** An epoch a header said, or nothing for one that did not say a whole number. */
function epochIn(header: string | null): number | undefined {
  const said = Number(header ?? '')
  return header !== null && Number.isSafeInteger(said) && said >= 0 ? said : undefined
}

function octets(body: Uint8Array): Response {
  return new Response(body, { headers: { 'content-type': 'application/octet-stream' } })
}

/** The row a room reads about its note to know which document it should hold. */
interface Placed {
  version: number
  path: string
  epoch: number
  epoch_base: string | null
  hash: string
  deleted: number
}

/** What the device on the other end of a socket calls itself.
 *
 *  Not something the room is told: it is what that device announced to everybody
 *  else in the room, which is how the other carets in it are already labelled. The
 *  socket's attachment says which awareness entries are its own, and the entry says
 *  the name; a socket that has announced nothing has no name to give, and a name is
 *  never invented for it.
 *
 *  Read at the boundary like anything else off the wire, because this one is: it
 *  arrives from a client and ends up in a row the history sheet shows. */
function deviceOf(socket: WebSocket, awareness: Awareness): string {
  const states = awareness.getStates()

  for (const client of announcedBy(socket)) {
    const said: unknown = states.get(client)
    if (typeof said !== 'object' || said === null) continue

    const who: unknown = (said as { who?: unknown }).who
    if (typeof who !== 'object' || who === null) continue

    const name: unknown = (who as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) return deviceIn(name)
  }

  return ''
}

export class NoteRoom implements DurableObject {
  /** Not readonly: a room that starts a new epoch starts a new document, and a Yjs
   *  document cannot be emptied; see `startEpoch`. */
  private state: RoomState
  private awareness: Awareness
  /** Settles once the document has been read back out of storage, or seeded from
   *  the note. Held so that two joins landing together do not both seed it. */
  private opened: Promise<void> | null = null
  private held: Held | null = null
  /** When the settle already on the clock will fire, or null for one this object
   *  did not put there itself; see `settleSoon`. */
  private settleAt: number | null = null
  /** What the device whose update put that settle on the clock calls itself, so the
   *  version the settle writes says where the words came from; see `deviceOf`. Empty
   *  where nothing said - a room the runtime woke to fire an alarm has forgotten, and
   *  no name is better than another device's. */
  private settling = ''
  /** And which device that was, by id rather than by name, for the tree; see
   *  `Attached`. */
  private settlingDevice: string | undefined = undefined

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state = new RoomState(ctx.storage)
    this.awareness = new Awareness(this.state.doc)
    this.listen()
  }

  /** What the room does when its document or its awareness changes. Apart from the
   *  constructor because a room starting a new epoch listens to a new document. */
  private listen() {
    // A room is a place, not somebody in it, and it must be able to sleep; see
    // `unattended`.
    unattended(this.awareness)

    const awareness = this.awareness
    this.state.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.ctx.waitUntil(this.spread(update, origin))
    })

    awareness.on('update', (changed: AwarenessChange, origin: unknown) => {
      const clients = [...changed.added, ...changed.updated, ...changed.removed]
      if (!clients.length) return

      this.announced(origin, changed)
      this.send(awarenessUpdate(awareness, clients), origin)
    })
  }

  /** Three things arrive here, and the headers say which. A device joining, which
   *  the Worker has already decided about; a route saying that somebody's access to
   *  this file has ended or narrowed since it did; or the file having gone for good
   *  with the account it belonged to. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('x-nib-erase')) return await this.erase()

    const revoked = request.headers.get('x-nib-revoked')
    if (revoked) return await this.revoke(revoked, request.headers.get('x-nib-role') === 'read')

    const noteId = request.headers.get('x-nib-note')
    const spaceId = request.headers.get('x-nib-space')
    if (!noteId || !spaceId) return new Response('no note', { status: 400 })

    const kind = kindOf(request.headers.get('x-nib-kind'))
    const held: Held = { noteId, spaceId, kind }

    // A device without a socket, sync v2's HTTP half: a push, a pull, or a whole text
    // handed in by something that has no document of its own. See `push`, `pull` and
    // `ingest`.
    const asked = request.headers.get('x-nib-doc')
    if (asked === 'push' || asked === 'pull' || asked === 'ingest') {
      const body = new Uint8Array(await request.arrayBuffer())
      await this.open(held)
      await this.caughtUpWithEpoch(epochIn(request.headers.get('x-nib-epoch')))
      if (asked === 'push') return octets(await this.push(body))
      if (asked === 'pull') return octets(await this.pull(body))
      return Response.json(await this.ingest(body))
    }

    const device = request.headers.get('x-nib-device-id')
    const epoch = epochIn(request.headers.get('x-nib-epoch'))
    const pair = new WebSocketPair()
    await this.enter(pair[1], held, {
      writes: writesOf(request.headers.get('x-nib-write')),
      who: request.headers.get('x-nib-who') ?? '',
      v2: request.headers.get('x-nib-v2') === 'yes',
      ...(device ? { device } : {}),
      ...(epoch === undefined ? {} : { epoch }),
    })

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The room's half of a socket, joined and greeted. Apart from `fetch` because
   *  it is the whole of what joining means, and because a test drives it without
   *  a runtime to make the pair or to carry a 101 answer. */
  async enter(
    server: WebSocket,
    held: Held,
    joining: Joining = { writes: true, who: '' },
  ): Promise<void> {
    await this.crossed(held.kind)
    await this.open(held)
    await this.caughtUpWithEpoch(joining.epoch)

    // Written down where a revocation can find it, and written before the socket
    // is taken: the row is the whole of how an owner reaches this socket later, so
    // a socket in the room that no row names is one nobody can close. Which is
    // why a join that cannot be written down is a join to refuse rather than to
    // half make - the door turns the failure into a 503 and the client asks again,
    // with nothing accepted here in the meantime.
    //
    // Not a lock and not a session: the row says only that this person has this
    // file open, so that the route that ends their access knows which rooms to
    // tell.
    await this.remember(held, joining.who)

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      clients: [],
      mayWrite: joining.writes,
      who: joining.who,
      ...(joining.v2 ? { v2: true } : {}),
      ...(joining.device ? { device: joining.device } : {}),
    } satisfies Attached)

    // The greeting, both halves at once: what this room holds, and who is in it.
    server.send(syncStep1(this.state.doc))
    const present = awarenessState(this.awareness)
    if (present) server.send(present)
  }

  /** The file behind this room was renamed from a note into a canvas, or back,
   *  while the room held it.
   *
   *  The two shapes cannot be turned into each other: a canvas is not prose and
   *  prose is not a plane. So there is nothing to convert, and what used to happen
   *  instead was the worst of the three things that could: the join said the new
   *  kind, the room wrote it down as though it had always been that, and the settle
   *  read the document through the wrong serialiser. A plane read as words is the
   *  empty string, so a canvas somebody had drawn on was written over with nothing.
   *
   *  What happens now is the one order of events that keeps both the file and the
   *  session. What the room holds goes into the file first, through the shape it
   *  really is - which is byte for byte what renaming the file on a disk leaves
   *  behind, and the only write allowed to disagree with the file's new name. Then
   *  the room is taken down: every socket closed with 1012, which is the code for
   *  "the server is restarting" and which the app's own backoff comes back from
   *  inside a second, and the storage emptied so that the join after it builds the
   *  room out of the file under the kind it now is. Nothing is converted and nothing
   *  is guessed; the file keeps its bytes and the room becomes what the file is.
   *
   *  The object is reset rather than talked round because a `Y.Doc` cannot be turned
   *  from prose into a plane, and seeding a second shape into the one this object is
   *  holding would leave it both at once - which is the state this whole method is
   *  about not being in.
   *
   *  A settle that did not land leaves everything exactly as it was and refuses the
   *  join. The door answers 503, the client asks again, and the next attempt may
   *  land; what must not happen is a document thrown away while the file is still
   *  without it. */
  private async crossed(wanted: RoomKind): Promise<void> {
    const held = this.held ?? heldIn(await this.ctx.storage.get('note'))
    if (!held || held.kind === wanted) return

    // The document has to be in hand before it can be written down, which for an
    // object the runtime woke is a read.
    await this.open(held)

    if (!(await this.settle(true))) {
      throw new Error(`this room still holds the ${held.kind} its file was`)
    }

    // The row saying somebody has this file open goes with the sockets: a close
    // this side asked for brings no close handler with it.
    await this.env.DB.prepare('delete from room_sockets where note_id = ?').bind(held.noteId).run()

    for (const socket of this.ctx.getWebSockets()) {
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(1012, 'this file is another kind of room now')
    }

    await this.ctx.storage.deleteAll()
    this.ctx.abort('the file behind this room is another kind of file now')

    // `abort` ends the object rather than this function, so the join is refused
    // here as well: what must not happen is entering the room that just went.
    throw new Error(`this room is starting again as a ${wanted} room`)
  }

  /** This person has this file open. */
  private async remember(held: Held, who: string): Promise<void> {
    if (!who) return

    // Rows a close never came for - an object the runtime dropped, a socket the
    // network took - are cleared by age as new ones arrive, the way the sessions
    // and the sign-in codes are.
    await this.env.DB.prepare('delete from room_sockets where opened_at < ?')
      .bind(Date.now() - OPEN_FOR)
      .run()

    await this.env.DB.prepare(
      `insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)
       on conflict(note_id, who) do update set opened_at = excluded.opened_at`,
    )
      .bind(held.noteId, held.spaceId, who, Date.now())
      .run()
  }

  /** And this person no longer has, unless another of their devices still does:
   *  the row is per person, and the room is the only thing that knows which of
   *  its sockets are whose. */
  private async forgetSocket(socket: WebSocket): Promise<void> {
    const who = whoOf(socket)
    const held = this.held
    if (!who || !held) return

    const others = this.ctx.getWebSockets().some((one) => one !== socket && whoOf(one) === who)
    if (others) return

    await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
      .bind(held.noteId, who)
      .run()
  }

  /** Somebody's access to this file ended, or narrowed to reading, while they had
   *  it open. The route that changed it says so and this happens inside that same
   *  request: what a socket cannot be asked to notice about itself.
   *
   *  A room with nobody in it is the common case by far - the route asks because a
   *  row said somebody was here - and it answers without waking the document. */
  private async revoke(who: string, toRead: boolean): Promise<Response> {
    const sockets = this.ctx.getWebSockets()
    if (!sockets.length) return new Response(null, { status: 204 })

    await this.woken()

    for (const socket of sockets) {
      if (whoOf(socket) !== who) continue

      if (toRead) {
        // Still in the room and still seeing every keystroke, which is what a
        // reader is; what they may no longer do is add one.
        attach(socket, { mayWrite: false })
        continue
      }

      // Their caret goes with them, and the socket is closed rather than left to
      // find out. 1008 is what a policy that has changed under a connection is.
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(1008, 'no longer in this space')
    }

    // A close this side asked for brings no close handler with it, so the row goes
    // from here.
    if (!toRead && this.held) {
      await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
        .bind(this.held.noteId, who)
        .run()
    }

    return new Response(null, { status: 204 })
  }

  /** The file is gone for good, and so is what this room kept of it.
   *
   *  A room keeps its document for as long as the file does, which until an account
   *  could be deleted was for as long as the service ran. Everybody in it is closed
   *  out the way a revocation closes one person, the settle that may be on the clock
   *  is taken off it, and the storage goes. What is held in memory is let go of too:
   *  without `held` a settle has nothing to write into, so nothing this object still
   *  remembers can put a row or a byte back. An object that never existed answers the
   *  same, with nothing to take away. */
  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) {
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(1008, 'no longer in this space')
    }

    this.held = null
    this.settleAt = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()

    return new Response(null, { status: 204 })
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    // Everything a room says is bytes. A string is not this protocol.
    if (typeof message === 'string') return

    const said = new Uint8Array(message)

    // A reader is in the room and sees every keystroke as it is typed; what
    // they may not do is add one. The client does not offer it, and this is
    // why that is a matter of taste rather than of trust.
    if (!mayWrite(socket) && isEdit(said)) return

    await this.woken()

    // And a document at its ceiling takes no more keystrokes from anybody. Refused
    // before `receive` rather than after: an update applied is in the document and
    // nothing takes it back out, so the room would be over the line for good - its
    // snapshot growing on every settle, its every wake reading all of it. See `full`
    // in state.ts.
    //
    // The socket is closed with the reason, which is 1009 - the web socket's own
    // "message too big". The client stops on that code rather than reconnecting and
    // says so once; the note then carries on as a file, where a save too large is
    // refused in as many words. Dropping the update and leaving the socket open was
    // the first answer here, from before the client could hear a reason: it left
    // somebody typing into a room that was throwing the keystrokes away without a
    // word, which is the worst of the three. See `TOO_LARGE` in
    // apps/desktop/src/lib/rooms/door.ts.
    if (isEdit(said) && this.state.full()) {
      noted(`room ${this.held?.noteId ?? 'unknown'}`, new Error(TOO_LARGE_IN_A_ROOM), null)
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(TOO_LARGE, TOO_LARGE_IN_A_ROOM)
      return
    }
    const answer = receive(said, this.state.doc, this.awareness, socket)
    if (answer) socket.send(answer)
  }

  async webSocketClose(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)

    // Which file this room is has to be known before the row can be taken away,
    // and an object that slept in the meantime does not know yet.
    await this.woken()
    await this.forgetSocket(socket)

    // The last device out settles what is left, rather than the words waiting
    // for whoever opens the note next. The socket that is closing is still in
    // the list while this runs.
    if (this.ctx.getWebSockets().length <= 1) await this.settle()
  }

  async webSocketError(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)

    await this.woken()
    await this.forgetSocket(socket)
  }

  /** The settle. An alarm rather than a timer, so a room the runtime put to sleep
   *  still writes down what was typed into it. */
  async alarm() {
    this.settleAt = null
    await this.woken()
    await this.settle()
  }

  /** The room as it stood, for an object that was put back into memory after
   *  sleeping: which note it is comes out of storage, and the document with it. */
  private async woken(): Promise<void> {
    if (this.opened) return this.opened

    const held = heldIn(await this.ctx.storage.get('note'))
    if (held) await this.open(held)
  }

  /** The room's document, read back out of storage or seeded from the note as the
   *  store holds it. Runs once; every later call waits on the same promise.
   *
   *  Once, but only once it has worked. Opening a room reaches two stores - its own
   *  and the note's - and either can be a moment from answering; a failure kept as
   *  "the room is open" is a room that hands the same moment back to every join,
   *  every message and every settle for as long as the object lives, and the store
   *  being well again changes nothing. So a failed attempt is let go of: everything
   *  waiting on it hears the one failure, and the next join reads the document
   *  again rather than the failure. What the door does with that failure is answer
   *  503, so the client is already coming back. */
  private open(held: Held): Promise<void> {
    if (this.opened) return this.opened

    this.held = held
    // Nothing else may run against this object until the document is whole: a
    // second join that saw an empty room would seed it a second time.
    const opening = this.ctx.blockConcurrencyWhile(async () => {
      // What this room already knew about itself, which a join does not carry. The
      // headers a device arrives on say which note and which shape and nothing about
      // where the note had got to, so writing them straight over the stored record
      // was a room that woke having forgotten which words it is level with - and a
      // settle that could no longer tell a note nothing had touched from one a device
      // pushed while the room slept. It wrote over the second without keeping a word
      // of it. See `Held`.
      const before = heldIn(await this.ctx.storage.get('note'))
      if (before?.noteId === held.noteId) {
        if (before.version !== undefined) held.version ??= before.version
        if (before.hash !== undefined) held.hash ??= before.hash
        if (before.epoch !== undefined) held.epoch ??= before.epoch
        if (before.epochBase !== undefined) held.epochBase ??= before.epochBase
        if (before.snapshot !== undefined) held.snapshot ??= before.snapshot
      }

      await this.ctx.storage.put('note', held)

      const loaded = await this.state.load()
      const row = await this.placed(held.noteId)

      // A note on sync v2 has a document of an epoch, and the room holds that one:
      // seeded, the first time, from the words the epoch names, and started again from
      // them if what it holds is a v1 room's or an older epoch's. See `startEpoch`.
      if (row && row.epoch >= 1) {
        if (!loaded) await this.startEpoch(held, row, null)
        else if ((held.epoch ?? 0) !== row.epoch) {
          await this.startEpoch(held, row, await this.carried(held))
        }
      } else if (!loaded) {
        // A room with nothing stored of its own is filled from the file as the store
        // holds it. Only ever the first time: a plane somebody emptied is empty, and
        // seeding it again would put every card back.
        const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
        const file = object ? await object.text() : ''
        await this.state.seed((doc) => fill(held.kind, doc, file))

        // And which version those words were, so that a settle can tell a note
        // nothing has touched since from one that something wrote while the room held
        // it; see `keptBeside`. Read after the bytes rather than before: a version
        // that moved in between then reads as one the room never saw, which is the
        // safe way round to be wrong.
        const level = await this.env.DB.prepare('select version from notes where id = ?')
          .bind(held.noteId)
          .first<{ version: number }>()

        if (level) {
          held.version = level.version
          // The words themselves, as this room would settle them: a plane read back
          // out of a file is the same drawing and not always the same bytes, and what
          // this answers is whether the room is carrying anything of its own.
          held.hash = await sha256(fileOf(held.kind, this.state.doc))
          await this.ctx.storage.put('note', held)
        }
      } else {
        await this.caughtUp(held)
      }

      // Sockets that were already here mean this object was asleep rather than
      // new. What it holds may be a moment behind them - the last keystrokes
      // before it slept were only in memory - so it asks each of them what they
      // have, and the answer puts them back. See `record` in state.ts.
      const waiting = this.ctx.getWebSockets()
      if (waiting.length) this.send(syncStep1(this.state.doc), null)
    })

    this.opened = opening
    opening.catch(() => {
      // And nothing is held about a room that did not open. `held` is what the
      // settle writes from, and settling a document that was never read back
      // would put an empty file where the words are.
      if (this.opened !== opening) return

      this.opened = null
      this.held = null
    })

    return opening
  }

  /** What the note says now, for a room that has just woken to find it has moved.
   *
   *  A room keeps its document for as long as the file does, and while nobody is in
   *  it the note goes on being written: a pass pushing the file, the connector, a
   *  rollback, a version put back. So the words a room wakes holding can be a day
   *  behind - and what it did with them was hand them to the next device to open the
   *  note as the truth, which took the newer words off that device's screen, then off
   *  its disk, and then off the account through a settle that read its own stale copy
   *  as what everybody was looking at.
   *
   *  Taken rather than weighed, because there is nothing here to weigh: this runs only
   *  where the document says exactly what the room last wrote down, so every word the
   *  note has gained since is one nobody in this room has touched. A room that does
   *  hold writing of its own is left exactly as it is, and its settle keeps both
   *  copies the way it always has; see `keptBeside`.
   *
   *  One row per wake, which is once per object: the same read the settle makes every
   *  time it runs. */
  private async caughtUp(held: Held): Promise<void> {
    if (held.version === undefined || held.hash === undefined) return

    const row = await this.env.DB.prepare(
      'select version, path from notes where id = ? and deleted = 0',
    )
      .bind(held.noteId)
      .first<{ version: number; path: string }>()

    if (!row || row.version === held.version) return
    // A file renamed across the two kinds while the room slept is not a note to take
    // the bytes of; that is `crossed`, and it runs before this.
    if (roomKind(row.path) !== held.kind) return

    const mine = fileOf(held.kind, this.state.doc)
    if ((await sha256(mine)) !== held.hash) return

    const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
    const file = object ? await object.text() : ''
    // Nothing to take from a read that came back empty: a note whose bytes are not
    // there is not a note that says nothing. See `neverHeld` for the same line.
    if (!file) return

    if (file !== mine) takeInto(held.kind, this.state.doc, mine, file)

    held.version = row.version
    held.hash = await sha256(fileOf(held.kind, this.state.doc))
    await this.ctx.storage.put('note', held)
  }

  /** An update somebody made: passed on to everyone else, and written down.
   *
   *  Passed on first and by itself, because that is the part somebody is waiting
   *  for. Everything after it is bookkeeping, and none of it touches storage in
   *  the ordinary case: the update waits in memory until the settle, and the
   *  alarm is asked for once rather than once per keystroke. */
  private async spread(update: Uint8Array, origin: unknown) {
    this.send(syncUpdate(update), origin)

    // Whose keystrokes these were, for the version the settle after them writes. The
    // last to arrive is the one the settle is about, which is what the sheet means by
    // the device beside a moment: several devices in a note make a version each as
    // each of them pauses.
    if (isSocket(origin)) {
      this.settling = deviceOf(origin, this.awareness)
      this.settlingDevice = deviceIdOf(origin)
    }

    // The state refuses an update past the ceiling as well, and reaching that is
    // this file's mistake rather than a reader's: the message was refused at the
    // door above, before it was applied. Said in the log rather than left to reject
    // into `waitUntil`, which the runtime would read as the room having failed.
    await this.state.record(update).catch((wrong: unknown) => {
      noted(`room ${this.held?.noteId ?? 'unknown'}`, wrong, null)
    })
    await this.settleSoon()
  }

  /** Puts a settle on the clock, once for each burst of typing. The pending time
   *  is remembered here as well as in the object, so a keystroke does not cost a
   *  storage read to find out that a settle is already coming. */
  private async settleSoon() {
    if (this.settleAt !== null && this.settleAt > Date.now()) return
    // Nothing is remembered after a sleep, so the object is asked once.
    if (this.settleAt === null && (await this.ctx.storage.getAlarm()) !== null) return

    this.settleAt = Date.now() + SETTLE_DELAY
    await this.ctx.storage.setAlarm(this.settleAt)
  }

  /** To every socket but the one it came from. */
  private send(message: Uint8Array, except: unknown) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue

      try {
        socket.send(message)
      } catch {
        // A socket the runtime has already given up on. Its close handler takes
        // the carets away; there is nothing to do about it here.
      }
    }
  }

  /** Which awareness entries a socket announced, kept on the socket itself so the
   *  room can take them away later even if it slept in between.
   *
   *  What it stopped announcing goes with what it started, and the list is capped.
   *  A socket's attachment has a hard ceiling of a couple of kilobytes, and a list
   *  that only ever grew would reach it: from anything sending awareness for a few
   *  hundred clients at once, which is one message. Past the ceiling the write
   *  throws, and it throws inside the handler for the message that caused it -
   *  which is a room one client can stop working for everybody in it. */
  private announced(origin: unknown, changed: AwarenessChange) {
    if (!isSocket(origin)) return
    if (!changed.added.length && !changed.removed.length) return

    const gone = new Set(changed.removed)
    const clients = [...new Set([...announcedBy(origin), ...changed.added])]
      .filter((one) => !gone.has(one))
      .slice(-MOST_ANNOUNCED)

    attach(origin, { clients })
  }

  /** The file as it now stands, written into the note store the way any other save
   *  writes it: the bytes in R2, the row's version and the space's cursor moved on.
   *  Every device that is not in the room reads it as an ordinary edit made
   *  somewhere else, which is exactly what it is.
   *
   *  Answers whether the file now holds what the room holds. Every way of saying no
   *  leaves both of them as they were - the words stay in the room, and the file
   *  keeps its own - because there is no failure here whose better outcome is a
   *  file with less in it than it started with. `crossed` is the one caller that
   *  reads the answer, because it is the one that throws a document away and may
   *  only do so once the file has it.
   *
   *  `crossing` is that call, and the one write allowed to disagree with the file's
   *  name; see `crossed`. */
  private async settle(crossing = false): Promise<boolean> {
    const held = this.held
    if (!held) return false

    // What arrived since the last settle, written into the room's own storage.
    // The two copies move together: everything the note store holds is in the
    // room's snapshot too, and nothing is left only in memory.
    await this.state.flush()

    // A note on sync v2 settles as a document; see `settleDocument`. Everything below
    // is a v1 room's settle, unchanged.
    if ((held.epoch ?? 0) >= 1) return await this.settleDocument(held, crossing)

    const file = await this.env.DB.prepare('select * from notes where id = ? and deleted = 0')
      .bind(held.noteId)
      .first<Note>()

    // The note was deleted while the room was open. There is nothing to write
    // it into, and putting it back is Recently deleted's job, not a room's.
    if (!file) return false

    // The note moved to sync v2 while this room held it as v1: the room starts the
    // note's document, keeping what it held that the note does not have yet, and
    // settles as a document from then on (section 11, step 3).
    if ((file.epoch ?? 0) >= 1) {
      await this.startEpoch(held, placedOf(file), await this.carried(held))
      await this.settleSoon()
      return false
    }

    // The file is not the kind of thing this room holds any more: it was renamed
    // across the two while the room was open, and writing now would be the settle
    // reading the document through the wrong serialiser - which is how a canvas
    // came to be written over with nothing. What the room holds stays in the room,
    // where the next join's changeover writes it; see `crossed`, whose own settle
    // is the one that is meant to cross.
    if (!crossing && roomKind(file.path) !== held.kind) {
      noted(
        `room ${held.noteId}`,
        new Error(`the file is a ${roomKind(file.path)} room now and this one holds ${held.kind}`),
        null,
      )
      return false
    }

    const settled = fileOf(held.kind, this.state.doc)
    const size = byteLength(settled)
    if (size > MAX_NOTE_BYTES) return false

    // A drawing this settle would leave behind, which is the other half of the same
    // mistake and the one that catches it wherever it came from: a room an older
    // build already wrote the wrong kind into, or a client that joined a note's
    // room with a canvas in its hands. See `leavesAPlane`.
    if (leavesAPlane(held.kind, this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room holds a plane and is read as words'), null)
      return false
    }

    // And nothing over something, where the nothing is a document that never
    // arrived rather than a note somebody emptied; see `neverHeld`. The last line
    // there is: no settle writes a file with less in it than it started with
    // because a read came back quiet.
    if (!settled && file.size > 0 && neverHeld(this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room never held the file it would empty'), null)
      return false
    }

    // Nothing of the room's own to say. The document holds exactly the words this
    // room last wrote down, so whatever the note says now was written by something
    // that is not this room, and it is simply the truth: there is nothing here to put
    // on top of it, and nothing of anybody's to keep beside it either.
    //
    // It used to write anyway, because a settle wrote whatever it held. A note open
    // in a tab and joined to its room, with the pass on that same machine pushing the
    // file a moment before the room had said it was carrying it, came back to the
    // words the room was seeded with - and the push was kept beside the note as
    // somebody else's copy, on a machine that has only ever had one device.
    //
    // Which words the room is level with is written down at the moment it becomes
    // true, never worked out afterwards from two versions failing to match. The
    // crossing settle is the one write that must land whatever it holds; see
    // `crossed`.
    if (!crossing && held.hash !== undefined && (await sha256(settled)) === held.hash) {
      return file.hash === held.hash
    }

    // Only a note that grew can take an account past what it may keep, and
    // working out what an account is using reads every note it holds. A limit
    // nobody enforces is a number on a settings page; one worked out on every
    // settle is a note that is slow to write in.
    if (size > file.size) {
      const owner = await this.env.DB.prepare('select user_id from spaces where id = ?')
        .bind(file.space_id)
        .first<{ user_id: string }>()

      // The words stay in the room and in every editor showing it; what does not
      // happen is the account growing past its quota.
      if (owner && !(await fits(this.env, owner.user_id, size, file.size))) return false
    }

    // Somebody saved the same note between the row being read above and the
    // write - a device that was offline pushing what it had, say. The room is
    // still holding the words, so the answer is to come round again and write
    // them on top of what landed rather than to write over it from a row that
    // was already stale.
    // Something that is not this room wrote the note while the room held it. The
    // settle below is a whole-file write, so every word in that version which the
    // room does not have would go with it - and those words are not the room's to
    // drop. What happens instead is what the app does with the same question, which
    // is to keep the other copy beside the note; see `keptBeside`.
    if (held.version !== undefined && file.version !== held.version) {
      await this.keptBeside(file, settled, held.kind)
    }

    const saved = await saveNote(this.env, file, settled, file.path, this.settling)
    if (!saved) {
      await this.settleSoon()
      return false
    }

    // Which version the room is level with now, and what it said, so the next settle
    // asks both questions against this one rather than against the one before it.
    held.version = saved.version
    held.hash = saved.hash
    await this.ctx.storage.put('note', held)

    // Said once. Whoever types next is whose the next version is, and a settle that
    // writes nothing new must not put this name on it.
    this.settling = ''
    return true
  }

  /* ── Sync v2: the note's document ────────────────────────────────────── */

  /** The row that says which document this room should hold. */
  private placed(noteId: string): Promise<Placed | null> {
    return this.env.DB.prepare(
      'select version, path, epoch, epoch_base, hash, deleted from notes where id = ?',
    )
      .bind(noteId)
      .first<Placed>()
  }

  /** A join or a request said the note is on a newer epoch than this room holds: the
   *  room starts it now rather than at its next settle. */
  private async caughtUpWithEpoch(said: number | undefined): Promise<void> {
    const held = this.held
    if (!held || said === undefined || said <= (held.epoch ?? 0)) return

    const row = await this.placed(held.noteId)
    if (!row || row.epoch <= (held.epoch ?? 0)) return
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.startEpoch(held, row, await this.carried(held))
    })
  }

  /** What this room holds that the note does not say yet: the words typed since its
   *  last settle, or null when it holds nothing of its own. */
  private async carried(held: Held): Promise<string | null> {
    if (neverHeld(this.state.doc)) return null
    const mine = fileOf(held.kind, this.state.doc)
    if (held.hash !== undefined && (await sha256(mine)) === held.hash) return null
    return mine
  }

  /** The room holds the note's document at the epoch its row names, from now on.
   *
   *  The seed is the words the epoch was seeded from - which is the note as it reads
   *  now, because once a note has an epoch nothing but its room writes it - put in
   *  under `hash32(noteId, epoch)`, byte for byte what any device seeding the same
   *  words makes (section 5.3). Two things can make the words not be there: somebody
   *  writing between the epoch being marked and the room reading (the version the
   *  account kept of them serves then, and what was written since goes in as
   *  operations), or nothing keeping them at all, when the note starts the next epoch
   *  from what it says and every device on the old one falls back to its three-way
   *  path.
   *
   *  What the room held before - a v1 room's words, or an older epoch's - is not
   *  dropped: `carried` goes in as operations on top of the seed, under the room's own
   *  id. Only where somebody else wrote the note since this room last settled does it
   *  go beside the note instead, which is what a v1 room would have done with it.
   *
   *  Every socket is closed first, because none of them can merge into a new document:
   *  a v2 device hears the new epoch and 4001, and a v1 app 1012 - the one code its own
   *  join logic reads as "this room was rebuilt, meet it again from your file". */
  private async startEpoch(held: Held, row: Placed, carried: string | null): Promise<void> {
    const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
    const body = object ? await object.text() : ''
    const bodyHash = await sha256(body)

    let epoch = row.epoch
    let base = row.epoch_base ?? bodyHash
    let seed: string | null = bodyHash === base ? body : null
    if (seed === null) {
      const kept = await this.env.NOTES.get(versionKey(base))
      if (kept) seed = await kept.text()
    }
    if (seed === null) {
      await this.env.DB.prepare(
        'update notes set epoch = ?, epoch_base = ? where id = ? and epoch = ?',
      )
        .bind(epoch + 1, bodyHash, held.noteId, epoch)
        .run()
      const again = await this.placed(held.noteId)
      epoch = again?.epoch ?? epoch + 1
      base = again?.epoch_base ?? bodyHash
      seed = body
    }

    // Written in before the note was last written by somebody else: kept beside it,
    // since there is no ancestor to fold it in against.
    let target = body
    if (carried !== null) {
      if (held.hash === undefined || held.hash === bodyHash) target = carried
      else await this.besideTheNote(held, carried)
    }

    await this.closeForEpoch(epoch, base)
    await this.state.clear()
    this.state.doc.destroy()
    this.awareness.destroy()
    this.state = new RoomState(this.ctx.storage)
    this.awareness = new Awareness(this.state.doc)
    this.listen()

    Y.applyUpdateV2(this.state.doc, seedOf(held.kind, held.noteId, epoch, seed), PUSHED)
    const seeded = fileOf(held.kind, this.state.doc)
    held.epoch = epoch
    held.epochBase = base
    held.version = row.version
    held.hash = await sha256(seeded)
    delete held.snapshot

    const update = ingested(held.kind, this.state.doc, held.noteId, seeded, target)
    if (update) Y.applyUpdateV2(this.state.doc, update, PUSHED)

    await this.state.compact()
    await this.ctx.storage.put('note', held)
  }

  /** Words this room held that the note cannot take, as a note beside it; see
   *  `startEpoch`. */
  private async besideTheNote(held: Held, words: string): Promise<void> {
    const file = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    if (file && !(await noteBeside(this.env, file, words, this.settling))) {
      noted(`room ${held.noteId}`, new Error('there was nowhere free to keep it'), null)
    }
  }

  /** Every socket closed, because the document they were joined to is gone; see
   *  `startEpoch`. */
  private async closeForEpoch(epoch: number, base: string): Promise<void> {
    const sockets = this.ctx.getWebSockets()
    for (const socket of sockets) {
      forget(this.awareness, announcedBy(socket), socket)
      try {
        if (speaksV2(socket)) {
          socket.send(epochFrame(epoch, base))
          socket.close(NEW_EPOCH, 'this note starts a new document')
        } else {
          socket.close(REBUILT, 'this note starts a new document')
        }
      } catch {
        // A socket the runtime already gave up on is closed either way.
      }
    }

    // A close this side asked for brings no close handler with it.
    if (sockets.length && this.held) {
      await this.env.DB.prepare('delete from room_sockets where note_id = ?')
        .bind(this.held.noteId)
        .run()
    }
  }

  /** The document as it is written down, with its version and state vector, read in
   *  the same moment: what an answer may name, since nothing in it can be lost. */
  private async durable(): Promise<{
    bytes: Uint8Array
    seq: number
    sv: Uint8Array
    at: number
  }> {
    await this.state.flushAll()
    // Nothing between the last write and these reads: the runtime delivers nothing
    // while a storage write is on its way, and there is no await from here on.
    return {
      bytes: Y.encodeStateAsUpdateV2(this.state.doc),
      seq: this.state.seq,
      sv: Y.encodeStateVector(this.state.doc),
      at: this.state.changedAt,
    }
  }

  /** A document's settle: the words into the note store as any save, the snapshot
   *  into the bucket, and every v2 socket told what is now durable (section 5.10).
   *
   *  Where a v1 room's settle keeps a copy beside a note somebody else wrote, this one
   *  has nobody else to meet: once a note has an epoch, its room is its only writer.
   *  Words landing on a note that was deleted meanwhile bring it back, with its
   *  folders, because an edit beats a delete (section 5.9). */
  private async settleDocument(held: Held, crossing: boolean): Promise<boolean> {
    let file = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    if (!file) return false

    if ((file.epoch ?? 0) > (held.epoch ?? 0)) {
      await this.startEpoch(held, placedOf(file), await this.carried(held))
      await this.settleSoon()
      return false
    }

    // The same four refusals as a v1 settle, for the same reasons; see below.
    if (!crossing && roomKind(file.path) !== held.kind) {
      noted(`room ${held.noteId}`, new Error(`the file is a ${roomKind(file.path)} room now`), null)
      return false
    }
    const settled = fileOf(held.kind, this.state.doc)
    const size = byteLength(settled)
    if (size > MAX_NOTE_BYTES) return false
    if (leavesAPlane(held.kind, this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room holds a plane and is read as words'), null)
      return false
    }
    if (!settled && file.size > 0 && neverHeld(this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room never held the file it would empty'), null)
      return false
    }

    if (crossing || (await sha256(settled)) !== held.hash) {
      if (file.deleted) {
        await revive(this.env, held.spaceId, this.settlingDevice, held.noteId)
        file = await this.env.DB.prepare('select * from notes where id = ? and deleted = 0')
          .bind(held.noteId)
          .first<Note>()
        if (!file) return false
      }

      if (size > file.size) {
        const owner = await this.env.DB.prepare('select user_id from spaces where id = ?')
          .bind(file.space_id)
          .first<{ user_id: string }>()
        if (owner && !(await fits(this.env, owner.user_id, size, file.size))) return false
      }

      const saved = await saveNote(this.env, file, settled, file.path, this.settling, {
        epoch: held.epoch ?? 0,
        ...(this.settlingDevice === undefined ? {} : { docBy: this.settlingDevice }),
      })
      if (!saved) {
        await this.settleSoon()
        return false
      }

      held.version = saved.version
      held.hash = saved.hash
      if (saved !== file) {
        await pokeSpace(this.env, this.ctx, held.spaceId, saved.seq, this.settlingDevice)
      }
    }

    const durable = await this.durable()
    if (held.snapshot !== durable.seq) {
      await this.env.NOTES.put(snapshotKey(held.noteId), durable.bytes, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: {
          seq: String(durable.seq),
          epoch: String(held.epoch ?? 0),
          epochBase: held.epochBase ?? '',
          at: String(durable.at),
        },
      })
      held.snapshot = durable.seq
    }
    await this.ctx.storage.put('note', held)

    // Every v2 socket hears what is durable now, which is what moves its pending
    // edits into what it has confirmed.
    const ack = ackFrame(durable.seq, durable.sv)
    for (const socket of this.ctx.getWebSockets()) {
      if (!speaksV2(socket)) continue
      try {
        socket.send(ack)
      } catch {
        // Its close handler takes care of it.
      }
    }

    this.settling = ''
    this.settlingDevice = undefined
    return true
  }

  /** A device's pending edits, arriving by HTTP (section 5.4): applied and written
   *  down before the answer when they were made on the version the room is at, and
   *  answered `moved` - with what the device is missing - when the room has moved on
   *  since, so the device whose edits arrive second is the one that checks. */
  private async push(body: Uint8Array): Promise<Uint8Array> {
    const pushed = pushedIn(unframe(body))
    const held = this.held
    if (!pushed || !held) return frame({ refused: 'gone' } satisfies RoomAnswer)
    if (pushed.epoch !== (held.epoch ?? 0)) {
      return frame({ epoch: held.epoch ?? 0 } satisfies RoomAnswer)
    }

    // Sent before, and its answer lost: the same answer again.
    const remembered = rememberedIn(await this.ctx.storage.get('pushes'))
    const before = remembered.find((one) => one.push === pushed.push)
    if (before) return frame({ ok: true, seq: before.seq, sv: before.sv } satisfies RoomAnswer)

    if (pushed.update.length > MOST_UPDATE_BYTES || this.state.full()) {
      return frame({ refused: 'large' } satisfies RoomAnswer)
    }

    if (pushed.seq !== this.state.seq) {
      await this.state.flushAll()
      try {
        return frame({
          moved: Y.encodeStateAsUpdateV2(this.state.doc, pushed.base),
          seq: this.state.seq,
          sv: Y.encodeStateVector(this.state.doc),
          at: this.state.changedAt,
        } satisfies RoomAnswer)
      } catch {
        // A state vector that does not read as one names no state to diff against.
        return frame({ refused: 'gone' } satisfies RoomAnswer)
      }
    }

    this.settling = deviceIn(pushed.name)
    this.settlingDevice = pushed.device
    try {
      Y.applyUpdateV2(this.state.doc, pushed.update, PUSHED)
    } catch {
      return frame({ refused: 'gone' } satisfies RoomAnswer)
    }

    // The version and state this push brought the document to, read before anything
    // else can arrive: a socket's keystrokes landing while it is written down belong
    // to a later version, which this device has not seen and must meet as `moved`.
    const seq = this.state.seq
    const sv = Y.encodeStateVector(this.state.doc)
    await this.state.flushAll()
    await this.ctx.storage.put('pushes', [...remembered, { push: pushed.push, seq, sv }].slice(-REMEMBERED_PUSHES))
    await this.settleSoon()

    return frame({ ok: true, seq, sv } satisfies RoomAnswer)
  }

  /** What a device is missing, against its state vector: for a pull the bucket could
   *  not answer, which is only ever a note whose snapshot is not there yet. */
  private async pull(body: Uint8Array): Promise<Uint8Array> {
    const asked: unknown = unframe(body)
    const sv = (asked as { sv?: unknown } | null)?.sv
    const held = this.held
    if (!(sv instanceof Uint8Array) || !held) return frame({ refused: 'gone' })

    await this.state.flushAll()
    try {
      return frame({
        update: Y.encodeStateAsUpdateV2(this.state.doc, sv),
        seq: this.state.seq,
        epoch: held.epoch ?? 0,
        epochBase: held.epochBase ?? '',
      })
    } catch {
      return frame({ refused: 'gone' })
    }
  }

  /** A whole text, from something with no document of its own - a v1 app's save, the
   *  connector, a rollback - taken in as the operations it differs by, under the room's
   *  own id (section 5.10). What the room held unsettled is settled first, so a v1
   *  save naming the version it edited is judged against the words the room really
   *  holds: equal, and the text goes in; older, and the answer is the 409 a v1 app has
   *  always had for a note that moved. Settled at once, so the caller answers with the
   *  note as it now stands. */
  private async ingest(body: Uint8Array): Promise<Ingested> {
    const asked = ingestIn(body)
    const held = this.held
    if (!asked || !held || (held.epoch ?? 0) < 1) return { refused: 'gone' }

    if ((await sha256(fileOf(held.kind, this.state.doc))) !== held.hash) await this.settle()

    const row = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    if (!row) return { refused: 'gone' }
    if (asked.base !== undefined && row.version !== asked.base) return { conflict: true }

    const current = fileOf(held.kind, this.state.doc)
    const update = ingested(held.kind, this.state.doc, held.noteId, current, asked.text)
    if (!update) return { note: row }

    this.settling = deviceIn(asked.name)
    this.settlingDevice = asked.device
    Y.applyUpdateV2(this.state.doc, update, PUSHED)
    await this.state.flushAll()
    if (!(await this.settle())) return { refused: 'unsaved' }

    const after = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    return after ? { note: after } : { refused: 'gone' }
  }

  /** The note as it stands, kept as a second note beside it, because the settle is
   *  about to write over it and the room never saw what it says.
   *
   *  A room merges keystroke by keystroke and can only do that for keystrokes it saw.
   *  A device whose socket is down pushes the whole file it holds instead, and the
   *  account takes it: the push names the version it read, so nothing on that side is
   *  wrong. But the room is still holding words of its own, and one of the two has to
   *  be written second. So neither is thrown away - the one that loses the note keeps
   *  the name every other copy of a note takes, and both devices are handed it by the
   *  next pass. Which is the same answer, under the same name, that a pass gives when
   *  it finds two copies of a note; see sync/conflicts.ts in the app.
   *
   *  Nothing is kept when the two say the same thing, which is the ordinary case: the
   *  version moved because something renamed the note or wrote the very words the
   *  room is about to write. Best effort past that - a copy that could not be made is
   *  said out loud and the settle carries on, because a note that cannot be saved at
   *  all is worse than one whose second copy is only in the version history. */
  private async keptBeside(file: Note, settling: string, kind: RoomKind) {
    try {
      const object = await this.env.NOTES.get(noteKey(file.space_id, file.id))
      const wrote = object ? await object.text() : ''
      if (!wrote || wrote === settling) return

      // And nothing is kept where this settle would drop none of it. What the copy is
      // for is the words in a version the room never saw; where the change that turns
      // that version into what the room holds only inserts, there are none of them -
      // every word of it is inside what is about to be written.
      //
      // Which is what one device looks like from in here. Its pass pushed the file a
      // keystroke before the room settled the same document, so the version the room
      // never saw is the version the room is about to write, a letter shorter. A copy
      // of your own paragraph is not an answer to anything, and three of them turned
      // up on Emil's disk on three consecutive mornings. Read off the two texts rather
      // than off the version numbers, because a version that moved says that something
      // wrote, never what it wrote.
      //
      // Words only. A plane's file is a serialisation rather than prose, and two of
      // them sharing a front and a back says nothing about the objects on it.
      if (kind === 'words') {
        const change = fold(wrote, settling)
        if (!change || change.from === change.to) return
      }

      if (!(await noteBeside(this.env, file, wrote))) {
        throw new Error('there was nowhere free to keep it')
      }
    } catch (wrong) {
      noted(`room ${file.id}`, wrong instanceof Error ? wrong : new Error(String(wrong)), null)
    }
  }
}

function placedOf(note: Note): Placed {
  return {
    version: note.version,
    path: note.path,
    epoch: note.epoch ?? 0,
    epoch_base: note.epoch_base ?? null,
    hash: note.hash,
    deleted: note.deleted,
  }
}

/** What the awareness protocol reports when its map changes. */
interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

function isSocket(value: unknown): value is WebSocket {
  return typeof value === 'object' && value !== null && 'serializeAttachment' in value
}
