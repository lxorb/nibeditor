/** An open note's document, carried live through its room under sync v2.
 *
 *  Under v1 a room holds a document of its own for the sitting and brings the note's
 *  file to it on joining (room.ts, join.ts). Under v2 the document is the engine's and
 *  outlives the room: it is already joined to the note (sync2/binding.ts), and the room
 *  is only the fastest road for its updates - in as other devices type, out as this one
 *  does - with the meeting on joining the engine's to decide (`Carrying` in door.ts). So
 *  what is here is the rest of being in a room: who else is there, and where their
 *  carets are - or, on a canvas, their hands. */

import { setPeers, type SharedDoc } from '@nib/editor'
import { TEXT } from '@nib/rooms'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'
import type { Carrying } from './door'
import { HAND, handsIn, saidHand } from './hands'
import { type Entering, JoinedRoom } from './joined'
import { peersIn, relative } from './peers'

export interface Carried extends Entering {
  /** The note's views, which hear who else is there. */
  note: SharedDoc
  carrying: Carrying
}

export class CarriedRoom extends JoinedRoom {
  constructor(private readonly carried: Carried) {
    super(carried)
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
