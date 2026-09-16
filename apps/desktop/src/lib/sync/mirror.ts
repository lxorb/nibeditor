/** One space, moved between this machine and the account.
 *
 *  A pass over a space is two halves: take what the server has, then offer
 *  what we have. Neither knows anything about the loop that calls them - how
 *  often, when to give up, what the light says - which is the store next door.
 *
 *  What makes it work without diffing whole documents is the hash of each note
 *  as it stood after the last pass. A local hash that no longer matches means
 *  the file changed here; a version that has moved means it changed there; and
 *  both at once is the only case that needs a decision. That decision is
 *  always the same one: never silently drop an edit.
 *
 *  For a note that is a conflict copy: the other side's copy lands beside ours
 *  with a name that says where it came from, because two people typing in one
 *  paragraph is not something a machine can settle. For a canvas it is a merge,
 *  because a canvas can be settled: everything on it has an id and a time, so
 *  the union of the two keeps every card and every stroke either device drew
 *  and nobody has to go looking for a second file. See canvas-merge.ts. */

import { isCanvasTarget, isPagesTarget, isPdfTarget } from '@nib/markdown/links'
import { conflictPath } from '@nib/markdown/paths'
import { api, ApiError, type SpaceFile } from '../api'
import { without } from '../records'
import { isNumber, isRecord, isString } from '../stored'
import { relativeTo } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { isUntouchedWelcome } from '../welcome'
import { type Clash, type ConflictRule, DEFAULT_RULE } from './conflicts'
import type { Entry } from '../workspace.svelte'

/** What the last sync left on disk, so local edits can be told apart from
 *  remote ones without diffing whole documents. */
interface Tracked {
  id: string
  version: number
  hash: string
}

/** A PDF beside the notes, as the last pass left it. When the file was last
 *  written is what says whether it is worth reading and hashing again: a paper is
 *  tens of megabytes, and a pass runs every few minutes. */
