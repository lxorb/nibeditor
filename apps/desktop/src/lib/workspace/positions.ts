/** Where each note was last being read on this device, kept after the tab that
 *  was reading it has closed - so opening it again lands where it was left
 *  rather than at the top.
 *
 *  Keyed by path, and it outlives every tab in it, so it has to stop growing
 *  somewhere: three hundred notes is more than anyone comes back to and small
 *  enough to write down on every pause in the typing. */

import type { FoldLines } from '@nib/editor'
import { movedTo, samePath } from '../space-paths'
import type { FileOp } from './file-ops'
import type { Position } from './session'

/** Enough for every note anyone comes back to, small enough for storage. */
const KEPT = 300

export class Positions {
  private places: Record<string, Position>

  constructor(places: Record<string, Position> = {}) {
    this.places = places
  }

  /** What goes into the session. */
  get all(): Record<string, Position> {
    return this.places
  }

  /** Where a note was last looked at. Nothing at all for one nobody has
   *  opened, which reads as the top of the note. */
  of(path: string): Partial<Pick<Position, 'cursor' | 'scroll' | 'anchor' | 'folds'>> {
    const known = this.places[path] ?? this.spelledOtherwise(path)
    return known
      ? { cursor: known.cursor, scroll: known.scroll, anchor: known.anchor, folds: known.folds }
      : {}
  }

  /** The place kept under another spelling of the same path: a note opened as
   *  `plan.md` on a disk that calls it `Plan.md`. */
  private spelledOtherwise(path: string): Position | undefined {
    for (const [one, place] of Object.entries(this.places)) if (samePath(one, path)) return place
    return undefined
  }

  remember(
    path: string,
    cursor: number,
    scroll: number,
    anchor?: number,
    folds?: readonly FoldLines[],
  ) {
    // Nothing folded is written as nothing at all rather than as an empty list,
    // so a note nobody has folded costs the storage what it always cost.
    const place: Position = {
      cursor,
      scroll,
      anchor,
      ...(folds?.length ? { folds } : {}),
      at: Date.now(),
    }
    const entries = Object.entries({ ...this.places, [path]: place })

    // Most recently looked at first, and everything past what is worth keeping
    // dropped.
    if (entries.length > KEPT) {
      entries.sort(([, a], [, b]) => b.at - a.at)
      entries.length = KEPT
    }

    this.places = Object.fromEntries(entries)
  }

  /** A note that moves takes its place along, and every note in a folder or a space
   *  that moves takes its own. */
  follow(op: FileOp) {
    if (op.op !== 'moved') return

    const was = Object.entries(this.places)
    const now = was.map(([path, place]): [string, Position] => [
      movedTo(path, op.from, op.to) ?? path,
      place,
    ])

    if (now.some(([path], at) => path !== was[at]?.[0])) this.places = Object.fromEntries(now)
  }
}
