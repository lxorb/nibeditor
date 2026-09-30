/** Turning the app's paths into the ones a link speaks in, and back.
 *
 *  A note's path on disk is whatever the platform writes: a drive letter and
 *  backslashes on Windows, a slash-separated path elsewhere. A link says
 *  `folder/Note`. One file for the two conversions, because publishing, the link
 *  index and the composer all need them. */

import { insideOnly } from './automation/inside'
import { invoke, isNative, joinPath, platform } from './tauri'

/** One file is one path, however it was spelled.
 *
 *  The same note reaches the app under more than one spelling: a separator of
 *  either kind, an accent composed as one letter or as a letter and a mark (a Mac
 *  keyboard writes the second), and on Windows and on a Mac a capital where the
 *  listing has none, since those disks look `plan.md` up as `Plan.md`. Compared as
 *  written, the two were two notes: two documents over one file, the second write
 *  replacing the first, and a new note under a name the disk already had.
 *
 *  So a path is compared in one place, here, and by one rule: separators made one,
 *  the text composed, and case set aside where the disk sets it aside. Which disks
 *  do is asked of each space's own disk once, the way git asks at `git init`; see
 *  `askCase`. Until it has answered, the platform's habit stands. */
const folding = new Map<string, boolean>()

/** Whether this platform's disks look a name up without its case, as its own
 *  filesystem does by default: NTFS and APFS do, ext4 and the browser build's rows
 *  do not. */
function foldsHere(): boolean {
  const os = platform()
  return os === 'windows' || os === 'macos' || os === 'ios'
}

/** A path's steps, whichever separator wrote them and however many of them there
 *  were between two names, without a separator at its end. The first step of a path
 *  from the top of a disk is empty, or a drive. */
function steps(path: string): string[] {
  const out = path.split(/[\\/]+/)
  while (out.length > 1 && out.at(-1) === '') out.pop()
  return out
}

/** Whether two names are one name: composed alike, and alike but for case where
 *  the disk sets case aside. Which it is, is only asked of two names that differ by
 *  nothing else. */
function sameName(one: string, other: string, folds: () => boolean): boolean {
  if (one === other) return true

  const a = one.normalize('NFC')
  const b = other.normalize('NFC')
  return a === b || (a.toLowerCase() === b.toLowerCase() && folds())
}

/** Whether the disk holding `path` looks names up without their case: the answer
 *  its space's disk gave, or this platform's habit where none has been asked. */
function foldsAt(path: string): boolean {
  for (const [root, folds] of folding) {
    if (holds(steps(root), steps(path), () => true)) return folds
  }

  return foldsHere()
}

/** Whether a folder's steps are where a path's steps begin. */
function holds(head: readonly string[], file: readonly string[], folds: () => boolean): boolean {
  return head.length <= file.length && head.every((one, at) => sameName(one, file[at] ?? '', folds))
}

/** Whether two paths name one file, which is the only way two paths are compared. A
 *  path inside a space as a store keeps it compares the same way, by the habit of
 *  the space's disk, which `root` names. */
export function samePath(
  one: string | null | undefined,
  other: string | null | undefined,
  root?: string,
): boolean {
  if (one === other) return true
  if (one == null || other == null) return false

  const a = steps(one)
  const b = steps(other)
  return a.length === b.length && holds(a, b, () => foldsAt(root ?? one))
}

/** A path as one key: its steps composed alike with `/` between them, in one case
 *  where the disk holding it sets case aside. What a set of paths is kept by, where
 *  asking `samePath` of every member would be a walk. */
export function pathKey(path: string, root?: string): string {
  const key = steps(path)
    .map((one) => one.normalize('NFC'))
    .join('/')
  return foldsAt(root ?? path) ? key.toLowerCase() : key
}

/** The keys of many paths at once, for asking whether one is among them. */
export function pathKeys(paths: Iterable<string>, root?: string): Set<string> {
  return new Set([...paths].map((one) => pathKey(one, root)))
}

/** Whether two paths are written alike, case and all. What a rename asks: a name
 *  that only changes its case names the same file and is still a new name. */
export function sameSpelling(one: string, other: string): boolean {
  const a = steps(one)
  const b = steps(other)
  return a.length === b.length && holds(a, b, () => false)
}

/** Where `path` is inside `folder`: the empty string for the folder itself, what is
 *  left of it with `/` separators for anything under it - spelled as the path spells
 *  it - and null for a path that is neither. `Work` holds `Work/plan.md` and not
 *  `Workshop.md`: a folder is matched a whole step at a time. A folder of `''` is the
 *  top of a space, which holds every path a space speaks. */
