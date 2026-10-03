/** An open note's document, carried live through its room under sync v2.
 *
 *  Under v1 a room holds a document of its own for the sitting and brings the note's
 *  file to it on joining (room.ts, join.ts). Under v2 the document is the engine's and
 *  outlives the room: it is already joined to the note (sync2/binding.ts), and the room
 *  is only the fastest road for its updates - in as other devices type, out as this one
 *  does - with the meeting on joining the engine's to decide (`Carrying`). So what is
 *  here is that door, and the rest of being in a room: who else is there, and where
 *  their carets are - or, on a canvas, their hands.
 *
 *  Only sync v2 reaches this module, after the launch (sync2/carry.ts), so none of it is
 *  in front of the first paint or in the glasses' plugin. */

import { setPeers, type SharedDoc } from '@nib/editor'
import { readSync, receive, syncStep1Of, syncStep2Of, TEXT } from '@nib/rooms'
import { NEW_EPOCH, roomNews, ROOM_V2 } from '@nib/sync-core/wire'
import * as Y from 'yjs'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'
import { type Opening, ROOM, RoomDoor } from './door'
import { HAND, handsIn, saidHand } from './hands'
import { type Entering, JoinedRoom } from './joined'
import { peersIn, relative } from './peers'

/** Sync v2 (docs/sync-v2.md sections 5.2 to 5.4): what the room carries is a document
 *  the engine keeps, and what the room says to it.
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

/** The door a carried document comes in by: v1's, with the meeting above. */
class CarryingDoor extends RoomDoor {
  /** A document with pending edits meeting the room: nothing the room says is applied,
   *  and nothing typed is sent, until the engine has classified. The room's question
   *  and its updates wait here meanwhile. */
  private meeting = false
  private asked: Uint8Array | null = null
  private waiting: Uint8Array[] = []

  constructor(
    opening: Opening,
    private readonly carrying: Carrying,
  ) {
    super(opening, carrying.doc, [ROOM_V2, `nib.device.${carrying.device}`])
  }

  /** Meets the room afresh on every connection: what the document holds may have moved
   *  on, from a pass, while the socket was down. */
  protected override greet() {
    this.meeting = this.carrying.pending()
    this.asked = null
    this.waiting = []
    this.greeted = false
    this.settled = false
    super.greet()
  }

  protected override question(): Uint8Array {
    return this.meeting ? syncStep1Of(this.carrying.confirmedSv()) : super.question()
  }

  protected override sending(): boolean {
    return !this.meeting
  }

  /** A new epoch is the room rebuilt: whoever joined it joins again. */
  protected override went(code: number, said: string) {
    this.carrying.live(false)
    if (code === NEW_EPOCH) {
      this.socket.stop()
      this.opening.gone()
      return
    }
    super.went(code, said)
  }

  protected override async hear(message: Uint8Array) {
    const news = roomNews(message)
    if (news?.t === 'ack') this.carrying.acked(news.seq, news.sv)
    if (news?.t === 'epoch') this.carrying.epoch(news.epoch, news.epochBase)
    if (news) return
    if (this.meeting) await this.meet(message)
    else await super.hear(message)
  }

  protected override async together() {
    await super.together()
    this.carrying.live(true)
  }

  /** The engine's document outlives the room. */
  protected override dropped() {
    this.carrying.live(false)
  }

  /** What the room says while a document with pending edits meets it. */
  private async meet(message: Uint8Array) {
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

    if ((await this.carrying.met(sync.update)) === 'hold') {
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

export interface Carried extends Entering {
  /** The note's views, which hear who else is there. */
  note: SharedDoc
  carrying: Carrying
}

export class CarriedRoom extends JoinedRoom {
  constructor(private readonly carried: Carried) {
    super(carried)
  }

  protected override opened(entering: Entering, opening: Opening): RoomDoor {
    return new CarryingDoor(opening, (entering as Carried).carrying)
  }

  /** Whether the room is carrying the document now. */
  get settled(): boolean {
    return this.door.caughtUp
  }

  /** Where this device's caret is, on its way to the others; see Room.moved. */
  moved(anchor: number, head: number) {
    const text = this.door.doc.getText(TEXT)
    this.door.announce('caret', () => ({
      anchor: relative(text, anchor),
      head: relative(text, head),
    }))
  }

  leave() {
    this.left = true
    this.door.leave()
    this.carried.note.announce([setPeers.of([])])
    this.carried.onPeers(0)
  }

  /** Nothing to bring together: the engine met the room before this, and the note was
   *  joined to the document before the room was. */
  protected together() {
    return undefined
  }

  protected showPresent() {
    const { present, carets } = peersIn(this.door.awareness, this.door.doc, this.scheme)
    this.carried.note.announce([setPeers.of(carets)])
    this.carried.onPeers(present)
  }
}

export interface CarriedPlane extends Entering {
  /** The canvas on screen, which draws the other hands. */
  surface: PlaneSurface
  carrying: Carrying
}

/** A canvas or a page note's document, carried the same way: the plane is joined to it
 *  without the room (sync2/binding.ts), and the room is the road and the hands. */
export class CarriedPlaneRoom extends JoinedRoom {
  constructor(private readonly carried: CarriedPlane) {
    super(carried)
  }

  protected override opened(entering: Entering, opening: Opening): RoomDoor {
    return new CarryingDoor(opening, (entering as CarriedPlane).carrying)
  }

  get settled(): boolean {
    return this.door.caughtUp
  }

  /** Where this hand is, on its way to the others; see PlaneRoom.hand. */
  hand(at: Point | null, drawing: InkStroke | null) {
    this.door.announce(HAND, () => (at ? saidHand(at, drawing) : null))
  }

  /** A canvas has no caret. */
  moved() {
    return undefined
  }

  leave() {
    this.left = true
    this.door.leave()
    this.carried.surface.handsAre([])
    this.carried.onPeers(0)
  }

  protected together() {
    return undefined
  }

  protected showPresent() {
    const { present, hands } = handsIn(this.door.awareness, this.door.doc, this.scheme)
    this.carried.surface.handsAre(hands)
    this.carried.onPeers(present)
  }
}
