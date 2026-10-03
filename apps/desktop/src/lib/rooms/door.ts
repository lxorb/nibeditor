/** The half of a room that is the same whatever the room is about.
 *
 *  A note and a canvas are both one file open on several devices, and almost
 *  everything about being in a room is the same for either: a socket that comes
 *  back when it goes, a Yjs document whose updates go out and whose arrivals come
 *  in, an awareness that says who is here, a greeting, and the moment the room has
 *  finished saying what it holds. That is all here.
 *
 *  What is not here is what the document holds and what to do when the room and
 *  this device disagree. A note settles that as one text; a canvas settles it
 *  object by object. Those are next door, in room.ts and plane.ts.
 *
 *  Nothing this device says goes out at once. A caret moves every few
 *  milliseconds while an arrow key is held and a pen reports a hundred points a
 *  second, and neither is something anybody can watch: what a device says about
 *  itself is coalesced into one message a frame, and the value is worked out when
 *  the message goes rather than when it was asked for, so what travels is where
 *  the hand is now. */

import {
  awarenessUpdate,
  forget,
  isCatchUp,
  readSync,
  receive,
  syncStep1,
  syncStep1Of,
  syncStep2Of,
  syncUpdate,
} from '@nib/rooms'
import { NEW_EPOCH, roomNews, ROOM_V2 } from '@nib/sync-core/wire'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { RoomSocket } from './socket'

/** How long anything this device says about itself waits before it is sent. A
 *  caret that landed where somebody clicked is still announced well inside the
 *  time it takes to see it get there, and a held key or a moving pen costs one
 *  message rather than thirty. */
const SAY_DELAY = 40

/** Where an update arriving from the room is marked as having come from. */
const ROOM = 'room'

/** And where one made on this device is. Both rooms mark their own transactions
 *  with it, which is how neither of them echoes a change back the way it came and
 *  how an undo knows which changes were yours. */
export const HERE = 'here'

/** The code the service closes a socket with when it has thrown the room away and
 *  will build another - because the file behind it is a different kind of file now;
 *  see `crossed` in services/sync/src/rooms/room.ts.
 *
 *  It is not a connection that went. What comes next is a room built afresh out of
 *  the file, which is a different document with a history of its own, and this
 *  device's copy must not be reconnected to it: merging two documents that were
 *  seeded from the same words separately is those words twice over. So the socket is
 *  not retried and the room is let go instead, to be joined again from nothing - the
 *  one path that ends in the meeting, where what each side holds is compared rather
 *  than added together. See `gone` below, and rooms.svelte.ts. */
const REBUILT = 1012

/** The room will take no more keystrokes: its document has reached the size a
 *  document may be, and the closing words say so.
 *
 *  1009 is the web socket's own "message too big", which is exactly this: the room
 *  refuses the update rather than applying it, because an update applied is in the
 *  document for good. Not retried either, for the same reason `REBUILT` is not -
 *  reconnecting changes nothing, and a socket that came back to be closed on the next
 *  keystroke would be a room saying the same thing all afternoon. The note itself
 *  goes on saving the ordinary way, where a file too large is refused in as many
 *  words; see `full` in services/sync/src/rooms/state.ts. */
const TOO_LARGE = 1009

/** Sync v2 (docs/sync-v2.md sections 5.2 to 5.4): the room carries a document the
 *  engine keeps, rather than one of its own made for the sitting.
 *
 *  A document with nothing pending meets the room the ordinary way. One holding edits
 *  the account has not acknowledged opens with its *confirmed* state vector, so what the
 *  room sends back is the account's words beyond it and nothing of this device's own;
 *  reads everything else the room says without applying it; and hands the catch-up to
 *  the engine to classify (`met`). Only once that says go does it send what it holds -
 *  the protocol's own answer to the room's question, made then - and join. A held note
 *  stays out of the room, and nothing the room said is in its document. */
export interface Carrying {
  doc: Y.Doc
  /** This device's id, which the room writes the words down as. */
  device: string
  pending(): boolean
  confirmedSv(): Uint8Array
  /** The room's catch-up, as y-protocols encodes it: `go` once the engine has taken it
   *  into the document, `hold` when the note waits for its person. */
  met(update: Uint8Array): Promise<'go' | 'hold'>
  /** The room made this much durable at its settle. */
  acked(seq: number, sv: Uint8Array): void
  /** The room is starting the document again at a new epoch, and will close. */
  epoch(epoch: number, base: string): void
  /** Whether the room is carrying the document live: caught up and connected. */
  live(on: boolean): void
}

/** What this device calls itself in a room, and the colour it wears there. Both
 *  names travel; which one is drawn belongs to whoever is looking. See who.ts. */
export interface Who {
  name: string
  accent: string
  person?: string | undefined
}

