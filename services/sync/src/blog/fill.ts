/** Reading what the notes that came before say about themselves.
 *
 *  Every note written since the column existed carries it, because the one place
 *  a note is written reads it; see notes.ts and blog/front.ts. A vault that
 *  synced last month does not, and a `publish: false` nobody has read is a page
 *  on the internet that was meant to be private - so this is the one thing in
 *  publishing that goes back over what is already there.
 *
 *  Its own module rather than front.ts, because it reaches storage: front.ts is
 *  what the note-writing path imports, and that path should not import the thing
 *  that reads a hundred objects. */

import { noteKey } from '../notes'
import type { Env } from '../types'
import { titleFrom, writeFront } from './front'
import { keepWords } from './words'

/** How many notes one sweep reads. Each is an object out of storage and a row
 *  written, so this is the number that fits in one invocation with room to
 *  spare. A space bigger than this finishes overnight. */
const AT_ONCE = 200

/** Fills the column in for notes written before there was one.
 *
 *  Every note written since carries what it says about itself, because the one
 *  place a note is written reads it (see notes.ts). A vault that synced last
 *  month does not, and its `publish: false` would go unread - so a space being
 *  published reads its own notes once, and the nightly sweep finishes whatever
 *  was over the bound and picks up every other space in its own time.
 *
 *  Bounded in reads rather than in rows, because that is what a Worker has a
 *  ceiling on. Answers how many it read, so a caller can say whether there is
 *  more to do. */
export async function fillFronts(env: Env, spaceId: string | null): Promise<number> {
  const asking = spaceId
    ? env.DB.prepare(
        `select id, space_id, path from notes
          where front is null and deleted = 0 and kind != 'file' and space_id = ? limit ?`,
      ).bind(spaceId, AT_ONCE)
    : env.DB.prepare(
        `select id, space_id, path from notes
          where front is null and deleted = 0 and kind != 'file' limit ?`,
      ).bind(AT_ONCE)

  const { results } = await asking.all<{ id: string; space_id: string; path: string }>()
  if (!results.length) return 0

  const writes = await Promise.all(
    results.map(async (row) => {
      const object = await env.NOTES.get(noteKey(row.space_id, row.id))
      const source = object ? await object.text() : ''

      // The words as well as the front matter: the body is in hand, and the two
      // are read from it together everywhere else. See blog/words.ts.
      await keepWords(env, row, source, titleFrom(row.path, source)).catch(() => undefined)

      return env.DB.prepare('update notes set front = ? where id = ?').bind(
        writeFront(source),
        row.id,
      )
    }),
  )

  await env.DB.batch(writes)
  return results.length
}
