/** Joining a room, the same way for a note and a canvas.
 *
 *  door.ts is the half of a room that is the same whatever the file is: the socket,
 *  the awareness, the greeting. This is the half above it that is also the same: what
 *  a room is joined on behalf of, the door opened for it, whether the room still
 *  holds the file it was joined to, and the name and the scheme a device wears there.
 *  What differs - what the document holds, how the two copies are brought together
 *  and how the others are drawn - is each kind's own, in room.ts and plane.ts. */

import { RoomDoor, type Who } from './door'

/** What any room is joined on behalf of. */
export interface Entering {
  noteId: string
  token: string
  who: Who
  scheme: 'dark' | 'light'
  /** Told how many other devices are on the file, whenever that changes. */
  onPeers: (present: number) => void
  /** The room was thrown away and another will be built out of the file; see
   *  `REBUILT` in door.ts. Nothing this room holds can carry on, so what answers is
   *  whoever paired the two: it lets this one go and joins again. */
  gone: () => void
  /** The room will take no more changes and said why; see `TOO_LARGE` in door.ts.
   *  This one is let go and not joined again - the file carries on as a file. */
  refused: (said: string) => void
  /** Whether what is open above is still on the file this room was joined for; see
   *  `Joining.holds` in room.ts, which says why at length. */
  holds: () => boolean
}

export abstract class JoinedRoom {
  protected readonly door: RoomDoor
  protected scheme: 'dark' | 'light'
  /** Whether this room has been left. A greeting is a round trip and the answer to
   *  it lands whenever it lands, which can be after the last tab holding the file
   *  closed or after the document moved on; what it was about to do must not happen
   *  behind the room's back. */
  protected left = false

  constructor(private readonly entering: Entering) {
    this.scheme = entering.scheme
    this.door = new RoomDoor({
      noteId: entering.noteId,
      token: entering.token,
      who: entering.who,
      caughtUp: () => this.together(),
      present: () => this.showPresent(),
      gone: () => entering.gone(),
      refused: (said) => entering.refused(said),
    })
  }

  /** Whoever is at this device is called something else now. Next door, because
   *  either kind of room says it the same way; see door.ts. */
  rename(person: string | undefined) {
    this.door.rename(person)
  }

  /** The scheme changed, so everybody else wants the other shade of their colour. */
  repaint(scheme: 'dark' | 'light') {
    if (scheme === this.scheme) return

    this.scheme = scheme
    this.showPresent()
  }

  /** Whether this room is still about the file it was joined to: it has not been
   *  left, and what is open above is still on that file. Asked before anything at all
   *  is done to what the file holds; see `Entering.holds`. */
  protected holds(): boolean {
    return !this.left && this.entering.holds()
  }

  /** The room has said what it holds, so this device's copy is brought together with
   *  it. Once. */
  protected abstract together(): Promise<void> | void

  /** Somebody arrived, left or moved, and whoever draws the others is told. */
  protected abstract showPresent(): void
}
