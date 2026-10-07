/** A space's first v2 pass, and the way back to v1 (docs/sync-v2.md section 11).
 *
 *  **The first pass**, for a space this device kept under v1 or has never kept at all.
 *  The account is asked to prepare the space (its folders become rows, its notes go on
 *  their first epoch, each seeded from the words it has), the whole feed is read, and
 *  every file in the folder is matched to the entry it is: by the id v1's mirror had
 *  for its path first, so a note renamed on another device is still this file, and by
 *  its place otherwise. Then, for each note, whichever row of section 11's table it is:
 *
 *  - the file still reads as v1 last left it, and that is the epoch's words: the
 *    document is the seed of the file, made here, nothing downloaded - the same bytes the
 *    account seeded, so the pull that follows brings only what came since;
 *  - the file still reads as v1 last left it and the account moved on: the account's
 *    document, and the file is written from it (a version of the old one kept first);
 *  - the file moved and the account did not: the account's document, and the file's
 *    words as this device's pending edits on it;
 *  - both moved: the ancestor is the words v1 last agreed on, from the account's
 *    versions, and the file goes through the classifier like any offline edit - merged,
 *    or held for the question. With no ancestor to be had, a text that holds the other
 *    whole wins quietly, and otherwise the note is held.
 *
 *  A file the account has no entry for is a create, unless it is a note v1 renamed or
 *  moved while offline, found by its words: then it is that note, moved. A note v1
 *  tracked whose file is gone is a delete, which the account refuses where somebody else
 *  wrote in it since (an edit beats a delete); one another device deleted that v1 never
 *  heard of goes here too, unless it was written in since. `nib:mirrors` is read and
 *  never written here: it is the way back.
 *
 *  **The way back**, when an account's switch goes to 1 again or this device signs out:
 *  the mirrors are written from the store and the account's own listing, so v1 meets
 *  every file it finds agreeing as a note it already knows, at the version the account
 *  holds (`mirrorsFrom`). */

import type { Mirror, Tracked } from '../sync/mirror'
import type { Core } from './core'
import { kindOfName, made, moved } from './create'
import { MINE } from './docs'
import { readFeed } from './pass'
import { fileOfUpdates, judge, seedOf, shapeOf, turn, unixLines } from './kinds'
import type { SpaceState } from './places'
import { againstBytes } from './records'
import { keepLosers } from './rejoin'
import { project, wrote } from './project'
import type { Change, EntryRow } from './store'
import { pullResponseOf, PULL_BATCH, type FeedItem, type Op } from '@nib/sync-core/wire'
import * as Y from 'yjs'

/** What v1 knew of a space: its feed cursor and the notes it tracked, by path. */
export interface V1Space {
  cursor: number
  notes: Readonly<Record<string, Tracked>>
}

const EMPTY_SV = Y.encodeStateVector(new Y.Doc())

/** A document matched to its file, with what the file says. */
interface Matched {
  entry: EntryRow
  item: FeedItem
  file: string
  tracked: Tracked | undefined
}

/** The first v2 pass of a space. Answers whether it got through; a pass that met no
 *  account is asked again next time, from the top. */
