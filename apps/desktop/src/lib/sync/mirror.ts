/** What this machine remembers about one space it mirrors: the notes and files the
 *  last pass left on disk, and how that record is read back from storage.
 *
 *  Kept apart from the pass itself, which is sync/pass.ts: the store reads these
 *  records at launch, and the pass that moves the notes is fetched with the first
 *  pass, after the window is up. */

import { isNumber, isRecord, isString } from '../stored'
import { invoke } from '../tauri'

/** What the last sync left on disk, so local edits can be told apart from
 *  remote ones without diffing whole documents. */
export interface Tracked {
  id: string
  version: number
  hash: string
}

/** A PDF beside the notes, as the last pass left it. When the file was last
 *  written is what says whether it is worth reading and hashing again: a paper is
 *  tens of megabytes, and a pass runs every few minutes. */
export interface TrackedFile {
  hash: string
  modified: number
}

/** One local space folder and the remote space it mirrors. Keyed by `root`,
 *  because the folder is the thing that persists across launches. */
export interface Mirror {
  spaceId: string
  root: string
  cursor: number
  notes: Record<string, Tracked>
  /** The bodies this device has handed the account and not heard the answer to,
   *  by path. Normally empty: an entry goes in the moment before the request and
   *  comes out with the reply, so it holds a hash only for as long as a write is
   *  in the air.
   *
   *  It is there for the reply that never comes. A write that lands and whose
   *  answer is lost - a connection dropped, a window closed inside a pass, a
   *  worker that took too long - leaves the account a version ahead of what this
   *  machine wrote down, and the next keystroke leaves the file differing from
   *  both. Without this the pass had no way to tell that the copy up there is its
   *  own writing come back, read the difference as a second writer, and put a
   *  conflict copy beside a note one person had been typing in the whole time.
   *  See `news` in `pull`, in pass.ts: whose writing this is, is something a device records,
   *  never something it works out from two hashes failing to match. */
  offered: Record<string, string>
  /** The PDFs beside the notes; see `pushFiles` in pass.ts. */
  files: Record<string, TrackedFile>
  /** Whether the note table above was thrown away to fit in storage rather than
   *  never written; see `withoutCaches` in sync.svelte.ts.
   *
   *  The two look the same - no entry for a note the account holds - and they mean
   *  opposite things. A folder freshly paired with a space that already held notes
   *  really may have two writers in it, and both copies are kept. A mirror that had
   *  the entries and dropped them has exactly one writer as far as anybody knows,
   *  and reading its own gap as a stranger is what made a second file appear beside
   *  a note nobody else had ever opened. */
  dropped: boolean
  /** Whether the space belongs to somebody else. Remembered here rather than
   *  read off the account's listing, because the moment it matters is the
   *  moment the space has gone from that listing: a folder somebody stopped
   *  sharing must go, where one of the account's own that is merely missing is
   *  uploaded again. */
  shared: boolean
}

/** A folder just paired with a space, which knows nothing about it yet. One
 *  place, so a new field cannot be forgotten at one of the five call sites. */
export function newMirror(spaceId: string, root: string, shared = false): Mirror {
  return { spaceId, root, cursor: 0, notes: {}, offered: {}, files: {}, dropped: false, shared }
}

/** A file's path as the account names it - relative to the space's folder, with
 *  forward slashes - or null when the file is not in that folder at all.
 *
 *  Which separator a path uses depends on where it came from rather than on what
 *  it points at, so both are read as the same thing. Exported because a note's
 *  room is looked up by this name; see sync.svelte.ts. */
export function within(root: string, path: string): string | null {
  const folder = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = path.replace(/\\/g, '/')

  if (!file.startsWith(`${folder}/`)) return null
  return file.slice(folder.length + 1)
}

export interface Stamp {
  modified: number
  len: number
}

/** A file's last write, in ms, and length; see `file_stamp` in the crate. Null for
 *  no file, the browser, or no answer. The watcher reads it too. */
export async function fileStamp(path: string): Promise<Stamp | null> {
  const found: unknown = await invoke('file_stamp', { path }).catch(() => null)
  return isRecord(found) && isNumber(found.modified) && isNumber(found.len)
    ? { modified: found.modified, len: found.len }
    : null
}

/** One mirror as it was written down, once it reads as one. A mirror with no
 *  space to point at is worse than none: the next pass would sync a folder
 *  against nothing and read every note in it as deleted. */
export function readMirror(root: string, value: unknown): Mirror | null {
  if (!isRecord(value) || !isString(value.spaceId)) return null

  return {
    spaceId: value.spaceId,
    // The key is the folder; an older entry that disagrees with itself takes
    // the key, which is what every lookup goes through.
    root,
    cursor: typeof value.cursor === 'number' ? value.cursor : 0,
    notes: readTracked(value.notes),
    offered: readOffered(value.offered),
    files: readTrackedFiles(value.files),
    // Absent in what an older version wrote, and absent in every full write: only
    // the blob that had to leave its note table behind says so. See `withoutCaches`.
    dropped: value.dropped === true,
    // Written by every version since sharing; an older entry is the account's
    // own space, which is what every space was before there were shared ones.
    shared: value.shared === true,
  }
}

/** The PDFs the last pass knew about. An entry that no longer reads as one is
 *  simply absent, which costs that one file a re-read rather than the whole
 *  list a resend. */
function readTrackedFiles(value: unknown): Record<string, TrackedFile> {
  if (!isRecord(value)) return {}

  const out: Record<string, TrackedFile> = {}
  for (const [path, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.hash) || !isNumber(one.modified)) continue

    out[path] = { hash: one.hash, modified: one.modified }
  }

  return out
}

/** The writes that were in the air when this machine last wrote itself down. A
 *  handful at the very most, and normally none at all. */
function readOffered(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [path, hash] of Object.entries(value)) {
    if (isString(hash) && hash) out[path] = hash
  }

  return out
}

function readTracked(value: unknown): Record<string, Tracked> {
  if (!isRecord(value)) return {}

  const out: Record<string, Tracked> = {}
  for (const [path, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.id) || !isString(one.hash)) continue
    if (typeof one.version !== 'number') continue

    out[path] = { id: one.id, version: one.version, hash: one.hash }
  }

  return out
}