export interface Opening {
  /** The file's id on the account, which is what names its room. */
  noteId: string
  token: string
  who: Who
  /** The room has finished saying what it holds, which is when this device's own
   *  copy may be compared with it. Runs once. */
  caughtUp: () => Promise<void> | void
  /** Somebody arrived, left, or moved. */
  present: () => void
  /** The room on the other end is not coming back: it was thrown away and another
   *  will be built out of the file. Nothing here can carry on, so whoever joined
   *  this room is asked to let it go and join again; see `REBUILT`. */
  gone: () => void
  /** The room will take no more keystrokes, and the words it closed with say why.
   *  Said once rather than on every keystroke: the room is let go rather than
   *  rejoined, so there is nothing left to refuse. See `TOO_LARGE`. */
  refused: (said: string) => void
  /** Sync v2: the engine's document, and what the room says to it; see `Carrying`. */
  carrying?: Carrying
}

export class RoomDoor {
  readonly doc: Y.Doc
  readonly awareness: Awareness

  /** What this device says about itself. Kept because the person at it can be
   *  renamed while the file is open. */
  private who: Who
  private readonly socket: RoomSocket
  /** Set once the room has said what it holds and this device has been brought
   *  together with it. */
  private settled = false
  /** Set the moment the room starts saying what it holds, so two answers landing
   *  together do not both bring this device together with it. */
  private greeted = false
  /** What this device has to say about itself and has not said yet, by field. The
   *  value is a function so that what goes out is worked out at the moment it
   *  goes: a caret is a position in the text as it now stands. */
  private saying = new Map<string, () => unknown>()
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Sync v2, a document with pending edits meeting the room: nothing the room says is
   *  applied, and nothing typed is sent, until the engine has classified; see
   *  `Carrying`. The room's question and its updates wait here meanwhile. */
  private meeting = false
  private asked: Uint8Array | null = null
  private waiting: Uint8Array[] = []

