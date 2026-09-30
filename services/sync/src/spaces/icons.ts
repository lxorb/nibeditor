/** The folder icons of one space: which folder in its file tree wears which
 *  icon, and the colour each of those icons is drawn in.
 *
 *  A map rather than a list, keyed by the folder's path relative to the space -
 *  which is what lets every machine read the same tree. A note keeps its icon in
 *  its own front matter and carries it wherever the file goes; a folder is only a
 *  name in a path, with no file of its own to keep one in, so the space keeps it
 *  and the path says whose it is.
 *
 *  The whole map is written at once rather than one folder at a time, the way
 *  bookmarks are. It is the client's own statement about its tree, and one PUT of
 *  the lot is the only shape in which a folder being renamed - every icon under it
 *  leaving one key and arriving at another - is a single request.
 *
 *  The colours are a second map under the same keys, sent in the same request: an
 *  icon and the colour it is drawn in are picked in one gesture, so one request is
 *  what that gesture costs. Two maps rather than one, because the first is a map of
 *  strings that builds older than this one read and write back whole, and a value
 *  that is not a string is a value they drop - which would be every colour anybody
 *  chose, lost the first time an old build synced. Two columns, the same way round
 *  as the two keys a note keeps: `icon:` and `icon-color:` beside it. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { byteLength, now } from '../crypto'
import { MOST_BYTES } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'
import { deviceOf } from '../sync2/device'
import { v1Wrote } from '../sync2/maps'

/** How many folders of one space may wear an icon. Far more than the sixty
 *  bookmarks a space holds, because these are not a list anybody reads: a big
 *  vault has hundreds of folders and no reason not to mark them all, and one
 *  imported from Obsidian's Iconize plugin arrives with every folder it had
 *  already marked. The app holds itself to the same number, so a map that fits
 *  there fits here; see workspace/folder-icons.svelte.ts. */
const MOST = 400
/** A path inside a space, which is a few folder names. */

/** An icon name: what the space's own icon is checked against, plus the hyphen.
 *
 *  The hyphen is the whole difference, and it is not cosmetic. The picker writes
 *  a space's icon as Lucide's library key, `FileText`, while a note writes its own
 *  as Lucide's plain name, `file-text`, which is what the library calls the icon
 *  and what anybody reading the file can look up. A folder is dressed from the
 *  same picker as a note, so the same names arrive here - and without the hyphen
 *  every one of them would be dropped as not an icon. Iconize's `LiFileText`
 *  passes either way. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
/** As long as a value that is not a name may be. A few code points, because an
 *  emoji is often several - a flag, a skin tone, a zero-width join. */
const LONGEST_MARK = 16
/** What says a value is no emoji: letters, digits, whitespace, the separators a
 *  path is made of, or a control character. */
const NOT_A_MARK = /[A-Za-z0-9\s/\\]|\p{Cc}/u
/** And one thing every emoji has: an actual picture in it. Punctuation is not an
 *  icon, and `-` would otherwise read as one for having none of the above. */
const A_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** A set that is not the stroked one, and a name in it: `flat-color-icons:calendar`.
 *  One colon, a name on each side. The app writes the set's own id in front of
 *  anything but Lucide and the emoji, so a column that took only bare names would
 *  drop every coloured icon anybody chose. */
