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
import { byName, shownNames } from './tree-order'

/** The names of the group `folders` says, in the order they are drawn. A drag and
 *  a key both move a row within its own group and never out of it. */
export function groupNames(
  children: readonly Entry[],
  displayed: readonly string[],
  folders: boolean,
): string[] {
  const kind = new Map(children.map((one) => [one.name, one.is_dir]))
  return displayed.filter((name) => (kind.get(name) ?? false) === folders)
}

/** Whether a list of names is already in name order, from `at` to its end. */
function sortedFrom(names: readonly string[], at: number): boolean {
  for (let index = at + 1; index < names.length; index++) {
    if (byName(names[index - 1] ?? '', names[index] ?? '') > 0) return false
  }

  return true
}

/** What is worth keeping of one group's order: the front of it, up to the point
 *  where the rest is already in name order.
 *
 *  Because a name the list does not hold falls to the end of its group in name
 *  order, the tail of an arranged order is usually free: somebody who drags three
 *  notes to the top of a folder of four hundred has arranged three names, and
 *  those three are the whole of what has to be written down, synced, and rewritten
 *  every time one of the four hundred is renamed. A folder nobody arranged keeps
 *  nothing at all, which is what makes Manual start out identical to name order
 *  instead of freezing today's listing into the space. */
export function trimmed(names: readonly string[]): string[] {
  let at = names.length
  while (at > 0 && sortedFrom(names, at - 1)) at -= 1

  return names.slice(0, at)
}

/** What a folder keeps of the order it is drawn in: each group trimmed, the
 *  folders first. Empty for a folder that reads in name order either way, and then
 *  the folder has no entry in the map at all. */
export function keptOrder(children: readonly Entry[], displayed: readonly string[]): string[] {
  return [
    ...trimmed(groupNames(children, displayed, true)),
    ...trimmed(groupNames(children, displayed, false)),
  ]
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

/** One group with `name` a step up or down in it, or null where there is no step
 *  to take: the top row cannot rise and the bottom row cannot fall. */
export function stepped(group: readonly string[], name: string, by: number): string[] | null {
  const at = group.indexOf(name)
  if (at < 0) return null
  if (at + by < 0 || at + by >= group.length) return null

  // A step down has to clear the row it is passing, which is one further on in
  // the list as it stands; a step up lands where that row is.
  return movedTo(group, [name], by < 0 ? at + by : at + by + 1)
}

/** What the folder keeps once `moving` has been dropped beside `target`.
 *
 *  A row only ever moves within its own group, so a note dropped between two
 *  folders and a folder dropped between two notes both leave the order as it was:
 *  the gap does not open outside the group, and this is the same fact said in
 *  arithmetic. */
export function placedBeside(
  children: readonly Entry[],
  listed: readonly string[],
  moving: readonly string[],
  target: string,
  after: boolean,
): string[] {
  const displayed = shownNames(children, 'manual', listed)
  const kind = new Map(children.map((one) => [one.name, one.is_dir]))
  const first = moving.find((name) => kind.has(name))
  if (first === undefined) return keptOrder(children, displayed)

  const folders = kind.get(first) === true
  if ((kind.get(target) === true) !== folders) return keptOrder(children, displayed)

  const group = groupNames(children, displayed, folders)
  const at = group.indexOf(target)
  if (at < 0) return keptOrder(children, displayed)

  const moved = movedTo(
    group,
    moving.filter((name) => kind.get(name) === folders),
    after ? at + 1 : at,
  )

  return keptOrder(
    children,
    folders
      ? [...moved, ...groupNames(children, displayed, false)]
      : [...groupNames(children, displayed, true), ...moved],
  )
}