export async function firstPass(
  core: Core,
  space: SpaceState,
  v1: V1Space | null,
): Promise<boolean> {
  const life = core.life
  const alive = () => core.life === life
  const world = core.world
  const full = (path: string) => world.join(space.row.root, path)

  if ((await world.account.ask('prepare', {}, space.id)) === null || !alive()) return false

  const items = new Map<string, FeedItem>()
  if (!(await readFeed(core, space, alive, (item) => items.set(item.id, item)))) return false

  const listing = (await world.list?.(space.row.root)) ?? []
  const wanted = space.paths()
  const changes: Change[] = []
  const matched: Matched[] = []
  const claimed = new Set<string>()

  // Which entry v1 knew a path as, where the account still has it.
  const byTracked = (path: string): EntryRow | null => {
    const tracked = v1?.notes[path]
    const entry = tracked ? space.entries.get(tracked.id) : undefined
    return entry && !entry.deleted && !claimed.has(entry.id) ? entry : null
  }
  // A note v1 knew at a path that another device deleted after v1's last pass, its file
  // still saying what v1 last agreed on: the delete is this device's too, and the pass
  // that follows takes the file to the trash. Written in since, the edit beats the delete
  // and the file is a new note.
  const deletedUnseen = async (path: string): Promise<EntryRow | null> => {
    const tracked = v1?.notes[path]
    const entry = tracked ? space.entries.get(tracked.id) : undefined
    if (!tracked || !entry?.deleted || claimed.has(entry.id)) return null
    const read = await world.disk.read(full(path))
    return read !== null && (await hashesOf(core, read)).includes(tracked.hash) ? entry : null
  }
  // Which entry goes at a path by its account names.
  const byPlace = (path: string, folder: boolean): EntryRow | null => {
    const key = space.key(path)
    for (const [id, at] of wanted) {
      if (claimed.has(id) || space.key(at) !== key) continue
      const entry = space.entries.get(id)
      if (entry && (entry.kind === 'folder') === folder) return entry
    }
    return null
  }
  // A document's file, matched to its entry. What nib last wrote is the file as v1 left
  // it: the words the next pull is measured against, so a file v1 merely fell behind on
  // is written over and not read as edits.
  const match = async (entry: EntryRow, file: string, tracked: Tracked | undefined) => {
    changes.push(...(await wrote(core, entry, file)))
    const item = items.get(entry.id)
    if (item && shapeOf(entry.kind)) matched.push({ entry, item, file, tracked })
  }

  const strays: { path: string; dir: boolean }[] = []
  for (const listed of listing) {
    const gone = listed.dir ? null : await deletedUnseen(listed.path)
    if (gone) {
      claimed.add(gone.id)
      gone.local_path = listed.path
      changes.push(...core.entryChanges([gone]))
      continue
    }
    const entry = listed.dir
      ? byPlace(listed.path, true)
      : (byTracked(listed.path) ?? byPlace(listed.path, false))
    if (!entry) {
      strays.push(listed)
      continue
    }
    claimed.add(entry.id)
    entry.local_path = listed.path
    changes.push(...core.entryChanges([entry]))
    if (listed.dir || !shapeOf(entry.kind)) continue
    const read = await world.disk.read(full(listed.path))
    if (read !== null) await match(entry, unixLines(read), v1?.notes[listed.path])
  }

  // Folders the account has never heard of are made there first, shallow before deep, so
  // whatever moved into them has somewhere to go.
  for (const stray of strays) {
    if (!stray.dir || space.folderAt(stray.path) !== undefined) continue
    changes.push(...(await made(core, space, { path: stray.path, folder: true })).changes)
  }

  // Notes v1 renamed or moved while it could not reach the account: v1 still knows each
  // by its old name, its file is gone from there, and a file nobody knows says the same
  // words. That is the note, moved - its id and its history kept - rather than a new
  // note beside a delete.
  const vacated = new Set<string>()
  const renamed = await renamedHere(core, space, v1, strays, claimed)
  for (const { entry, from, path, file, tracked } of renamed) {
    claimed.add(entry.id)
    if (entry.parent !== null) vacated.add(entry.parent)
    entry.local_path = from
    changes.push(...moved(core, space, from, path))
    await match(entry, file, tracked)
  }

  // The account's words for every note whose file moved: one pull, in batches.
  const needs: Matched[] = []
  for (const one of matched) {
    const digest = await world.digest(one.file)
    const seeds =
      one.item.epochBase === digest && (one.tracked === undefined || one.tracked.hash === digest)
    if (seeds) {
      seed(core, space, one, changes)
    } else if (one.tracked?.hash !== digest) {
      needs.push(one)
    }
    // Else the file is what v1 last left and the account moved on: its document comes
    // down with the pull that follows, and the file is written from it.
  }

  for (let at = 0; at < needs.length; at += PULL_BATCH) {
    const batch = needs.slice(at, at + PULL_BATCH)
    const reply = await world.account.ask(
      'pull',
      {
        docs: batch.map((one) => ({ id: one.entry.id, epoch: one.item.epoch ?? 1, sv: EMPTY_SV })),
      },
      space.id,
    )
    if (!alive() || reply === null) return false
    const answer = pullResponseOf(reply)
    for (const one of batch) {
      const whole = answer?.docs.find((doc) => doc.id === one.entry.id)
      if (whole && 'update' in whole) {
        changes.push(...(await reconcile(core, space, one, whole.update, whole.seq)))
      }
    }
  }

  // A note v1 tracked whose file is gone was deleted here while v1 ran.
  if (v1) {
    for (const tracked of Object.values(v1.notes)) {
      const entry = space.entries.get(tracked.id)
      if (!entry || entry.deleted || claimed.has(entry.id)) continue
      if (entry.parent !== null) vacated.add(entry.parent)
      const op: Op = { op: core.nextId('o'), t: 'delete', id: entry.id, seen: v1.cursor }
      changes.push(...send(core, space, op))
    }
  }

  // A folder v1 emptied - everything in it renamed away or deleted, and the folder gone
  // from this disk - goes too, rather than coming back empty with the next pass. Only one
  // this pass emptied: an empty folder another device made is left alone. Seen as v1
  // last saw the space, so a note somebody wrote in it since keeps it, as it keeps a note.
  for (const id of vacated) {
    const folder = space.entries.get(id)
    if (!v1 || folder?.kind !== 'folder' || claimed.has(id) || !space.isLive(id)) continue
    const shown = space.shown()
    if ([...shown.entries.values()].some((one) => one.parent === id && !one.deleted)) continue
    changes.push(...send(core, space, { op: core.nextId('o'), t: 'delete', id, seen: v1.cursor }))
    if (folder.parent !== null) vacated.add(folder.parent)
  }

  // And a file the account has never heard of is made there.
  // Any other file goes too where this world carries bytes (files.ts).
  for (const stray of strays) {
    if (stray.dir || renamed.some((one) => one.path === stray.path)) continue
    const document = !!shapeOf(kindOfName(stray.path))
    if (!document && !world.blobs) continue
    const text = document ? await world.disk.read(full(stray.path)) : undefined
    const madeHere = await made(core, space, {
      path: stray.path,
      folder: false,
      ...(text === null || text === undefined ? {} : { text: unixLines(text) }),
    })
    changes.push(...madeHere.changes)
  }

  changes.push(core.wantChange(space.id))
  await core.commit(changes)
  return alive()
}