interface TrackedFile {
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
   *  See `mine` in `pull`: whose writing this is, is something a device records,
   *  never something it works out from two hashes failing to match. */
  offered: Record<string, string>
  /** The PDFs beside the notes; see `pushFiles`. */
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

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
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

/** A page of changes with the notes somebody is waiting on at the front.
 *
 *  Partitioned rather than sorted, so everything keeps the order the account sent
 *  it in and only the wanted few move. Which end of a page a note is fetched from
 *  makes no difference to what is written: each note is settled against the file
 *  beside it and nothing else, and the cursor moves only once the page is through.
 *  See `pull`. */
function ordered<T extends { path: string }>(
  notes: readonly T[],
  wanted: ReadonlySet<string> | undefined,
): readonly T[] {
  if (!wanted?.size) return notes

  const first = notes.filter((one) => wanted.has(one.path))
  if (!first.length) return notes

  return [...first, ...notes.filter((one) => !wanted.has(one.path))]
}

/** Whether a path the account named can be joined onto a space's folder.
 *
 *  The listing arrives over the network, and in a shared space the names in it
 *  were written by somebody else: a path that climbs out with `..`, or names a
 *  disk of its own, would have the pass write a file anywhere on this machine
 *  the person can write. Nothing below the folder can say that, so a name that
 *  does is not a note to place at all. Both separators, because which one a
 *  path uses says nothing about where it points. */
function placeable(path: string): boolean {
  if (!path || /^[a-zA-Z]:/.test(path) || /^[\\/]/.test(path)) return false

  return path.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Whether a file on this disk is the same words the account's hash names.
 *
 *  Byte for byte, or the same text written with the other line ending. A file that
 *  was already on this machine with Windows line endings keeps them whenever the
 *  app writes it - see `as_written` in src-tauri/src/notes.rs, which is there so
 *  that correcting one word does not rewrite every line of the file - so its bytes
 *  never hash to what the account holds however exactly the two agree. Reading that
 *  as "somebody wrote here" would put a conflict copy beside every note in such a
 *  folder, on every pass.
 *
 *  The second digest is only ever worked out for a file that has a carriage return
 *  in it, so the ordinary case costs exactly one. */
async function holdsSameWords(local: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if ((await sha256(local)) === hash) return true
  if (!local.includes('\r')) return false

  return (await sha256(local.replace(/\r\n/gu, '\n'))) === hash
}

/** Writes a note that came from the account, keeping whatever the file said before
 *  it as a version first.
 *
 *  Saving keeps a version of the words it is about to replace; this is the other
 *  half of that. Words arriving from the account replace a file just as thoroughly
 *  as a save does, and they were the one overwrite that left nothing behind - so a
 *  note another device got wrong, or a conflict settled the wrong way round, was
 *  recoverable from every device except the one it landed on. Both platforms keep
 *  these the way a save's are kept, so they are in the same version history and the
 *  same sheet puts them back; see recovery.svelte.ts.
 *
 *  `was` is the body the pass has already read, when it has one. Anything else is
 *  read here, because a version of what is being replaced is the whole point: the
 *  conflict copies are written to a name that is usually free, and a second
 *  conflict in one day would otherwise land on the first without a word.
 *
 *  Nothing is kept for a file that is new, that says nothing, or that already says
 *  exactly this. Both platforms drop a version that repeats the one before it
 *  anyway; this saves them the round trip.
 *
 *  Exported for the room's side of the same question, which keeps the same copy
 *  beside a note under the same name and wants the same version kept on the way
 *  past; see rooms/apart.ts. */
export async function writeDown(path: string, content: string, was?: string | null) {
  const previous =
    was === undefined ? await invoke<string>('read_note', { path }).catch(() => null) : was

  if (previous !== null && previous !== content && previous.trim()) {
    await invoke('snapshot_note', { path, content: previous }).catch(() => undefined)
  }

  await invoke('write_note', { path, content })
}

/** Whether the copy the account holds was written after the file here.
 *
 *  The file's own stamp, which is what the watcher already reads. A platform that
 *  keeps none - the browser, where a note is a row rather than a file - answers
 *  that theirs is newer: the copy that travelled is the one more likely to have
 *  been written last, and the other is in this device's history either way. */
async function theirsIsNewer(path: string, updatedAt: number): Promise<boolean> {
  const stamp = await invoke<number | null>('file_stamp', { path }).catch(() => null)
  return stamp === null || updatedAt > stamp
}

function flatten(entry: Entry): Entry[] {
  const out: Entry[] = []
  const walk = (node: Entry) => {
    for (const child of node.children) {
      if (child.is_dir) walk(child)
      else out.push(child)
    }
  }
  walk(entry)
  return out
}

/** Whether a note is in a room, by its id on the account.
 *
 *  A note in a room has one truth and it is the room's: every device in it holds
 *  the same characters, and the room writes them into the account itself. So a
 *  pass neither pushes such a note - there is nothing here the room has not
 *  already carried - nor treats a version it has not seen as a disagreement. The
 *  copy that comes down is simply written, and no conflict copy is ever made for
 *  it, because two devices typing in one paragraph is exactly what the room has
 *  already settled.
 *
 *  A question rather than a list, and asked again at every note and after every
 *  refusal. A pass is seconds of round trips and a room settles the moment somebody
 *  stops typing, so a list taken at the top of a pass is a list from before both:
 *  the note whose room settled halfway through went up as a file naming a version
 *  the account had just moved past, the 409 that came back was read as a second
 *  writer, and the machine that had been typing in that one note the whole time was
 *  left with a second copy of it. A set answers this shape too, which is what a test
 *  hands in when there are no rooms at all.
 *
 *  Handed in rather than imported so this file stays about moving files: the store
 *  next door is what knows about rooms. */
export interface Joined {
  has(id: string): boolean
}

/** Whoever is waiting on a pass, and what they need out of it while it runs.
 *
 *  Handed in for the same reason `joined` is: this file stays about moving files,
 *  and the store next door is what knows who is waiting. See sync.svelte.ts and
 *  arriving.svelte.ts.
 *
 *  None of it changes what the pass does to a file. The names go out earlier and
 *  the bodies come down in a different order; every write, every comparison and
 *  every conflict copy is the one it always was. */
export interface Waiting {
  /** Every note a page of changes named, by the path it will have here, said
   *  before a single body has been asked for. This is what lets the file list be
   *  right within a second of signing in. */
  listed?: (paths: string[]) => void
  /** One note written, by the path it landed at. */
  wrote?: (path: string) => void
  /** Notes to fetch first, by their path in the space: the one somebody is looking
   *  at, and the one they were looking at last. A page is a few hundred notes and
   *  a slow connection is a body a second, so which end of it the open note is at
   *  is the difference between reading it now and reading it in five minutes. */
  wanted?: ReadonlySet<string>
  /** What to do when the same note was written in two places. Handed in rather
   *  than read here, so the pass has no opinion about where a setting lives; see
   *  sync/conflicts.ts. */
  rule?: ConflictRule
  /** One note the two copies disagree about, for the rule that leaves it alone
   *  and says so. */
  clashed?: (clash: Clash) => void
  /** Notes not to send, because a clash about them is still waiting for an
   *  answer: pushing one is exactly what would write over the copy nobody has
   *  looked at yet. */
  held?: ReadonlySet<string>
}

/** Takes what the account has moved on to. Answers whether anything did. */
export async function pull(
  mirror: Mirror,
  token: string,
  joined: Joined,
  waiting?: Waiting,
): Promise<boolean> {
  // Read once: a rename lands in `renamed` while a pass is in the air, and a
  // pass that changed folder halfway would join the new root onto paths it
  // listed under the old one.
  const root = mirror.root
  let moved = false

  for (;;) {
    const page = await api.changes(token, mirror.spaceId, mirror.cursor)
    if (page.notes.length) moved = true

    // The names, at once. One page of changes is the whole listing of a space the
    // account has and this machine has not, and it arrives a request in: the file
    // list can be drawn from it while the bodies below take as long as they take.
    waiting?.listed?.(
      page.notes
        .filter((one) => !one.deleted && placeable(one.path))
        .map((one) => joinPath(root, one.path)),
    )

    for (const remote of ordered(page.notes, waiting?.wanted)) {
      // A name that would land outside the space is left where it is; see
      // `placeable`.
      if (!placeable(remote.path)) continue

      const target = joinPath(root, remote.path)

      if (remote.deleted) {
        if (mirror.notes[remote.path]) {
          await invoke('delete_note', { path: target }).catch(() => undefined)
          mirror.notes = without(mirror.notes, remote.path)
        }
        // A write that was in the air about a note that has since gone says nothing
        // about whatever is made at that name next.
        mirror.offered = without(mirror.offered, remote.path)
        continue
      }

      const tracked = mirror.notes[remote.path]
      if (tracked?.version === remote.version) continue

      const local = await invoke<string>('read_note', { path: target }).catch(() => null)

      // A note this machine has an entry for and no longer has a file for is one
      // that went away here - renamed, moved or deleted - rather than one it has
      // never seen. Both are "the account has it and the folder does not", and only
      // the entry tells them apart.
      //
      // Writing it down again undoes what somebody did. A rename is the case that
      // showed it: the file leaves under one name and arrives under another, nothing
      // tells the mirror, and the pass is what reads it off the folder. The pull put
      // the old name back on the disk, so the push below found the file present,
      // skipped its own "a file that vanished locally is a delete" - and the account
      // was left holding both names alive, with every other machine downloading the
      // one nobody has any more. The entry is left exactly as it is, so the push sees
      // the gap and deletes the note the way it always has.
      if (local === null && tracked !== undefined) continue

      // The file and the account already say the same thing, so there is nothing
      // to bring down and nothing to settle: the entry is recorded and the note is
      // done with. This is what mends a mirror that has lost entries - the note is
      // found agreeing rather than judged - and it is the whole of a pass over a
      // space nothing has changed, without a body being fetched for any of it.
      if (local !== null && (await holdsSameWords(local, remote.hash))) {
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        waiting?.wrote?.(target)
        continue
      }

      const { content } = await api.readNote(token, remote.id)

      // Whether the copy up there says anything this machine has not said itself.
      //
      // Two ways it can be this device's own writing come back, and both of them are
      // things the device wrote down rather than worked out: the body the last pass
      // left the two agreeing on, and the body handed over whose answer never
      // arrived. Either way there is no second writer in it however far the file has
      // moved on since - the keystrokes after the push are simply what the push below
      // will offer next.
      //
      // And a mirror that threw its note table away to fit in storage cannot say
      // anything is news: the gap is its own doing. A folder freshly paired with a
      // space that already held notes is the case that looks exactly like it and is
      // not, and there both copies are kept; see `dropped`.
      //
      // The old rule was the other way round - anything that did not match the one
      // hash the last pass recorded counted as somebody else's writing - and on a
      // machine that is the only one there is, that is every note being typed in
      // whenever a reply went missing. Whose writing this is, is recorded, never
      // inferred from two hashes failing to match.
      const news =
        remote.hash !== tracked?.hash &&
        !(remote.hash && remote.hash === mirror.offered[remote.path]) &&
        !(tracked === undefined && mirror.dropped)

      // Whether the file here also carries writing the account has never seen, which
      // is the other half of a disagreement. With an entry to compare against the
      // answer is exact: a file whose words have moved since the last pass was
      // written here. Without one there is nothing to compare and the safe answer is
      // that it was.
      //
      // A note in a room is the exception either way: the room settled the two
      // character by character before either of them ever became a file. And the
      // app's own welcome note is nobody's writing, so it is simply replaced.
      const diverged =
        local !== null &&
        news &&
        !joined.has(remote.id) &&
        !isUntouchedWelcome(remote.path, local) &&
        (tracked === undefined || !(await holdsSameWords(local, tracked.hash)))

      // Nothing up there this machine has not said, and a file that has moved on
      // since it said it. The version is written down so the pass stops asking, and
      // the file is left exactly as it is for the push below to offer. Writing the
      // account's copy over it is what the line at the bottom does, and it would
      // throw away every keystroke typed since the push.
      if (!news && local !== null && local !== content) {
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        continue
      }

      if (diverged && local !== content) {
        // A canvas is put back together rather than copied: both drawings are
        // kept, and what is written here is already the answer both devices
        // will settle on, since the merge gives the same file either way round.
        // Which is the same answer under every rule: nothing was lost, so there
        // is nothing to choose between.
        // A page note merges the way a canvas does, because it is the same file: the
        // same objects with the same ids and the same times, so the union keeps every
        // stroke either device wrote and every page either of them added.
        //
        // The merge itself is fetched by the first plane that needs one: it is the
        // whole JSON Canvas format, and a pass that has only notes in it has nothing
        // to merge. See canvas-merge.ts.
        const together =
          isCanvasTarget(remote.path) || isPagesTarget(remote.path)
            ? (await import('@nib/markdown/canvas-merge')).mergeCanvasFiles(local, content)
            : null

        if (together !== null) {
          await writeDown(target, together, local)
          // The account's copy, which the merged file is now ahead of: the push
          // below sees the two differ and sends, and a room joined afterwards is
          // told the truth about what the account last handed this device. An
          // empty hash used to stand here to force that push, and a room reading
          // it matched neither side and asked for a conflict copy of its own; see
          // `startedFrom` in rooms/room.ts.
          mirror.notes[remote.path] = {
            id: remote.id,
            version: remote.version,
            hash: remote.hash,
          }
          waiting?.wrote?.(target)
          continue
        }

        const rule = waiting?.rule ?? DEFAULT_RULE

        // Left exactly as it is, with the other copy held for somebody to look
        // at. The entry takes the version we just saw so the pass stops asking
        // about it, and `held` keeps the push below from sending ours over it.
        if (rule === 'ask') {
          waiting?.clashed?.({
            path: target,
            id: remote.id,
            version: remote.version,
            theirs: content,
            at: Date.now(),
          })

          // The one place an empty hash is the truth: nothing was settled, so there
          // is no body the two sides agree on. A room joining this note reads it as
          // "I cannot tell" and asks the same question again rather than writing
          // either copy over the other, which is what `ask` means.
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: '' }
          continue
        }

        // The later of the two stands. What loses is in this device's own
        // history either way - `writeDown` keeps it on the way past - which is
        // what makes this safe rather than lossy.
        if (rule === 'newest' && (await theirsIsNewer(target, remote.updatedAt))) {
          await writeDown(target, content, local)
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
          waiting?.wrote?.(target)
          continue
        }

        if (rule === 'both') await writeDown(conflictPath(target), content)

        // The account's copy, which ours is now beside rather than in step with:
        // the push below sees the two differ and sends ours on top of the version
        // we just saw, so it lands as the newest one. Truthful rather than empty,
        // for the reason the merge above gives.
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        waiting?.wrote?.(target)
        continue
      }

      await writeDown(target, content, local)
      mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
      waiting?.wrote?.(target)
    }

    // A page saying there is more that hands back the cursor it was given would
    // be asked for forever: the pass would never end, the loop would never set
    // its next timer, and a first sync would never let anybody in.
    const asked = mirror.cursor
    mirror.cursor = page.cursor
    if (!page.more || page.cursor === asked) break
  }

  return moved
}

/** Offers what this machine has. Answers whether anything moved. */
/** What the caller wants to know about, and to keep out of, a push. */
export interface Sending {
  /** Notes waiting for an answer about two copies, which are not sent: sending
   *  one is what would write over the copy nobody has read yet. Paths as this
   *  machine spells them; see sync/conflicts.ts. */
  held?: ReadonlySet<string>
  /** One note sent, by its path in the space. What the log counts. */
  sent?: (path: string) => void
}

export async function push(
  mirror: Mirror,
  token: string,
  joined: Joined,
  sending: Sending = {},
): Promise<boolean> {
  const held = sending.held ?? new Set<string>()
  // Read once, for the same reason as in `pull`.
  const root = mirror.root
  const tree = await invoke<Entry>('read_tree', { root }).catch(() => null)
  if (!tree) return false

  const listed = flatten(tree)
  const seen = new Set<string>()
  let moved = false

  // A PDF is bytes rather than words, so it goes up as a blob and the space
  // records where in it the file sits; see `pushFiles`.
  if (await pushFiles(mirror, root, listed, token)) moved = true

  for (const file of listed.filter((one) => !isPdfTarget(one.name))) {
    const path = relativeTo(root, file.path)
    seen.add(path)

    // A note whose two copies are still waiting for an answer stays where it is,
    // on both sides: this is the one file the pass deliberately leaves alone.
    if (held.has(file.path)) continue

    const content = await invoke<string>('read_note', { path: file.path })
    const hash = await sha256(content)
    const tracked = mirror.notes[path]

    if (!tracked) {
      // The app's own welcome note, exactly as the app wrote it, is not writing
      // and does not belong in anybody's account. It used to go up on every launch
      // of the plugin, whose storage is empty every launch, and come back each time
      // Emil deleted it. A character typed into it makes it his and it travels like
      // any other note. See welcome.ts.
      if (isUntouchedWelcome(path, content)) continue

      if (await create(mirror, token, path, content)) moved = true
      continue
    }

    if (tracked.hash === hash) continue

    // A note in a room has already been carried up by the room, keystroke by
    // keystroke, and the room is what writes it into the account. Sending the file
    // as well would be a second writer for one note.
    if (joined.has(tracked.id)) {
      continue
    }

    moved = true

    // Said before the request goes out, because the case it answers is the answer
    // that never comes back: the write lands, the reply is lost, and this is the
    // only record that the copy the account now holds is this machine's own. See
    // `offered` and `mine` in `pull`.
    mirror.offered = { ...mirror.offered, [path]: hash }

    try {
      const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
      mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
      mirror.offered = without(mirror.offered, path)
      sending.sent?.(path)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error

      // The note's room settled while this write was in the air, which is this
      // device losing to itself: the version the account moved on to is its own
      // keystrokes, carried up one at a time by the room this same tab is in. The
      // file and the room are two ways out of one document, so nothing in what was
      // sent is missing from what landed. Where the account got to is written down
      // and the note is left to the room - which is where the question above would
      // have left it had it been asked a moment later. Asked now rather than trusted
      // from before the request, for the reason `Joined` gives.
      if (joined.has(tracked.id) && caughtUpWith(mirror, path, error.body)) continue

      await keepBoth(mirror, path, tracked, error.body, token)
    }
  }

  // A file that vanished locally is a delete, not a gap.
  for (const [path, tracked] of Object.entries(mirror.notes)) {
    if (seen.has(path)) continue

    await api.deleteNote(token, tracked.id).catch(() => undefined)
    mirror.notes = without(mirror.notes, path)
    mirror.offered = without(mirror.offered, path)
    moved = true
  }

  return moved
}

/** The PDFs of a space, offered to the account so that a published note linking
 *  one can be served it.
 *
 *  A file goes up the way a pasted picture does: as a blob addressed by the hash
 *  of its bytes. What the space records is where each one sits, and the answer to
 *  that says which hashes the account holds no blob for - which is what makes the
 *  bytes of a thirty megabyte paper travel once and never again.
 *
 *  Nothing comes back down. The list is what makes a paper reachable from a
 *  published page; a second machine gets its PDFs the way it got them the first
 *  time, which is by somebody putting them in the folder. */
async function pushFiles(
  mirror: Mirror,
  root: string,
  listed: readonly Entry[],
  token: string,
): Promise<boolean> {
  const held: Record<string, TrackedFile> = {}
  const manifest: SpaceFile[] = []

  for (const file of listed) {
    const path = relativeTo(root, file.path)
    if (!isPdfTarget(file.name) && !dressesTheSite(path)) continue

    const tracked = mirror.files[path]
    // Read and hashed again only when the file has been written since, so a
    // paper nobody has touched costs nothing at all.
    const hash = tracked?.modified === file.modified ? tracked.hash : await hashFile(file.path)
    if (hash === null) continue

    held[path] = { hash, modified: file.modified }
    manifest.push({ path, hash })
  }

  if (same(mirror.files, held)) return false

  const { missing } = await api.saveSpaceFiles(token, mirror.spaceId, manifest)

  // What the account could not keep is what it has no bytes for. Those go up
  // now, and the list is offered again so their rows land as well.
  if (missing.length) {
    const wanted = new Set(missing)

    for (const file of manifest) {
      if (!wanted.has(file.hash)) continue

      const bytes = await invoke<ArrayBuffer>('read_file', {
        path: joinPath(root, file.path),
      }).catch(() => null)
      if (bytes) await api.putBlob(token, file.hash, contentTypeOf(file.path), bytes)
    }

    await api.saveSpaceFiles(token, mirror.spaceId, manifest)
  }

  mirror.files = held
  return true
}

/** The two files a site is dressed with, by Obsidian Publish's own names: a
 *  stylesheet and a script at the root of the space. They travel with the papers
 *  because they travel the same way - the bytes as a blob, the name in the
 *  space's list - and a space that has neither is unaffected. See
 *  docs/publishing.md. */
const DRESSING = new Set(['publish.css', 'publish.js'])

function dressesTheSite(path: string): boolean {
  return DRESSING.has(path.toLowerCase())
}

function contentTypeOf(path: string): string {
  if (path.toLowerCase().endsWith('.css')) return 'text/css'
  if (path.toLowerCase().endsWith('.js')) return 'text/javascript'

  return 'application/pdf'
}

/** The hash of a file's bytes, or null when it cannot be read - a paper deleted
 *  between the listing and here is nothing to report. */
async function hashFile(path: string): Promise<string | null> {
  const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
  return bytes === null ? null : hex(await crypto.subtle.digest('SHA-256', bytes))
}

/** Whether two lists of files say the same thing, so a space nobody has changed
 *  costs no request at all. */
function same(was: Record<string, TrackedFile>, now: Record<string, TrackedFile>): boolean {
  const paths = Object.keys(now)

  return (
    paths.length === Object.keys(was).length &&
    paths.every((path) => was[path]?.hash === now[path]?.hash)
  )
}

/** Never silently drop an edit. A canvas is merged into one file that has
 *  everything both devices drew; anything else keeps the other side's copy
 *  beside ours, since two people typing in one paragraph cannot be settled by a
 *  machine. */
/** A note this machine has and the mirror has never heard of, offered to the
 *  account.
 *
 *  The account may already hold that path - this machine forgot its mirror, two
 *  devices made the same note, a folder was moved back - and the space allows one
 *  live note per path, so it answers 409 with the note that is there. That is a
 *  pairing, not a failure: the two are recorded as one note, and whichever text
 *  differs is settled the way any other conflict is. Before this, the 409 threw
 *  and took the whole pass with it, and the pass came round again to throw again.
 *
 *  Answers whether anything moved. */
async function create(
  mirror: Mirror,
  token: string,
  path: string,
  content: string,
): Promise<boolean> {
  // For the reason the push gives: a create whose answer is lost leaves the account
  // holding a note this machine has no entry for and made itself.
  const offered = await sha256(content)
  mirror.offered = { ...mirror.offered, [path]: offered }

  try {
    const { note } = await api.createNote(token, mirror.spaceId, path, content)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    mirror.offered = without(mirror.offered, path)
    return true
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error

    const body = isRecord(error.body) ? error.body : {}
    const theirs = isRecord(body.note) ? body.note : null
    if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) throw error

    const tracked: Tracked = { id: theirs.id, version: theirs.version, hash: theirs.hash }
    mirror.notes[path] = tracked

    // The same words on both sides: paired, and there is nothing to send. Told by
    // the account's own hash rather than by hashing again, which is what the rest
    // of this file compares against too.
    const hash = await sha256(content)
    if (hash === tracked.hash) {
      mirror.offered = without(mirror.offered, path)
      return false
    }

    // The note up there is one this machine wrote itself, on a pass whose answer
    // never arrived - the create landed, the reply did not, and there is no entry
    // because of it. Paired and left to the next push, which offers what the file
    // says now. A second copy of somebody's own note is not an answer to anything.
    if (mirror.offered[path] && tracked.hash === mirror.offered[path]) return false

    // Two notes at one path with different words is the conflict this file has
    // always had an answer for: neither is dropped.
    await keepBoth(mirror, path, tracked, body, token)
    return true
  }
}

