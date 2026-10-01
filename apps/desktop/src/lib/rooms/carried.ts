/** An open note's document, carried live through its room under sync v2.
 *
 *  Under v1 a room holds a document of its own for the sitting and brings the note's
 *  file to it on joining (room.ts, join.ts). Under v2 the document is the engine's and
 *  outlives the room: it is already joined to the note (sync2/binding.ts), and the room
 *  is only the fastest road for its updates - in as other devices type, out as this one
 *  does - with the meeting on joining the engine's to decide (`Carrying` in door.ts). So
 *  what is here is the rest of being in a room: who else is there, and where their
 *  carets are. */

import { setPeers, type SharedDoc } from '@nib/editor'
import { TEXT } from '@nib/rooms'
import type { Carrying } from './door'
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