/** A note v1 renamed or moved, found under its new name. */
interface Renamed {
  entry: EntryRow
  /** Where the account has it. */
  from: string
  path: string
  file: string
  tracked: Tracked
}

/** The stray files that are notes v1 knew under another name: a note whose file is gone
 *  from its old path, and one file that says exactly the words v1 last agreed on for it.
 *  Words two notes or two files share name nothing, and are left as they are. */
async function renamedHere(
  core: Core,
  space: SpaceState,
  v1: V1Space | null,
  strays: readonly { path: string; dir: boolean }[],
  claimed: ReadonlySet<string>,
): Promise<Renamed[]> {
  const left = new Map<string, Tracked[]>()
  for (const tracked of Object.values(v1?.notes ?? {})) {
    const entry = space.entries.get(tracked.id)
    if (!entry || entry.deleted || claimed.has(entry.id) || !shapeOf(entry.kind)) continue
    left.set(tracked.hash, [...(left.get(tracked.hash) ?? []), tracked])
  }
  if (!left.size) return []

  const loose: { path: string; file: string; hashes: string[] }[] = []
  for (const stray of strays) {
    if (stray.dir || !shapeOf(kindOfName(stray.path))) continue
    const read = await core.world.disk.read(core.world.join(space.row.root, stray.path))
    if (read === null) continue
    loose.push({ path: stray.path, file: unixLines(read), hashes: await hashesOf(core, read) })
  }

  const out: Renamed[] = []
  for (const one of loose) {
    const known = [...new Set(one.hashes.flatMap((hash) => left.get(hash) ?? []))]
    const twins = loose.filter((other) => other.hashes.some((hash) => one.hashes.includes(hash)))
    const tracked = known.length === 1 && twins.length === 1 ? known[0] : undefined
    const entry = tracked && space.entries.get(tracked.id)
    const from = entry && space.paths().get(entry.id)
    if (tracked && entry && from !== undefined) {
      out.push({ entry, from, path: one.path, file: one.file, tracked })
    }
  }
  return out
}

