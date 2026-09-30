/** What one space has archived: the notes, folders and files it has put away.
 *
 *  A map keyed by the path relative to the space, the way the folder icons are, with
 *  a moment under each path: positive while it is archived, negative once it was taken
 *  back. The app keeps the same map and meets this copy with its own entry by entry,
 *  the later moment winning, before it writes the whole of it here; see
 *  workspace/archive.svelte.ts in the app. So this route only checks and keeps what
 *  arrives, like every column a client writes whole, and a write that raced another
 *  device's loses nothing for long: the next listing the other device reads is folded
 *  into its own copy, and the difference comes back up.
 *
 *  Migration 0041. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'

/** How many entries one space may hold, restores included. The same number the app
 *  holds itself to, so a map that fits there fits here. */
const MOST = 1000

/** Whether an entry is a path inside the space with a moment on it. */
function kept(path: string, when: unknown): when is number {
  return (
    path.length > 0 &&
    path.length <= LONGEST_PATH &&
    staysInside(path) &&
    typeof when === 'number' &&
    Number.isSafeInteger(when) &&
    when !== 0
  )
}

/** What is wrong with the map that arrived, as one sentence, or null. Only the map
 *  itself: one entry this version cannot read is dropped rather than refused, so a
 *  newer app never loses the lot over it. */
function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'archived must be a map'
  if (Object.keys(value).length > MOST) return `a space keeps at most ${MOST} archived paths`
  return null
}

/** The entries that are a path and a moment, and nothing else: what a PUT keeps is
 *  what a read gives back. Gathered and then made into a map, because `__proto__` is a
 *  name a folder may have. */
function archivedMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const out: [string, number][] = []
  for (const [path, when] of Object.entries(value)) {
    if (out.length >= MOST) break
    if (kept(path, when)) out.push([path, when])
  }

  return Object.fromEntries(out)
}

/** The column, as the app reads it back. */
export function readArchived(raw: string): Record<string, number> {
  return archivedMap(objectIn(raw))
}

export const spaceArchived = new Hono<{ Bindings: Env; Variables: Variables }>()

// The archive is the space's rather than the reader's: everyone in it sees the same
// tree, so putting a note away is writing in the space.
spaceArchived.put('/:id/archived', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.archived
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const map = archivedMap(sent)
  const written = JSON.stringify(map)
  if (!fits(written, 'archived')) {
    return context.json({ error: 'that is more archived paths than a space holds' }, 413)
  }

  await writeColumn(context.env, 'archived', space.id, written)

  return context.json({ archived: map })
})
