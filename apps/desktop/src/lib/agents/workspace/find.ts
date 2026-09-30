/** Finding things in a space: `search_notes` and `list_backlinks`.
 *
 *  The search is the Search panel's own (`searchSpace` in search/space.ts: the parsed
 *  query, the crate's walk, the papers' words), asked without the panel: nothing opens,
 *  and the query the reader typed there is not replaced. Asked of any space by its
 *  root, so another space is searched where it is. What a space leaves out, the archive
 *  among it, is left out here as it is there.
 *
 *  The backlinks are the Links panel's (`backlinks` on the link index), of whichever
 *  space the note is in; see links.ts for the index of a space that is not open.
 *
 *  Both answer in the account connector's shape (services/sync/src/mcp/tools.ts), so a
 *  prompt written for one reads the other: rows of `space`, `path`, a line counted from
 *  one, and the words, cut at the same two hundred characters. */

import type { AgentAnswer } from '../../automation/caller'
import type { Hit } from '../../search/match'
import { parseQuery } from '../../search/query'
import { searchSpace } from '../../search/space'
import { nameOf, relativeTo } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import { type Call, count, done, maybe, need } from './call'
import { indexOf } from './links'
import { judged, onDisk, type Place, placeFor, reachable, sharedSource } from './spaces'

/** The connector's numbers: fifty rows, two hundred characters of each. */
const MATCHES = 50
const MOST_MATCHES = 500
const LONGEST = 200

interface Row {
  space: string
  path: string
  line: number
  text: string
}

function rowOf(place: Place, hit: Hit): Row {
  return {
    space: place.space.name,
    path: relativeTo(place.space.root, hit.path),
    line: hit.line + 1,
    text: hit.text.trim().slice(0, LONGEST),
  }
}

/** Every hit of one space, up to `most`. */
async function hitsIn(place: Place, query: string, most: number): Promise<Row[]> {
  const found: Row[] = []
  const root = place.space.root

  await searchSpace(
    root,
    parseQuery(query),
    [],
    most,
    (batch) => {
      for (const hit of batch.hits) if (found.length < most) found.push(rowOf(place, hit))
    },
    workspace.leftOutOf(root),
  )

  return found
}

export async function searchNotes(call: Call): Promise<AgentAnswer> {
  const query = need(call, 'query')
  const named = maybe(call, 'space')
  const most = count(call, 'limit', MATCHES, MOST_MATCHES)

  // One space when it is named; every space the agent reaches otherwise, the way the
  // connector searches every space of the account.
  const places =
    named === null
      ? reachable(call).map((space) => ({ space, open: space.id === workspace.activeSpace?.id }))
      : [placeFor(call, named)]

  const rows: Row[] = []
  let marked: string | null = null
  for (const place of places) {
    if (rows.length >= most) break

    const found = await hitsIn(place, query, most - rows.length)
    rows.push(...found)
    if (found.length) marked ??= sharedSource(place)
  }

  return done(rows, marked)
}

export async function listBacklinks(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const asked = judged(need(call, 'path'))
  const relative = nameOf(asked).includes('.') ? asked : `${asked}.md`

  const index = await indexOf(place)
  const rows = index.backlinks(onDisk(place, relative)).map((one) => ({
    path: one.path,
    line: one.line + 1,
    text: one.text.trim().slice(0, LONGEST),
  }))

  return done(rows, rows.length ? sharedSource(place) : null)
}