/** The digests a file's words may have been written down under: as they are, and with
 *  Windows line ends made plain, which is how v1 compared them. */
async function hashesOf(core: Core, text: string): Promise<string[]> {
  const plain = unixLines(text)
  const hashes = [await core.world.digest(text)]
  if (plain !== text) hashes.push(await core.world.digest(plain))
  return hashes
}

/** An op of this pass's own, waiting in the outbox. */
function send(core: Core, space: SpaceState, op: Op): Change[] {
  const { one, change } = core.outgoing(space, { t: 'op', op }, op.seen)
  space.queue(one)
  return [change, core.counterRow()]
}

/** The file is the epoch's words: the document is their seed, made here. */
function seed(core: Core, space: SpaceState, one: Matched, changes: Change[]) {
  const shape = shapeOf(one.entry.kind) ?? 'words'
  const epoch = one.item.epoch ?? 1
  const doc = core.made(
    one.entry.id,
    shape,
    epoch,
    seedOf(shape, one.entry.id, epoch, one.file),
    one.file ? 1 : 0,
  )
  // Pulled from nothing: the pull brings whatever came after the seed, as a diff.
  core.wanted(space.id).set(one.entry.id, { docSeq: one.item.docSeq ?? 0, epoch })
  changes.push(...core.docChanges(doc))
}

/** A file whose words moved while v1 ran, met with the account's document. */
async function reconcile(
  core: Core,
  space: SpaceState,
  one: Matched,
  update: Uint8Array,
  seq: number,
): Promise<Change[]> {
  const shape = shapeOf(one.entry.kind) ?? 'words'
  const epoch = one.item.epoch ?? 1
  const remote = fileOfUpdates(shape, update)
  const local = one.file
  const doc = core.made(one.entry.id, shape, epoch, update, seq)
  doc.pulled = one.item.docSeq ?? 0
  core.wanted(space.id).delete(one.entry.id)
  const changes: Change[] = []
  const take = (to: string) => {
    doc.write((live) => turn(shape, live, remote, to, MINE))
    doc.flush()
  }

  const remoteDigest = await core.world.digest(remote)
  if (local === remote) {
    // Nothing to do: the two agree.
  } else if (one.tracked?.hash === remoteDigest) {
    // The account did not move: the file's words are this device's edits on it.
    take(local)
  } else {
    const ancestor = one.tracked
      ? ((await core.world.ancestor?.(one.entry.id, one.tracked.hash)) ?? null)
      : null
    if (ancestor !== null) {
      const times = { local: core.world.now(), remote: 0 }
      const judged = judge(shape, ancestor, local, remote, times)
      if (judged.resolution === null) {
        changes.push(...hold(core, one.entry.id, ancestor, local))
      } else {
        changes.push(...keepLosers(core, space, one.entry.id, judged.lost, local, remote))
        take(judged.resolution)
      }
    } else if (local.includes(remote)) {
      take(local)
    } else if (!remote.includes(local)) {
      changes.push(...hold(core, one.entry.id, remote, local))
    }
  }

  changes.push(...core.docChanges(doc), ...(await wrote(core, one.entry, local)))
  // The file says what the note now reads, unless the note waits for the question.
  if (!core.isHeld(one.entry.id)) changes.push(...(await project(core, space, one.entry, doc)))
  return changes
}

function hold(core: Core, id: string, base: string, local: string): Change[] {
  const against = { t: 'file', base, local } as const
  return core.holdChanges({
    row: {
      id,
      remote: againstBytes(against),
      remote_sv: new Uint8Array(),
      device: null,
      at: core.world.now(),
    },
    against,
  })
}

/** A note as v1's own listing of a space names it (`GET /v1/spaces/:id/changes`). */
interface V1Note {
  id: string
  path: string
  version: number
  hash: string
  seq: number
  deleted: boolean
}

/** The whole of v1's listing of a space, from the beginning, and the cursor at its end. */
export interface V1Listing {
  cursor: number
  notes: readonly V1Note[]
}

