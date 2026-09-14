/** The folders of one space that have been put away: which of them, and when.
 *
 *  A map keyed by the folder's path relative to the space, so every machine reads the
 *  same tree. Only the folders that have no note of their own are in it: a note keeps
 *  its mark in its own front matter and carries it wherever the file goes, and a
 *  folder drawn as a note is put away through that note. What is left is a folder that
 *  is only a name in a path, with no file anywhere to write a mark into, so the space
 *  keeps the mark and the path says whose it is. See spaces/icons.ts, which is this
 *  column's twin in every respect.
 *
 *  The value is when the folder went rather than a flag, because a flag is what a map
 *  with only keys already is: a folder named here is away, and the moment is what lets
 *  what has been archived be shown newest first without a column of its own. It is
 *  read as a word and not as a date, for the reason `isIcon` reads a shape rather than
 *  an icon: how a moment is written is the app's, and a service that parsed one would
 *  have to be deployed before the app could write it differently.
 *
 *  The whole map is written at once, the way the folder icons are. It is the client's
 *  own statement about its tree, and one PUT of the lot is the only shape in which
 *  putting a folder away and taking two back is a single request - and the only one in
 *  which a folder being renamed, every key under it leaving one prefix and arriving at
 *  another, is.
 *
 *  See spaces/excluded.ts, whose route this is, and
 *  workspace/archived-folders.svelte.ts, which is the other end of it. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'

/** How many folders of one space may be put away.
 *
 *  The number of folders a space may dress, because the two maps are the same shape
 *  over the same keys: a space that may give four hundred folders an icon may put four
 *  hundred away. Far more than anybody archives by hand, and the same number the app
 *  holds itself to, so a map that fits there fits here; see
 *  workspace/archived-folders.svelte.ts. */
const MOST = 400

/** As long as the written moment may be. Room for a date and a time and then some: a
 *  value longer than this is not one the app wrote. */
const LONGEST_VALUE = 64

/** Whether this key names a folder in the space rather than somewhere else; see
 *  ./paths. A folder has a name, so an empty key is not one. */
function inside(path: string): boolean {
  return !!path && path.length <= LONGEST_PATH && staysInside(path)
}

/** When a folder went, as the column keeps it: the value with its edges taken off, or
 *  null for anything that is not a moment somebody could have written.
 *
 *  The trim is the app's own rather than this module's idea - see `archivedFolderMap`
 *  there - so that what a PUT keeps is what the app holds after sending it. Nothing
 *  else is read out of the value: a word this build cannot make a date of is still the
 *  only record that the folder was put away, and dropping it would bring the folder
 *  back. */
function said(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const words = value.trim()
  return words && words.length <= LONGEST_VALUE ? words : null
}

/** What is wrong with the map that arrived, as one sentence the app can show, or null
 *  when nothing is.
 *
 *  Only the map itself. A single entry that is not a folder with a moment on it is
 *  dropped rather than refused: the map is written whole, so refusing the request over
 *  one entry the app and this version disagree about would bring back every folder
 *  anybody had put away. */
function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'archivedFolders must be a map'
  }
  if (Object.keys(value).length > MOST) return `a space puts at most ${MOST} folders away`

  return null
}

/** The entries that are a folder in this space with a moment on it, and nothing else.
 *  The one place the two directions agree: what a PUT keeps is what a read gives
 *  back. */
function mapOf(value: object): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [path, when] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST) break

    const moment = said(when)
    if (inside(path) && moment !== null) out[path] = moment
  }

  return out
}

/** The column, as the app reads it back. Anything in it that is not a folder of this
 *  space with a moment on it is left out: the column is written whole by clients, and a
 *  newer one may keep something this version has never heard of. */
export function readArchivedFolders(raw: string): Record<string, string> {
  const held = objectIn(raw)
  return held ? mapOf(held) : {}
}

export const spaceArchivedFolders = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The map, whole. Reading it needs no route of its own: the space listing carries it,
 *  so one request brings every space's archived folders along with its name and the
 *  icons its folders wear. */
// The map is the space's rather than the reader's: everyone in it sees the same tree,
// so putting a folder away is writing in the space.
spaceArchivedFolders.put('/:id/archived-folders', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.archivedFolders
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the entries that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = mapOf(sent as object)
  const written = JSON.stringify(kept)
  if (!fits(written, 'archived_folders')) {
    return context.json({ error: 'that is more archived folders than a space holds' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that changed
  // learns that this one did.
  await writeColumn(context.env, 'archived_folders', space.id, written)

  return context.json({ archivedFolders: kept })
})
