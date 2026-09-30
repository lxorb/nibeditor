/** The two tools a question is answered with, over the account's own notes.
 *
 *  Nothing is stuffed into the context: the model is given `search_notes` to find
 *  something and `read_note` to read it, and no notes at all. A question about one
 *  note therefore costs one note, and a reader with four hundred of them is not
 *  paying to send four hundred.
 *
 *  These used to run in the plugin, against whatever that device had synced down.
 *  They run here now, because the key runs here now - and it is the better half of
 *  the trade: this reads what the account actually holds rather than what one phone
 *  happens to have, and a note written on a laptop a minute ago is in the answer.
 *
 *  Every space the account can reach, which is its own and the ones shared with it,
 *  through the same query the connector uses. A question is about what the person
 *  knows rather than about which folder they happen to have open. */

import { noteBody, type Space, spacesFor } from '../mcp/tools'
import type { Env } from '../types'

/** What one note looked like to a search. */
export interface Found {
  note: string
  line: number
  text: string
}

/** How many matching lines a search answers with. Seven lines fit on the panel; a
 *  model given twenty has enough to choose which note to read. */
const HITS = 20

/** How many notes a search reads the body of before it stops looking. A match is
 *  usually near the front of an account, and a question asked out loud has somebody
 *  standing there waiting for it. */
const MOST_READ = 300

/** How many notes are listed per space. */
const MOST_NOTES = 1000

/** How much of one line comes back. A panel is 576 pixels wide; a paragraph on one
 *  line is not what the model needs to see to know which note this is. */
const MOST_LINE = 200

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** What the model is shown a note as: its path without the extension. The reader
 *  said "the font note", not "notes/fonts/font.md". */
function named(path: string): string {
  return path.replace(MARKDOWN, '')
}

async function pathsIn(env: Env, space: Space): Promise<{ id: string; path: string }[]> {
  const { results } = await env.DB.prepare(
    `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_NOTES)
    .all<{ id: string; path: string }>()

  return results
}

/** Every note in the account whose words match, with the line each matched on. */
export async function searchNotes(env: Env, userId: string, query: string): Promise<Found[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const out: Found[] = []
  let read = 0

  for (const space of await spacesFor(env, userId)) {
    if (out.length >= HITS || read >= MOST_READ) break

    for (const row of await pathsIn(env, space)) {
      if (out.length >= HITS || read >= MOST_READ) break
      read++

      const body = await noteBody(env, space.id, row.id)
      const lines = body.split('\n')
      for (let at = 0; at < lines.length; at++) {
        const line = lines[at] ?? ''
        if (!line.toLowerCase().includes(needle)) continue

        out.push({ note: named(row.path), line: at + 1, text: line.trim().slice(0, MOST_LINE) })
        // One line per note, so twenty hits are twenty notes rather than twenty
        // lines of one: the model is choosing what to read.
        break
      }
    }
  }

  return out
}

/** One note by the name a search gave, out of any space the account can reach.
 *
 *  Null where there is no such note, which the model is told rather than being left
 *  to guess. A name may match in two spaces; the first in the order the spaces come
 *  back wins, which is the same rule the app's own link resolution has. */
export async function readNote(env: Env, userId: string, name: string): Promise<string | null> {
  const wanted = named(name.trim()).toLowerCase()
  if (!wanted) return null

  for (const space of await spacesFor(env, userId)) {
    for (const row of await pathsIn(env, space)) {
      if (named(row.path).toLowerCase() !== wanted) continue
      return noteBody(env, space.id, row.id)
    }
  }

  return null
}