export function within(folder: string, path: string, root?: string): string | null {
  if (!folder) return path.replace(/\\/g, '/')

  // The path spelled as the folder spells it, which is nearly every time: the same
  // answer without taking either apart.
  if (path.startsWith(folder) && !/[\\/]$/.test(folder)) {
    const rest = path.slice(folder.length)
    if (!rest || /^[\\/]/.test(rest))
      return rest
        .split(/[\\/]+/)
        .filter(Boolean)
        .join('/')
  }

  const head = steps(folder)
  const file = steps(path)
  return holds(head, file, () => foldsAt(root ?? folder)) ? file.slice(head.length).join('/') : null
}

/** Where `path` is once `from` has moved to `to`: `to` itself, or under it, for a
 *  path that was `from` or under it, and null for one the move did not touch. Said
 *  with `to`'s own separators, so a path on this disk stays one. */
export function movedTo(path: string, from: string, to: string, root?: string): string | null {
  const rest = within(from, path, root)
  if (rest === null) return null
  if (!rest) return to

  return to ? joinPath(to, rest) : rest
}

/** Asks a space's disk, once, whether it looks names up without their case: one of
 *  its files is asked for under its name with every letter's case turned over. The
 *  crate's own tests ask a disk the same way (`ignores_case` in notes.rs). A space
 *  with no file that has a letter in its name has nothing to be confused about yet,
 *  and asks again the next time it is listed. */
export async function askCase(root: string, files: readonly string[]): Promise<void> {
  if (!isNative || folding.has(root)) return

  const probe = files.find((path) => turned(nameOf(path)) !== nameOf(path))
  if (probe === undefined) return

  const other = joinPath(folderOf(probe), turned(nameOf(probe)))
  const found = await invoke<unknown>('file_stamp', { path: other }).catch(() => null)
  folding.set(root, found !== null && found !== undefined)
}

/** Every letter's case turned over. */
function turned(name: string): string {
  return name.replace(/\p{L}/gu, (one) =>
    one === one.toLowerCase() ? one.toUpperCase() : one.toLowerCase(),
  )
}

/** What a disk answered, said by a test in place of asking one. */
export function answeredCase(root: string, folds: boolean | null): void {
  if (folds === null) folding.delete(root)
  else folding.set(root, folds)
}

/** A path inside a space as the space speaks of it: relative to the root, and
 *  with `/` separators whichever the platform writes. */
export function relativeTo(root: string, path: string): string {
  return (root ? within(root, path) : null) ?? path.replace(/\\/g, '/')
}

/** The same, for a path that may not be inside the space at all: null when this
 *  root does not hold it.
 *
 *  `relativeTo` hands a path it does not recognise straight back, because it is
 *  asked about paths already known to be inside a space - every row of the file
 *  list. This is the one to ask about a path that arrived from somewhere else: the
 *  note somebody opened out of a downloads folder, a path read back out of
 *  storage. The root has to hold it, and what is left over has to be something the
 *  space would take, which is `insideOnly` - the same judge a `nib://` link's path
 *  goes through - so a path that climbs back out from under the root is refused
 *  here as it is there.
 *
 *  Both separators, because which one a path is written with says nothing about
 *  where it points. */
export function withinSpace(root: string, path: string): string | null {
  const rest = root ? within(root, path) : null
  return rest ? insideOnly(rest) : null
}

/** The same path back as one the filesystem understands. */
export function insideSpace(root: string, relative: string): string {
  return joinPath(root, relative)
}

/** Where a file a note names could be, in the order to look.
 *
 *  A JSON Canvas file node holds a path and the spec does not say what it is relative
 *  to, so two answers are honest and both are in the wild: Obsidian writes one
 *  relative to the vault, and this app's own PDF import writes the paper's bare name
 *  beside the note it made - the same path when the note is at the top of the space
 *  and a different one when it is in a folder. So both are offered, the note's own
 *  folder first, and whichever is there is the one that reads.
 *
 *  A path of its own - a drive letter, a leading separator - is itself and is offered
 *  alone. A `..` in it is left in: a picture kept in one folder for the whole space is
 *  written that way, and a path that climbs out of the space is refused where every
 *  other path is, by the reader rather than by a second rule here. See
 *  `in_spaces` in src-tauri/src/paths.rs and `normalise` in web/paths.ts.
 *
 *  Ordered, each place once, and empty only for a page that names no file at all. */
