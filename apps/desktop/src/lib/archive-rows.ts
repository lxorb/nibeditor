/** How the archive reads: what was put away, under where it was, newest first.
 *
 *  Pure, and its own module rather than a `$derived` inside `Archive.svelte`, because the
 *  ordering is the whole of what the list promises and it is worth being able to say so
 *  without a space, a scan or a screen. What it takes is rows the component built and what
 *  it hands back is the same rows grouped; nothing here reads a store.
 *
 *  The grouping is by the folder each thing was in, which is the answer to the question a
 *  reader has when they open the archive: not "what did I put away" but "where was it".
 *  Two notes called `Notes.md` in two folders are two rows that read differently, and a
 *  reader who archived one of them can tell which.
 *
 *  Inside a group, the thing most recently put away comes first: an archive is read from
 *  the top and the top is the most recent decision. A file that says a word rather than a
 *  date - `archived: true`, ticked in Obsidian - has no time in it and sorts last, which
 *  is the honest answer rather than a guess at a moment the file never recorded.
 *
 *  The groups themselves are in path order, which is the file list's own order, so the
 *  archive reads as the tree it came out of. */

import { folderOf } from './space-paths'

/** One archived thing, as much of it as the ordering is about. */
export interface ArchivedRow {
  /** As the space speaks of it, which is what the folder is read off. */
  at: string
  /** When it was put away, or null where the file says a word rather than a date. */
  when: number | null
}

/** One original folder, and what was put away inside it. */
export interface ArchivedGroup<Row extends ArchivedRow> {
  /** The folder as the space speaks of it. Empty for the space's own floor, which the
   *  list draws with no heading over it: the rows are already where the reader is. */
  at: string
  rows: Row[]
}

/** Whether a path is inside the folder a narrowing names, or is that folder.
 *
 *  What Show them narrows to, after a deletion was refused. Null means the whole archive,
 *  which is every other time the list is opened. */
export function insideFolder(at: string, only: string | null): boolean {
  if (only === null) return true
  return at === only || at.startsWith(`${only}/`)
}

/** The rows, grouped and ordered. `only` narrows to one folder; null is the lot. */
export function archiveGroups<Row extends ArchivedRow>(
  rows: readonly Row[],
  only: string | null = null,
): ArchivedGroup<Row>[] {
  const held = new Map<string, Row[]>()

  for (const row of rows) {
    if (!insideFolder(row.at, only)) continue

    const at = folderOf(row.at)
    const kept = held.get(at)
    if (kept) kept.push(row)
    else held.set(at, [row])
  }

  return [...held]
    .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
    .map(([at, kept]) => ({
      at,
      // A file with no time in it sorts last, whatever it is compared against: two of
      // them keep the order they came in, which is the space's own path order.
      rows: [...kept].sort((one, other) => (other.when ?? -Infinity) - (one.when ?? -Infinity)),
    }))
}