/** Where the account says it has got to, written down out of the refusal that says
 *  it. What the pass does with a note it has just learned it is behind on is ask
 *  about it from there rather than from the version it was refused on.
 *
 *  Answers whether the refusal named a copy at all: a body that does not read as one
 *  says nothing to write down, and the caller settles it the way it always has. */
function caughtUpWith(mirror: Mirror, path: string, refusal: unknown): boolean {
  const body = isRecord(refusal) ? refusal : {}
  const theirs = isRecord(body.note) ? body.note : null
  if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) return false

  mirror.notes[path] = { id: theirs.id, version: theirs.version, hash: theirs.hash }
  // Nothing of this device's is in the air any more: the write it was about was
  // refused rather than lost. See `offered`.
  mirror.offered = without(mirror.offered, path)
  return true
}

async function keepBoth(
  mirror: Mirror,
  path: string,
  tracked: Tracked,
  conflict: unknown,
  token: string,
) {
  // The body of a 409 is whatever the server sent; only a real version to
  // base the next write on makes this worth doing at all.
  const server = isRecord(conflict) ? conflict : {}
  const theirs = isRecord(server.note) ? server.note : null
  if (typeof theirs?.version !== 'number') return

  const here = joinPath(mirror.root, path)
  const sent = isString(server.content) ? server.content : ''
  const ours = await invoke<string>('read_note', { path: here })

  if (isCanvasTarget(path) || isPagesTarget(path)) {
    // Fetched with the first plane that clashes, like the merge above it.
    const { mergeCanvasFiles } = await import('@nib/markdown/canvas-merge')
    const together = mergeCanvasFiles(ours, sent)
    await writeDown(here, together, ours)
    const { note } = await api.writeNote(token, tracked.id, path, together, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  await writeDown(conflictPath(here), sent)

  // Our version is now the newer one; write it over the server's.
  const { note } = await api.writeNote(token, tracked.id, path, ours, theirs.version)
  mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
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
