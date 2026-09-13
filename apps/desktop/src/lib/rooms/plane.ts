/** One open canvas, joined to the room the other devices are drawing on.
 *
 *  The same room a note has, about a different kind of file: one Durable Object,
 *  the same socket, the same protocol, the same greeting, the same awareness. What
 *  differs is what the shared document holds - a map of the objects on the plane
 *  rather than one text - and what a device says about itself: where its pointer is
 *  and the stroke under its pen, so a line appears as it is being drawn rather than
 *  when the pen lifts.
 *
 *  The socket and the greeting are in door.ts, which the note's room shares. The
 *  plane and the file are in plane-bind.ts. What is here is the join of the two, and
 *  the hands. */

import type { Canvas, InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface, SharedPlane } from '../canvas/shared'
import { RoomDoor, type Who } from './door'
import { HAND, handsIn, saidHand } from './hands'
import { PlaneBinding } from './plane-bind'

/** What a canvas's room is joined on behalf of. */
export interface Drawing {
  noteId: string
  token: string
  /** The plane as the app holds it, which is what the surface draws. */
  surface: PlaneSurface
  who: Who
  scheme: 'dark' | 'light'
  /** Told how many other devices are on the plane, whenever that changes. */
  onPeers: (present: number) => void
  /** The room was thrown away and another will be built out of the file; see
   *  `REBUILT` in door.ts. */
  gone: () => void
  /** The room will take no more strokes and said why; see `TOO_LARGE` in door.ts. */
  refused: (said: string) => void
  /** Whether the surface above is still on the file this room was joined for.
   *
   *  A note's room asks the same question and says why at length; see `holds` in
   *  room.ts. Nothing in the app hands a canvas tab another canvas today - a plane
   *  arrives with its surface and goes with it - so nothing reaches this yet. It is
   *  here because the question is the room's, not the note's: a room that pushes
   *  into the wrong file is the same accident whichever kind of file it is, and the
   *  guard must not be the thing that was missing on the day a canvas tab learns to
   *  adopt one. See `join` in rooms.svelte.ts, which answers it for both. */
  holds: () => boolean
}

export class PlaneRoom implements SharedPlane {
  private readonly door: RoomDoor
  private readonly binding: PlaneBinding
  private scheme: 'dark' | 'light'
  /** Whether this room has been left. A greeting is a round trip and the answer to
   *  it lands whenever it lands, which can be after the last tab holding the canvas
   *  closed; what it was about to do must not happen behind the room's back. The
   *  note's room keeps the same flag for the same reason. */
  private left = false

  constructor(private readonly joining: Drawing) {
    this.scheme = joining.scheme
    this.door = new RoomDoor({
      noteId: joining.noteId,
      token: joining.token,
      who: joining.who,
      caughtUp: () => this.together(),
      present: () => this.showHands(),
      gone: () => joining.gone(),
      refused: (said) => joining.refused(said),
    })

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

  /** The scheme changed, so every hand wants the other shade of its colour. */
  repaint(scheme: 'dark' | 'light') {
    if (scheme === this.scheme) return

    this.scheme = scheme
    this.showHands()
  }

  /** Whoever is at this device is called something else now. Next door, because
   *  a note's room says it the same way; see door.ts. */
  rename(person: string | undefined) {
    this.door.rename(person)
  }

  leave() {
    this.left = true
    this.joining.surface.shared = null
    this.joining.surface.handsAre([])
    this.binding.part()
    this.door.leave()
    this.joining.onPeers(0)
  }

  /** Whether this room is still about the plane it was joined to: it has not been
   *  left, and the surface is still on the file it was joined for. Asked before
   *  anything at all is done to the objects; see `Drawing.holds`. */
  private holds(): boolean {
    return !this.left && this.joining.holds()
  }

  /** The room's plane and this device's, brought together, and the surface handed
   *  the room from here on. Nothing was pushed and nothing was watched until now:
   *  what the room holds and what this device drew have to be compared rather than
   *  one landing on the other.
   *
   *  Joining is a round trip, and a canvas that moved on inside it is a plane these
   *  objects are no longer: neither side is anybody's news then, and merging would
   *  write one file's drawing into another's. */
  private together() {
    if (!this.holds()) return

    this.binding.together()
    this.joining.surface.shared = this
  }

  /** Who is on the plane, for the surface to draw and for the tab to count. */
  private showHands() {
    const { present, hands } = handsIn(this.door.awareness, this.door.doc, this.scheme)

    this.joining.surface.handsAre(hands)
    this.joining.onPeers(present)
  }
}