  constructor(private readonly opening: Opening) {
    this.doc = opening.carrying?.doc ?? new Y.Doc()
    this.awareness = new Awareness(this.doc)
    this.who = opening.who
    const carrying = opening.carrying
    this.socket = new RoomSocket(
      opening.noteId,
      opening.token,
      {
        opened: () => this.greet(),
        heard: (message) => void this.hear(message),
        closed: (code, said) => this.went(code, said),
      },
      carrying ? [ROOM_V2, `nib.device.${carrying.device}`] : [],
    )

    this.awareness.setLocalStateField('who', this.who)

    this.doc.on('update', this.sendOut)

    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange) => {
      const changed = [...added, ...updated, ...removed]
      if (changed.length) this.socket.send(awarenessUpdate(this.awareness, changed))

      this.opening.present()
    })

    this.socket.start()
  }

  /** Whether the room has said what it holds, this device's copy has been brought
   *  together with it, and it can still be reached.
   *
   *  All three, because this is what the file sync asks before it leaves a note to
   *  its room; see rooms.svelte.ts. A socket that has gone carries nothing: an
   *  update this device makes while it is down is dropped on the floor, and the
   *  room has no way to write it into the account. Saying "the room has this" then
   *  would leave the note's words on this machine and nowhere else for as long as
   *  the connection stayed away - which on a network that allows HTTPS and blocks
   *  WebSockets is forever, with the light in the corner saying everything is
   *  synced. While the socket is down the file is again the only way the words
   *  travel, which is exactly what a pass is for. */
  get caughtUp(): boolean {
    return this.settled && this.socket.open
  }

  /** What this device writes, on its way to the room: everything but what came out of
   *  it, and nothing while a v2 document is still meeting the room. */
  private readonly sendOut = (update: Uint8Array, origin: unknown) => {
    if (origin === ROOM || this.meeting) return
    this.socket.send(syncUpdate(update))
  }

  /** Something this device wants the others to know: where its caret is, where its
   *  hand is, what it is drawing. Coalesced, and held back until there is a
   *  document to say it against - so a caret that moved while joining is sent the
   *  moment there is a text to place it in rather than lost. */
  announce(field: string, value: () => unknown) {
    this.saying.set(field, value)
    this.sayLater()
  }

  /** Whoever is at this device is called something else now: a guest a link let
   *  in renaming themselves, or an account choosing a name.
   *
   *  Said at once rather than coalesced with the rest, and whether or not the
   *  room has answered yet: what it changes is a word the other people are
   *  reading over a caret or a hand, and it happens about as often as somebody
   *  is renamed. */
  rename(person: string | undefined) {
    if (person === this.who.person) return

    this.who =
      person === undefined
        ? { name: this.who.name, accent: this.who.accent }
        : { ...this.who, person }
    this.awareness.setLocalStateField('who', this.who)
  }

  leave() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket.stop()
    this.awareness.destroy()
    // A document the engine keeps outlives the room; only one made here goes with it.
    if (this.opening.carrying) {
      this.doc.off('update', this.sendOut)
      this.opening.carrying.live(false)
    } else {
      this.doc.destroy()
    }
  }

  /** One message a frame at most, with what to say worked out as it goes. */
  private sayLater() {
    if (this.timer || !this.settled || !this.saying.size) return

    this.timer = setTimeout(() => {
      this.timer = null
      const waiting = this.saying
      this.saying = new Map()
      for (const [name, held] of waiting) this.awareness.setLocalStateField(name, held())
    }, SAY_DELAY)
  }

  /** What this device says the moment the socket is up: what it holds, so the room
   *  can send back what it is missing, and who it is. */
  private greet() {
    const carrying = this.opening.carrying
    // A v2 document meets the room afresh on every connection: what it holds may have
    // moved on, from a pass, while the socket was down.
    if (carrying) {
      this.meeting = carrying.pending()
      this.asked = null
      this.waiting = []
      this.greeted = false
      this.settled = false
    }
    this.socket.send(
      this.meeting && carrying ? syncStep1Of(carrying.confirmedSv()) : syncStep1(this.doc),
    )

    // A room that was asleep has forgotten who is here, and this device has not:
    // saying it again is what puts the others' view of us back.
    if (this.awareness.getLocalState()) {
      this.socket.send(awarenessUpdate(this.awareness, [this.doc.clientID]))
    }
  }

  /** The connection went, and the code says whether it is coming back.
   *
   *  Almost always it is: a network that dropped, a deploy, a laptop that slept, and
   *  the socket is already waiting to try again. The one code that means otherwise is
   *  the room having been thrown away, and then there is nothing here to reconnect -
   *  the socket is stopped, which the socket allows from inside this very call, and
   *  whoever joined the room is asked to join another. */
  private went(code: number, said: string) {
    this.opening.carrying?.live(false)
    if (code === REBUILT || (this.opening.carrying && code === NEW_EPOCH)) {
      this.socket.stop()
      this.opening.gone()
      return
    }

    // The one close a reader has to hear about. Nothing is retried and nothing is
    // rebuilt: the words are this device's own from here, and whoever joined the
    // room is told so once; see `TOO_LARGE`.
    if (code === TOO_LARGE) {
      this.socket.stop()
      this.alone()
      this.opening.refused(said)
      return
    }

    this.alone()
  }

  /** Everybody else goes with the connection: where they are is no longer something
   *  this device knows. */
  private alone() {
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
    forget(this.awareness, others, 'gone')
  }

  private async hear(message: Uint8Array) {
    const carrying = this.opening.carrying
    if (carrying) {
      const news = roomNews(message)
      if (news?.t === 'ack') carrying.acked(news.seq, news.sv)
      if (news?.t === 'epoch') carrying.epoch(news.epoch, news.epochBase)
      if (news) return
      if (this.meeting) {
        await this.meet(carrying, message)
        return
      }
    }

    const answer = receive(message, this.doc, this.awareness, ROOM)
    if (answer) this.socket.send(answer)

    // The room has finished saying what it holds. Until now this device's own copy
    // has been left alone; this is where the two are brought together, once.
    if (this.greeted || !isCatchUp(message)) return

    this.greeted = true
    await this.together()
  }

  /** The room has said what it holds and this device's copy is brought together with
   *  it, once. */
  private async together() {
    await this.opening.caughtUp()
    this.settled = true
    this.opening.carrying?.live(true)
    this.sayLater()
    this.opening.present()
  }

  /** What the room says while a v2 document with pending edits meets it. */
  private async meet(carrying: Carrying, message: Uint8Array) {
    const sync = readSync(message)
    if (!sync) {
      // Who is there, which changes nothing in the document.
      receive(message, this.doc, this.awareness, ROOM)
      return
    }
    if (sync.kind === 'step1') {
      this.asked = sync.sv
      return
    }
    if (sync.kind === 'update') {
      this.waiting.push(sync.update)
      return
    }
    if (this.greeted) return
    this.greeted = true

    if ((await carrying.met(sync.update)) === 'hold') {
      // Held for the question: out of the room, and nothing of it read in.
      this.socket.stop()
      this.alone()
      return
    }

    for (const update of this.waiting) Y.applyUpdate(this.doc, update, ROOM)
    this.waiting = []
    this.meeting = false
    // What the room asked for, answered now: this device's pending edits and whatever
    // the classification settled, everything the room does not have.
    if (this.asked) this.socket.send(syncStep2Of(Y.encodeStateAsUpdate(this.doc, this.asked)))
    this.asked = null
    await this.together()
  }
}

/** What the awareness protocol reports when its map changes. */
interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}