const PREFIXED = /^[a-z][a-z\d-]{0,31}:[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

/** Whether this is an icon a space or a folder can wear.
 *
 *  Three shapes, and the app's own reading of them: a name, `set:name`, or an emoji
 *  written in a name's place - which is what a vault imported from Obsidian's
 *  Iconize plugin brings, and dropping those would be losing an icon somebody had
 *  already chosen. The emoji half is a picture, a length and the absence of
 *  everything else rather than a list of code points: nothing here has to know which
 *  characters make up an emoji, only that a short value with a picture in it and no
 *  letters, digits, spaces or path separators is neither a name nor something a
 *  client could read back as a path.
 *
 *  Read rather than resolved. This service ships no icons and knows no sets: what it
 *  holds the column to is that a value is the shape of an icon, so a newer app can
 *  name a set this one has never heard of and the column carries it. */
export function isIcon(value: string): boolean {
  if (NAME.test(value) || PREFIXED.test(value)) return true
  return value.length <= LONGEST_MARK && A_PICTURE.test(value) && !NOT_A_MARK.test(value)
}

/** A colour a stroked icon may be drawn in: one of the app's own accents, by its
 *  id. `violet`, `teal`, `slate`. */
const TINT = /^[a-z][a-z-]{0,31}$/

/** Whether this is the shape of a colour a space or a folder can be drawn in.
 *
 *  The shape rather than the list, for the reason `isIcon` reads a set it has never
 *  heard of: the accents are the app's, they are named in one file there, and a
 *  palette that gains a colour must not need this service deployed before anybody
 *  can choose it. What the column is held to is that a value is a short lowercase
 *  name - so it cannot be a path, a hex, or anything a client would read back as
 *  something other than an accent it either knows or ignores. See `isIconTint` in
 *  the app's icons.ts, which is where the names actually are. */
export function isTint(value: string): boolean {
  return TINT.test(value)
}

/** Whether this key names a folder in the space rather than somewhere else; see
 *  ./paths. A folder has a name, so an empty key is not one. */
function inside(path: string): boolean {
  return !!path && path.length <= LONGEST_PATH && staysInside(path)
}

/** What is wrong with the map that arrived, as one sentence the app can show, or
 *  null when nothing is.
 *
 *  Only the map itself. A single entry that is not a folder wearing an icon is
 *  dropped rather than refused: the map is written whole, so refusing the request
 *  over one entry the app and this version disagree about would be losing every
 *  icon in the tree. */
function wrong(value: unknown, called: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${called} must be a map`
  if (Object.keys(value).length > MOST) return `${called} holds at most ${MOST} folders`

  return null
}

/** The entries that are a folder in this space with a value this column takes, and
 *  nothing else. The one place the two directions agree: what a PUT keeps is what a
 *  read gives back. Both maps are read by it, since they differ in nothing but what
 *  a value may say. */
function mapOf(value: object, said: (value: string) => boolean): Record<string, string> {
  const kept = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      inside(entry[0]) && typeof entry[1] === 'string' && said(entry[1]),
  )

  return Object.fromEntries(kept.slice(0, MOST))
}

/** A column, as the app reads it back. Anything in it that is not a folder with a
 *  value on it is left out: the column is written whole by clients, and a newer one
 *  may keep an icon this version has never heard of. */
function read(raw: string, said: (value: string) => boolean): Record<string, string> {
  const held = objectIn(raw)
  return held ? mapOf(held, said) : {}
}

export function readIcons(raw: string): Record<string, string> {
  return read(raw, isIcon)
}

/** And the colours, under the same keys. A colour whose folder wears no icon this
 *  build knows is still kept: which icon a folder wears and which colour it is drawn
 *  in are written by the same gesture but read by two different builds, and dropping
 *  one because the other was unreadable would be losing the half this build
 *  understood. */
export function readTints(raw: string): Record<string, string> {
  return read(raw, isTint)
}

export const folderIcons = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The maps, whole. Reading them needs no route of its own: the space listing
 *  carries them, so one request brings every space's folder icons along with its
 *  name and its own icon.
 *
 *  `tints` may be left out, and then the colours stay as they were - which is what
 *  an app older than this route sends, and it must not undress what a newer one on
 *  the same account coloured. A client that means "no folder is coloured" says so
 *  with an empty map, the same way it undresses every folder. */
// The icons are the space's rather than the reader's: everyone in it sees the
// same tree, so dressing a folder is writing in the space.
folderIcons.put('/:id/icons', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.icons
  const problem = wrong(sent, 'icons')
  if (problem) return context.json({ error: problem }, 400)

  const sentTints = body.tints
  const tintProblem = sentTints === undefined ? null : wrong(sentTints, 'tints')
  if (tintProblem) return context.json({ error: tintProblem }, 400)

  // Written from the entries that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = mapOf(sent as object, isIcon)
  const tints = sentTints === undefined ? null : mapOf(sentTints as object, isTint)
  const written = JSON.stringify(kept)
  const writtenTints = tints === null ? null : JSON.stringify(tints)
  // Both maps against the one ceiling: what a space keeps about its folders is the
  // two together, and either alone could otherwise fill the listing. See ./columns.
  if (byteLength(written) + byteLength(writtenTints ?? '') > MOST_BYTES.icons) {
    return context.json({ error: 'that is more folder icons than a space holds' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that
  // changed learns that this one did.
  await context.env.DB.prepare(
    'update spaces set icons = ?1, tints = coalesce(?2, tints), updated_at = ?3 where id = ?4',
  )
    .bind(written, writtenTints, now(), space.id)
    .run()
  // And, in a space sync v2 keeps entry by entry, every icon as one; see sync2/maps.ts.
  await v1Wrote(
    context.env,
    space,
    'icon',
    { icons: kept, tints: tints ?? readTints(space.tints) },
    await deviceOf(context),
  )

  // What was kept, both maps, so a client can see what a colour it sent was read
  // as. The colours are answered even when none were sent: the reply says what the
  // space now holds rather than what this request was about.
  return context.json({ icons: kept, tints: tints ?? readTints(space.tints) })
})
