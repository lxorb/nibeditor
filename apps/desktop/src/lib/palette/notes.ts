/** The notes the palette lists for what was typed, and which of them say where
 *  they are.
 *
 *  Found by the name and by the path to it, as VS Code's quick open and
 *  Obsidian's switcher both find a file: `uni/lec` reaches `Lecture 3` in `Uni`.
 *  The notes opened lately come first, and win every tie after that; see
 *  `recentFirst` in fuzzy.ts.
 *
 *  A row says its folder only where the name alone would not do: where two notes
 *  share the name, and where it was the folder that matched rather than anything
 *  on the row. Every other row is its name and nothing else. */

import { fuzzy, rank, recentFirst } from '../fuzzy'
import { shownName } from '../note-name'
import { folderOf, relativeTo } from '../space-paths'
import type { Entry } from '../workspace.svelte'

export interface NoteRow {
  entry: Entry
  /** Where it is, relative to the space, or null where the name says enough. */
  folder: string | null
}

/** How many rows are worth drawing. Past this it is a second file list. */
const MOST = 40

const nameKey = (entry: Entry) => shownName(entry.name).toLowerCase()

export function noteRows(
  term: string,
  files: readonly Entry[],
  recent: readonly string[],
  root: string,
): NoteRow[] {
  const where = (entry: Entry) => relativeTo(root, entry.path)
  const found = rank(
    term,
    recentFirst(files, recent, (one) => one.path),
    (one) => [shownName(one.name), shownName(where(one))],
  ).slice(0, MOST)

  const named = new Map<string, number>()
  for (const one of files) named.set(nameKey(one), (named.get(nameKey(one)) ?? 0) + 1)

  return found.map((entry) => {
    const folder = folderOf(where(entry))
    const shared = (named.get(nameKey(entry)) ?? 0) > 1
    const byName = fuzzy(term, shownName(entry.name)) !== null

    return { entry, folder: folder && (shared || !byName) ? folder : null }
  })
}
