/** Where a row lands when somebody drops it, and what the folder keeps afterwards.
 *
 *  The other half of tree-order.ts, and the half no window needs until somebody
 *  rearranges one: the file list is the first paint, so what draws a row is imported
 *  and what moves one is fetched. Nothing here runs before a drag starts, a key moves
 *  a row, or the Manual order is chosen; see tree-lift.ts, which is the gesture, and
 *  lib/ai/ask.ts, which is the same seam said in one line.
 *
 *  Pure, like its other half, and knowing nothing about a space. */

import type { Entry } from './workspace.svelte'
import { byDefault, shownNames, type Row } from './tree-order'

/** Whether a list of rows is already in the default order, from `at` to its end. */
function sortedFrom(rows: readonly Row[], at: number): boolean {
  for (let index = at + 1; index < rows.length; index++) {
    const before = rows[index - 1]
    const row = rows[index]
    if (before && row && byDefault(before, row) > 0) return false
  }

  return true
}

/** What a folder keeps of the order it is drawn in: the front of it, up to the
 *  point where the rest is in the order it would have read in anyway. Empty for a
 *  folder nobody has moved a row in, and then the folder has no entry in the map at
 *  all.
 *
 *  Because a name the list does not hold falls to the end in `byDefault` order, the
 *  tail of an arranged order is usually free: somebody who drags three notes to the
 *  top of a folder of four hundred has arranged three names, and those three are
 *  the whole of what has to be written down, synced, and rewritten every time one
 *  of the four hundred is renamed. A folder nobody arranged keeps nothing at all,
 *  which is what makes Manual start out identical to Name, A to Z instead of
 *  freezing today's listing into the space.
 *
 *  One list, folders and notes together, because that is how a hand-arranged folder
 *  reads; see `ordered`. A name no longer in the folder is read as a note, which
 *  only decides how much of a stale list is worth keeping.
 *
 *  An older build wrote the folders and then the notes, each trimmed on its own,
 *  and this reads that back as it stands. The one folder that reads differently is
 *  one that had both a note arranged and a subfolder nobody had touched: the
 *  subfolder used to be lifted over the arranged notes and now falls in after
 *  them. One row, once, and the next drag writes the answer down. */
export function trimmed(children: readonly Entry[], names: readonly string[]): string[] {
  const of = new Map(children.map((one) => [one.name, one]))
  const rows = names.map((name) => of.get(name) ?? { name, is_dir: false })

  let at = rows.length
  while (at > 0 && sortedFrom(rows, at - 1)) at -= 1

  return names.slice(0, at)
}

/** `names` with `moving` lifted out and put back so that they sit where the name
 *  at `at` was.
 *
 *  `at` counts in the list as it stands, which is what a gap between two rows
 *  means: the row under the pointer is the one the gap is above, and dropping
 *  below it is the row after. An index past the end is the end. The moving names
 *  keep the order the list had them in, so a selection dragged together arrives
 *  in the order it was read in rather than the order it was clicked in. */
export function movedTo(names: readonly string[], moving: readonly string[], at: number): string[] {
  const going = names.filter((name) => moving.includes(name))
  if (!going.length) return [...names]

  const kept = names.filter((name) => !going.includes(name))
  const before = names.slice(0, Math.max(0, at)).filter((name) => !going.includes(name)).length

  return [...kept.slice(0, before), ...going, ...kept.slice(before)]
}

/** The list with `name` a step up or down it, or null where there is no step to
 *  take: the top row cannot rise and the bottom row cannot fall. */
export function stepped(names: readonly string[], name: string, by: number): string[] | null {
  const at = names.indexOf(name)
  if (at < 0) return null
  if (at + by < 0 || at + by >= names.length) return null

  // A step down has to clear the row it is passing, which is one further on in
  // the list as it stands; a step up lands where that row is.
  return movedTo(names, [name], by < 0 ? at + by : at + by + 1)
}

/** What the folder keeps once `moving` has been dropped beside `target`.
 *
 *  Every gap between two rows is a gap something can be dropped in, folders and
 *  notes alike: an order somebody arranged by hand is theirs, and a rule that put
 *  the folders back on top would be the app overruling the drag. `movedTo` keeps
 *  only the names the folder actually holds, so a row dragged in from elsewhere
 *  leaves the order alone. */
export function placedBeside(
  children: readonly Entry[],
  listed: readonly string[],
  moving: readonly string[],
  target: string,
  after: boolean,
): string[] {
  const displayed = shownNames(children, 'manual', listed)
  const at = displayed.indexOf(target)
  if (at < 0) return trimmed(children, displayed)

  return trimmed(children, movedTo(displayed, moving, after ? at + 1 : at))
}