export function placesOf(file: string, notePath: string | null, root: string | null): string[] {
  if (!file) return []
  if (/^[/\\]/.test(file) || /^[A-Za-z]:/.test(file)) return [file]

  const out: string[] = []
  const add = (path: string) => {
    if (!out.includes(path)) out.push(path)
  }

  if (notePath) {
    const folder = folderOf(notePath)
    add(folder ? joinPath(folder, file) : file)
  }
  if (root) add(insideSpace(root, file))
  // Neither a note nor a space to resolve against: the name as it stands is the only
  // thing left to try, and the reader is what says whether it is anywhere.
  if (!out.length) add(file)

  return out
}

/** How long a path a store may keep. The service's limit, so nothing is kept
 *  here that would be refused there. */
const LONGEST_PATH = 300

/** Whether a path names something inside its own space, which is what a store
 *  keyed by path will keep.
 *
 *  The same reading the service does: a path on this disk, or one that climbs out
 *  of the space, is not something any machine could resolve, so it is not
 *  something to write down. Here rather than beside each store, because two of
 *  them had the same five clauses word for word; see
 *  services/sync/src/spaces/excluded.ts for the other end of it. */
export function insideItsSpace(path: string): boolean {
  return (
    !!path &&
    path.length <= LONGEST_PATH &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    // A drive letter is the other way a path starts at the root of somebody's
    // disk, and `C:/Users/…` carries no backslash to be caught by the line above.
    !/^[A-Za-z]:/.test(path) &&
    // A path is a name, and a name with a control character in it is two names to
    // whatever reads it next.
    !/\p{Cc}/u.test(path) &&
    !path.split('/').includes('..')
  )
}

/** An absolute path that arrived from outside the app, as a path inside one of
 *  these spaces - or null for one that is inside none of them.
 *
 *  The phone's own road names a note this way round: a widget row is drawn from a
 *  path on disk, so the row hands that path back when it is tapped. The activity
 *  carrying it is exported, which means any app on the phone can send one, so
 *  what arrives is a path only once it is under a root this app knows and the
 *  rest of it has been through `insideOnly` - the same judgement a `nib://` link
 *  gets, in the same place, rather than a second rule that could differ from it.
 *
 *  What comes back is rebuilt from the root rather than handed on as it arrived,
 *  so nothing the caller wrote survives the trip.
 *
 *  Given the roots rather than reading them: which folders are spaces belongs to
 *  the workspace, and what a path may be belongs here. */
export function insideAnyOf(roots: readonly string[], said: string): string | null {
  const folded = said.replace(/\\/g, '/').trim()

  for (const root of roots) {
    if (!root) continue

    // The separator is part of the prefix, so a space at `/notes` does not claim
    // a path in `/notes-elsewhere`.
    const head = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!folded.startsWith(`${head}/`)) continue

    // The separators between the root and the rest are separators, however many
    // of them were written: what is left has to reach `insideOnly` as a relative
    // path or it would be refused for being absolute.
    const safe = insideOnly(folded.slice(head.length).replace(/^\/+/, ''))
    if (safe) return insideSpace(root, safe)
  }

  return null
}

/** Where the last part of a path starts, counting either separator.
 *
 *  Both, so that the two halves of a path split the same way: a path inside a
 *  space is written with slashes, and the same path on disk is written with
 *  whatever the platform writes, which on Windows is backslashes. Asking about
 *  only one of them gave a Windows row the whole path as its name.
 *
 *  Eight modules had written one of the pair below out again - four of them
 *  word for word, and four of them with a different answer at the top of the
 *  tree. */
function cut(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

/** The folder a path sits in, or the empty string for one at the top - which is
 *  the space's own root, said the way a relative path says it. */
export function folderOf(path: string): string {
  return path.slice(0, Math.max(0, cut(path)))
}

/** The last part of a path: a file's name, or a folder's. */
export function nameOf(path: string): string {
  return path.slice(cut(path) + 1)
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** The name a link uses for a note: its file name without the extension. */
export function noteName(relative: string): string {
  return nameOf(relative).replace(MARKDOWN, '')
}

export function withoutExtension(relative: string): string {
  return relative.replace(MARKDOWN, '')
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN.test(path)
}

/** How to get from one folder to a file, as a markdown link would write it. A
 *  file in the same folder is named on its own rather than as `./name`, which is
 *  what a person writing the link by hand would do. */
export function relativePath(fromFolder: string, to: string): string {
  const here = fromFolder ? fromFolder.split('/') : []
  const there = to.split('/')

  let shared = 0
  while (shared < here.length && shared < there.length - 1 && here[shared] === there[shared]) {
    shared++
  }

  const up = Array.from({ length: here.length - shared }, () => '..')
  return [...up, ...there.slice(shared)].join('/')
}
