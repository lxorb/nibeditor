/** A space's tree made into rows, the first time a v2 device asks for it.
 *
 *  Until then a space is notes by path, as v1 wrote them. Preparing reads every path
 *  once and writes the tree they describe: a folder row for each folder, each note's
 *  folder and name beside its path, and every document put on its first epoch,
 *  seeded from the words it has now (docs/sync-v2.md section 11, step 3). One batch,
 *  so a space is prepared entirely or not at all; asking again does nothing that has
 *  been done, so a device that lost the answer simply asks again.
 *
 *  Nothing about a v1 app changes: its notes keep their ids, paths and versions,
 *  except where two names Windows and a Mac cannot tell apart shared a folder - only a
 *  Linux device can have written those - and the later is numbered, as a rename every
 *  device, v1 or v2, then reads off its feed. */

import { now } from '../crypto'
import type { Env, Space } from '../types'
import { backfillMaps } from './maps'
import { changeTree } from './tree'

/** Prepares a space, answering the cursor it is at. */
export async function prepareSpace(env: Env, spaceId: string, device?: string): Promise<number> {
  const { cursor } = await changeTree(env, spaceId, device, () => undefined)

  // After the rows, so a space marked as prepared is one whose rows are there. A v1
  // write landing in between is placed by the next read of the tree; see `heal`.
  const marked = await env.DB.prepare(
    'update spaces set prepared_at = ? where id = ? and prepared_at is null',
  )
    .bind(now(), spaceId)
    .run()
  if (marked.meta.changes) await backfillMaps(env, spaceId)

  return cursor
}

/** Prepares a space unless it already is: what every v2 route that reads a space's
 *  tree asks first. */
export async function preparedSpace(env: Env, space: Space, device?: string): Promise<void> {
  if (space.prepared_at) return
  await prepareSpace(env, space.id, device)
}
