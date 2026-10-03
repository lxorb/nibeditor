/** The scratchpad's lines, found from every space. It is in no space, so the walk of
 *  the space never reads it, but it is where half a thought was pasted a minute ago -
 *  a search that cannot find that is a search that lost it. Read once per search, the
 *  way an unsaved note is: one file, a few lines. Its rows open its tab, and no
 *  replacement across a space ever writes into it; see `chosen` in search.svelte.ts.
 *  Fetched with the first search. See scratchpad/pad.ts. */

import { scratchpad } from '../scratchpad/pad'
import { SCRATCHPAD } from '../scratchpad/is'
import { noteName } from '../space-paths'
import { type Hit, Matcher } from './match'
import type { Query } from './query'

export async function scratchpadHits(query: Query, most: number): Promise<Hit[]> {
  const path = await scratchpad.where().catch(() => null)
  const body = path === null ? '' : await scratchpad.text()
  if (path === null || !body.trim()) return []

  const name = noteName(SCRATCHPAD)
  return new Matcher(query).hits({ path, relative: name, name, body }, most)
}
