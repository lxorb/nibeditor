/** The columns of a space that a client writes whole, and what each of them holds.
 *
 *  Seven of them: the bookmarks, the paths the space leaves out, what it keeps about
 *  its graph, the files beside its notes, the icons its folders wear, the order its
 *  folders were arranged into, and what it says about its published site. Each is a
 *  JSON document the app writes in one request and reads back off the space listing,
 *  so each has the same two things to settle - how much of it a space may hold, and
 *  the write itself.
 *
 *  The ceilings were six constants in six files, all called `MOST_BYTES`, and
 *  nothing showed them together: whether the bookmarks may be larger than the graph
 *  was a question you answered by opening two files. They are numbers a reader
 *  compares, so they are written where they can be compared.
 *
 *  The write is one statement, and it touches `updated_at` as well as the column: a
 *  device that watches for spaces that changed has to learn that this one did. Five
 *  routes had that statement written out, which is five places to forget the second
 *  half in. */

import { byteLength, now } from '../crypto'
import type { Env } from '../types'

/** A column a client writes whole. `icons` writes a second column beside it - the
 *  tints - so it has a statement of its own; see ./icons. */
export type Column = 'arranged' | 'bookmarks' | 'excluded' | 'files' | 'graph' | 'site'

/** How many bytes each column may hold, once written down.
 *
 *  Each is the other end of a guard whose first end is per entry: every bookmark,
 *  path, file, icon and arranged name is bounded on its own, and this is what stops a
 *  map of entries that are all legal from making the space listing heavy for every
 *  device that reads it.
 *
 *  They differ because what they hold differs. The graph keeps a handful of
 *  switches. The bookmarks are a list somebody arranged by hand, so a long one is
 *  still a few hundred entries. The exclusions and the site's rules are lists of
 *  paths, which run longer. The files, the icons and the arranged order are keyed by
 *  path, one entry per file or folder, so they are the three that scale with the
 *  space - four times what the bookmarks are allowed, because four hundred folder
 *  paths is that much more than sixty bookmarks, and a map the app considers legal has
 *  to be one this takes or an icon somebody chose would vanish on the way up.
 *
 *  The arranged order reaches the same number from the other direction: half as many
 *  folders as may wear an icon, because a row is dragged by hand where an icon is
 *  clicked, but under each of those folders a list of its children's names rather than
 *  one word. Fewer keys carrying more each comes out in about the same place, and a
 *  ceiling below the icons' would refuse a tree the app had already arranged.
 *
 *  `icons` covers both of its columns together, since the colours are the same paths
 *  again with an accent's name on each and the pair is what a listing carries.
 *
 *  All of them are also bounded the other way, by that listing: every space's
 *  columns ride along with its name on every read, so a ceiling here is a ceiling
 *  on what every device downloads to list its spaces. */
export const MOST_BYTES: Record<Column | 'icons', number> = {
  graph: 4 * 1024,
  bookmarks: 8 * 1024,
  excluded: 16 * 1024,
  site: 24 * 1024,
  files: 32 * 1024,
  icons: 32 * 1024,
  arranged: 32 * 1024,
}

/** Whether what is about to be written fits in its column. */
export function fits(written: string, column: Column | 'icons'): boolean {
  return byteLength(written) <= MOST_BYTES[column]
}

/** Writes one column, and says the space changed.
 *
 *  The column is a name from the type above rather than a string a caller composed,
 *  which is what keeps this from being a way to write any column at all. */
export async function writeColumn(
  env: Env,
  column: Column,
  spaceId: string,
  written: string,
): Promise<void> {
  await env.DB.prepare(`update spaces set ${column} = ?, updated_at = ? where id = ?`)
    .bind(written, now(), spaceId)
    .run()
}
