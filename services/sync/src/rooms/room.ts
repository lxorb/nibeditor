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
import { byteLength } from '../crypto'
import { note as noted } from '../failed'
import { MAX_NOTE_BYTES, noteBeside, noteKey, saveNote } from '../notes'
import { fits } from '../storage'
import type { Env, Note } from '../types'
import { deviceIn } from '../versions'
import {
  fileOf,
  fill,
  kindOf,
  leavesAPlane,
  neverHeld,
  roomKind,
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
}

/** What the door decided about the person on the other end of a socket. */
export interface Joining {
  writes: boolean
  who: string
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
  private readonly state: RoomState
  private readonly awareness: Awareness
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

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state = new RoomState(ctx.storage)
    this.awareness = new Awareness(this.state.doc)
    // A room is a place, not somebody in it, and it must be able to sleep; see
    // `unattended`.
    unattended(this.awareness)

    this.state.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.ctx.waitUntil(this.spread(update, origin))
    })

    this.awareness.on('update', (changed: AwarenessChange, origin: unknown) => {
      const clients = [...changed.added, ...changed.updated, ...changed.removed]
      if (!clients.length) return

      this.announced(origin, changed)
      this.send(awarenessUpdate(this.awareness, clients), origin)
    })
  }

  /** Two things arrive here, and the headers say which. A device joining, which
   *  the Worker has already decided about; or a route saying that somebody's
   *  access to this file has ended or narrowed since it did. */
  async fetch(request: Request): Promise<Response> {
    const revoked = request.headers.get('x-nib-revoked')
    if (revoked) return await this.revoke(revoked, request.headers.get('x-nib-role') === 'read')

    const noteId = request.headers.get('x-nib-note')
    const spaceId = request.headers.get('x-nib-space')
    if (!noteId || !spaceId) return new Response('no note', { status: 400 })

    const kind = kindOf(request.headers.get('x-nib-kind'))
    const pair = new WebSocketPair()
    await this.enter(
      pair[1],
      { noteId, spaceId, kind },
      {
        writes: writesOf(request.headers.get('x-nib-write')),
        who: request.headers.get('x-nib-who') ?? '',
      },
    )

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
        socket.serializeAttachment({
          clients: announcedBy(socket),
          mayWrite: false,
          who,
        } satisfies Attached)
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
      await this.ctx.storage.put('note', held)

      // A room with nothing stored of its own is filled from the file as the store
      // holds it. Only ever the first time: a plane somebody emptied is empty, and
      // seeding it again would put every card back.
      if (!(await this.state.load())) {
        const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
        const file = object ? await object.text() : ''
        await this.state.seed((doc) => fill(held.kind, doc, file))

        // And which version those words were, so that a settle can tell a note
        // nothing has touched since from one that something wrote while the room held
        // it; see `keptBeside`. Read after the bytes rather than before: a version
        // that moved in between then reads as one the room never saw, which is the
        // safe way round to be wrong.
        const row = await this.env.DB.prepare('select version from notes where id = ?')
          .bind(held.noteId)
          .first<{ version: number }>()

        if (row) {
          held.version = row.version
          await this.ctx.storage.put('note', held)
        }
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
    if (isSocket(origin)) this.settling = deviceOf(origin, this.awareness)

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

    origin.serializeAttachment({
      clients,
      mayWrite: mayWrite(origin),
      who: whoOf(origin),
    } satisfies Attached)
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

    const file = await this.env.DB.prepare('select * from notes where id = ? and deleted = 0')
      .bind(held.noteId)
      .first<Note>()

    // The note was deleted while the room was open. There is nothing to write
    // it into, and putting it back is Recently deleted's job, not a room's.
    if (!file) return false

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
      await this.keptBeside(file, settled)
    }

    const saved = await saveNote(this.env, file, settled, file.path, this.settling)
    if (!saved) {
      await this.settleSoon()
      return false
    }

    // Which version the room is level with now, so the next settle asks the same
    // question against this one rather than against the one before it.
    held.version = saved.version
    await this.ctx.storage.put('note', held)

    // Said once. Whoever types next is whose the next version is, and a settle that
    // writes nothing new must not put this name on it.
    this.settling = ''
    return true
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
  private async keptBeside(file: Note, settling: string) {
    try {
      const object = await this.env.NOTES.get(noteKey(file.space_id, file.id))
      const wrote = object ? await object.text() : ''
      if (!wrote || wrote === settling) return

      if (!(await noteBeside(this.env, file, wrote))) {
        throw new Error('there was nowhere free to keep it')
      }
    } catch (wrong) {
      noted(`room ${file.id}`, wrong instanceof Error ? wrong : new Error(String(wrong)), null)
    }
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
