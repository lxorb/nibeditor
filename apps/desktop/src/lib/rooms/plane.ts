/** One open canvas, joined to the room the other devices are drawing on.
 *
 *  The same room a note has, about a different kind of file: one Durable Object,
 *  the same socket, the same protocol, the same greeting, the same awareness. What
 *  differs is what the shared document holds - a map of the objects on the plane
 *  rather than one text - and what a device says about itself: where its pointer is
 *  and the stroke under its pen, so a line appears as it is being drawn rather than
 *  when the pen lifts.
 *
 *  The socket and the greeting are in door.ts, and joining is in joined.ts, both of
 *  which the note's room shares. The plane and the file are in plane-bind.ts. What is
 *  here is the join of the two, and the hands. */

import type { Canvas, InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface, SharedPlane } from '../canvas/shared'
import { HAND, handsIn, saidHand } from './hands'
import { type Entering, JoinedRoom } from './joined'
import { PlaneBinding } from './plane-bind'

/** What a canvas's room is joined on behalf of. */
export interface Drawing extends Entering {
  /** The plane as the app holds it, which is what the surface draws. */
  surface: PlaneSurface
  /** Whether the surface above is still on the file this room was joined for.
   *
   *  A note's room asks the same question and says why at length; see
   *  `Joining.holds` in room.ts. Nothing in the app hands a canvas tab another canvas
   *  today - a plane arrives with its surface and goes with it - so nothing reaches
   *  this yet. It is here because the question is the room's, not the note's: a room
   *  that pushes into the wrong file is the same accident whichever kind of file it
   *  is, and the guard must not be the thing that was missing on the day a canvas tab
   *  learns to adopt one. See `join` in rooms.svelte.ts, which answers it for both. */
  holds: () => boolean
}

export class PlaneRoom extends JoinedRoom implements SharedPlane {
  private readonly binding: PlaneBinding

  constructor(private readonly joining: Drawing) {
    super(joining)
    this.binding = new PlaneBinding(this.door.doc, joining.surface, () => this.holds())
  }

  /** Whether the plane and the room now hold the same objects, and every stroke
   *  from here goes both ways. False until the room has answered, which is when the
   *  file sync still owns the file; see rooms.svelte.ts. */
  get settled(): boolean {
    return this.door.caughtUp
  }

  push(before: Canvas, after: Canvas) {
    this.binding.push(before, after)
  }

  undo(): boolean {
    return this.binding.undo()
  }

  redo(): boolean {
    return this.binding.redo()
  }

  /** Where this hand is, on its way to the others. Worked out when the message goes
   *  rather than now, and one message a frame at most: a pen reports a hundred
   *  points a second and nobody can watch that. */
  hand(at: Point | null, drawing: InkStroke | null) {
    this.door.announce(HAND, () => (at ? saidHand(at, drawing) : null))
  }

  leave() {
    this.left = true
    this.joining.surface.shared = null
    this.joining.surface.handsAre([])
    this.binding.part()
    this.door.leave()
    this.joining.onPeers(0)
  }

  /** The room's plane and this device's, brought together, and the surface handed
   *  the room from here on. Nothing was pushed and nothing was watched until now:
   *  what the room holds and what this device drew have to be compared rather than
   *  one landing on the other.
   *
   *  Joining is a round trip, and a canvas that moved on inside it is a plane these
   *  objects are no longer: neither side is anybody's news then, and merging would
   *  write one file's drawing into another's. */
  protected together() {
    if (!this.holds()) return

    this.binding.together()
    this.joining.surface.shared = this
  }

  /** Who is on the plane, for the surface to draw and for the tab to count. */
  protected showPresent() {
    const { present, hands, seen } = handsIn(this.door.awareness, this.door.doc, this.scheme)

    this.joining.surface.handsAre(hands)
    this.joining.onPeers(present, seen)
  }
}