/** The version a mirror gives a note nobody could prove one for. The account hands out
 *  none like it, so v1's next pull reads the note again and judges it by its words. */
const UNPROVEN = 0

/** The mirrors v1 starts from once this device stops running v2: each space's cursor,
 *  and each note's id, version and the digest of the words this device and the account
 *  last agreed on, by the path its file has here. `done` says which spaces v2 kept; the
 *  rest keep whatever v1 last wrote for them.
 *
 *  With the account's listing (the way back, online), a note whose file or confirmed
 *  words say what the account holds takes the account's version, so v1's next write
 *  lands on it rather than beside it. A note nobody can prove - unknown here, at another
 *  path, unreadable, held, or moved on up there past what this device confirmed - is
 *  left for v1 to judge: the cursor goes back to before it, so its first pull reads it
 *  again as it reads any note, against the words this device confirmed.
 *
 *  Without the listing (signing out, when there is no account to ask), every note is
 *  unproven and the cursor is nought: v1's first pull, or v2's next first pass, reads
 *  every note again, and a file written in since is this device's edit on what it
 *  confirmed, never a stranger's. */
export async function mirrorsFrom(
  core: Core,
  listings: ReadonlyMap<string, V1Listing> | null,
  done: (space: string) => boolean = () => true,
): Promise<Record<string, Mirror>> {
  const out: Record<string, Mirror> = {}
  for (const space of core.spaces.values()) {
    if (!done(space.id)) continue
    const listing = listings?.get(space.id)
    const { cursor, notes } = listing
      ? await proven(core, space, listing)
      : { cursor: 0, notes: await confirmed(core, space) }
    out[space.row.root] = {
      spaceId: space.id,
      root: space.row.root,
      cursor,
      notes,
      offered: {},
      files: {},
      dropped: false,
      shared: space.row.role !== null && space.row.role !== 'owner',
    }
  }
  return out
}

/** Every note the account confirmed here, by its path here, at the words confirmed. */
async function confirmed(core: Core, space: SpaceState): Promise<Record<string, Tracked>> {
  const notes: Record<string, Tracked> = {}
  for (const entry of space.entries.values()) {
    if (entry.deleted || !entry.local_path || entry.seq === null || !shapeOf(entry.kind)) continue
    const doc = await core.doc(entry.id)
    if (!doc) continue
    notes[entry.local_path] = {
      id: entry.id,
      version: UNPROVEN,
      hash: core.isHeld(entry.id) ? '' : await core.world.digest(doc.confirmedText()),
    }
  }
  return notes
}

/** The account's listing met with what this device holds. */
async function proven(
  core: Core,
  space: SpaceState,
  listing: V1Listing,
): Promise<{ cursor: number; notes: Record<string, Tracked> }> {
  const notes: Record<string, Tracked> = {}
  let cursor = listing.cursor
  for (const remote of listing.notes) {
    if (remote.deleted) continue
    const tracked = await provenOne(core, space, remote)
    if (tracked) notes[remote.path] = tracked
    if (tracked?.version !== remote.version) cursor = Math.min(cursor, remote.seq - 1)
  }
  return { cursor: Math.max(0, cursor), notes }
}

async function provenOne(core: Core, space: SpaceState, remote: V1Note): Promise<Tracked | null> {
  const entry = space.entries.get(remote.id)
  if (!entry || entry.deleted || entry.local_path !== remote.path || !shapeOf(entry.kind)) {
    return null
  }
  const doc = await core.doc(entry.id)
  const read = await core.world.disk.read(core.world.join(space.row.root, entry.local_path))
  if (!doc || read === null) return null
  // Held for the question: two sides wrote two things, and v1 asks in its own way.
  if (core.isHeld(entry.id)) return { id: entry.id, version: UNPROVEN, hash: '' }
  const agreed = await core.world.digest(doc.confirmedText())
  // The file says what the account holds, or this device confirmed it and wrote on top:
  // v1 knows the note at the account's version, and sends what was written.
  if (agreed === remote.hash || (await hashesOf(core, read)).includes(remote.hash)) {
    return { id: entry.id, version: remote.version, hash: remote.hash }
  }
  return { id: entry.id, version: UNPROVEN, hash: agreed }
}
