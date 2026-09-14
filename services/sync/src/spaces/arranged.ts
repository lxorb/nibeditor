/** The order somebody arranged the rows of a folder into: for each folder of the
 *  space, the names of its children in the order they should appear.
 *
 *  A map keyed by the folder's path relative to the space, the way the folder icons
 *  are - which is what lets every machine draw the same tree in the same order. A note
 *  cannot keep its own place the way it keeps its own icon, because where a row sits
 *  is not a fact about that file but about it and its siblings together; so the
 *  folder's entry holds the whole row of them, and the path says which folder that is.
 *  The top of the space is one of those folders, under the empty key: a path relative to
 *  the root is no path at all, and the root is where most of a space's notes sit.
 *
 *  Names under the key rather than paths, because every one of them is a child of the
 *  folder the key already named, and the prefix would be that key written out again on
 *  every entry. It is also what a rename costs the least: a folder renamed moves one
 *  key, and the names inside it do not change at all.
 *
 *  A name the list does not hold falls to the end, in name order, which is where every
 *  row of every folder starts out. So the list runs only as far as somebody actually
 *  arranged: a folder nobody has dragged a row in is not in the map, and one whose top
 *  three rows were dragged holds three names rather than all ninety. Which is also why
 *  there is no place in here to say a folder is sorted by name - that is the absence of
 *  an entry, and a column with two ways to say the same thing is a column two builds
 *  can disagree about.
 *
 *  The whole map is written at once rather than one folder at a time, the way the
 *  folder icons are. It is the client's own statement about its tree, and one PUT of
 *  the lot is the only shape in which a folder being renamed - every list under it
 *  leaving one key and arriving at another - is a single request. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'

/** How many folders of one space may carry an arranged order. Far fewer than the four
 *  hundred that may wear an icon, and the difference is what the two things are: an
 *  icon is one click in a picker, and a vault imported from Obsidian's Iconize arrives
 *  with hundreds of folders already marked, while an order is a row dragged with a
 *  hand. Nobody does that to two hundred folders. The app holds itself to the same
 *  number, so a map that fits there fits here. */
const MOST_FOLDERS = 200

/** How many names one folder's list may hold. A ceiling nobody writing notes meets,
 *  because the list is not the folder's contents: everything it leaves out falls to
 *  the end in name order, so a list is as long as the run somebody dragged and not as
 *  long as the folder. */
const MOST_NAMES = 500

/** How long one of those names may be. A file name's own limit on every filesystem the
 *  app runs on, which is what these are: the names of the children of one folder, not
 *  paths, and not anything this service composes. */
const LONGEST_NAME = 255

/** Whether this is the name of a child of a folder rather than a path or a way out of
 *  one.
 *
 *  A name, so: something, no longer than a name may be, and with neither separator in
 *  it - a value carrying one would be a path, and nothing below the key in this column
 *  is a path. `.` and `..` are not children either; they are the folder itself and its
 *  parent, and an app resolving one of those against the key would be arranging
 *  somewhere else entirely. Control characters go for the reason a path's do: a name
 *  with a newline in it is two names to whatever reads it next.
 *
 *  Read rather than resolved, for the reason `isIcon` is: nothing here asks whether the
 *  space actually holds a child of that name. A newer app may arrange a kind of file
 *  this build has never heard of, and a service that kept only the names it could
 *  account for would drop it. */
export function isName(value: string): boolean {
  if (!value || value.length > LONGEST_NAME) return false
  if (value === '.' || value === '..') return false
  if (/\p{Cc}/u.test(value)) return false

  return !value.includes('/') && !value.includes('\\')
}

/** Whether this key names a folder of the space, which here includes the space itself.
 *
 *  The same three answers ./paths gives every column, and one clause fewer than the
 *  icons ask for: an empty key is not nothing, it is the top of the space. A folder with
 *  no name is not a folder anybody can dress, which is why the icons refuse one - but
 *  the top of a space is where most of its notes sit, and its rows are as arrangeable as
 *  any other folder's. It is also the key the app's own arithmetic produces for it, a
 *  path relative to the root being no path at all; see workspace/arranged.svelte.ts
 *  there. */
function inside(path: string): boolean {
  return path.length <= LONGEST_PATH && staysInside(path)
}

/** What is wrong with the map that arrived, as one sentence the app can show, or null
 *  when nothing is.
 *
 *  Only the map itself. A single entry that is not a folder with an order on it is
 *  dropped rather than refused: the map is written whole, so refusing the request over
 *  one entry the app and this version disagree about would be losing the order of every
 *  folder in the tree. */
function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'arranged must be a map'
  if (Object.keys(value).length > MOST_FOLDERS) {
    return `arranged holds at most ${MOST_FOLDERS} folders`
  }

  return null
}

/** The names of one folder's children, each once and in the order they arrived. A
 *  value that is no list at all is no order, and answers with nothing rather than
 *  being read around.
 *
 *  A set beside the list rather than asking the list itself, which is the one place
 *  this differs from the exclusions: two hundred folders of five hundred names each is
 *  a quarter of a million comparisons done the other way, on a request a client may
 *  send whenever it likes. */
function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const out: string[] = []

  for (const one of value) {
    if (out.length >= MOST_NAMES) break
    if (typeof one !== 'string' || !isName(one) || seen.has(one)) continue

    seen.add(one)
    out.push(one)
  }

  return out
}

/** The entries that are a folder in this space with an order on it, and nothing else.
 *  The one place the two directions agree: what a PUT keeps is what a read gives back.
 *
 *  A folder whose list comes to nothing is left out rather than kept empty. An empty
 *  list says exactly what no entry says - every child in name order - and of two ways
 *  to say one thing the column holds the shorter.
 *
 *  Not exported: both directions reach it through `readArranged` and the route's own
 *  write, and a reader of the column is a reader of one of those. */
function arrangedMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const kept: [string, string[]][] = []

  for (const [path, listed] of Object.entries(value)) {
    if (kept.length >= MOST_FOLDERS) break
    if (!inside(path)) continue

    const names = namesOf(listed)
    if (names.length) kept.push([path, names])
  }

  // Gathered and then made into a map, the way the icons are, rather than a key set on
  // an object as the loop goes: a key called `__proto__` assigned that way becomes the
  // object's prototype instead of an entry in it, and `__proto__` is a name a folder on
  // somebody's disk is allowed to have.
  return Object.fromEntries(kept)
}

/** The column, as the app reads it back. Anything in it that is not a folder with an
 *  order on it is left out: the column is written whole by clients, and a newer one may
 *  have arranged something this version has never heard of. */
export function readArranged(raw: string): Record<string, string[]> {
  return arrangedMap(objectIn(raw))
}

export const spaceArranged = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The map, whole. Reading it needs no route of its own: the space listing carries it,
 *  so one request brings the order of every folder of every space along with its
 *  name. */
// The order is the space's rather than the reader's: everyone in it sees the same
// tree, so arranging a folder is writing in the space.
spaceArranged.put('/:id/arranged', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.arranged
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the entries that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = arrangedMap(sent)
  const written = JSON.stringify(kept)
  if (!fits(written, 'arranged')) {
    return context.json({ error: 'that is more arranged folders than a space holds' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that
  // changed learns that this one did.
  await writeColumn(context.env, 'arranged', space.id, written)

  return context.json({ arranged: kept })
})
