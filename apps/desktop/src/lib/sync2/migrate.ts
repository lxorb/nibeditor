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
 *  A file the account has no entry for is a create; a note v1 tracked whose file is gone
 *  is a delete, which the account refuses where somebody else wrote in it since (an edit
 *  beats a delete). `nib:mirrors` is read and never written: it is the way back.
 *
 *  **The way back**, when an account's switch goes to 1 again: the mirrors are written
 *  from the store - each note's id, and the digest of the words the account confirmed -
 *  so v1 meets every file it finds agreeing as a note it already knows. */

import type { Mirror, Tracked } from '../sync/mirror'
import type { Core } from './core'
import { kindOfName, made } from './create'
import { MINE } from './docs'
import { readFeed } from './pass'
import { fileOfUpdates, judge, seedOf, shapeOf, turn, unixLines } from './kinds'
import type { SpaceState } from './places'
import { againstBytes } from './records'
import { keepLosers } from './rejoin'
import { wrote } from './project'
import { put, type Change, type EntryRow } from './store'
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
export async function firstPass(core: Core, space: SpaceState, v1: V1Space | null): Promise<boolean> {
  const life = core.life
  const alive = () => core.life === life
  const world = core.world

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

  const strays: { path: string; dir: boolean }[] = []
  for (const listed of listing) {
    const entry = listed.dir ? byPlace(listed.path, true) : (byTracked(listed.path) ?? byPlace(listed.path, false))
    if (!entry) {
      strays.push(listed)
      continue
    }
    claimed.add(entry.id)
    entry.local_path = listed.path
    changes.push(...core.entryChanges([entry]))
    const item = items.get(entry.id)
    if (listed.dir || !item || !shapeOf(entry.kind)) continue
    const read = await world.disk.read(world.join(space.row.root, listed.path))
    if (read === null) continue
    matched.push({ entry, item, file: unixLines(read), tracked: v1?.notes[listed.path] })
  }

  // The account's words for every note whose file moved: one pull, in batches.
  const needs: Matched[] = []
  for (const one of matched) {
    const digest = await world.digest(one.file)
    const seeds = one.item.epochBase === digest && (one.tracked === undefined || one.tracked.hash === digest)
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
      { docs: batch.map((one) => ({ id: one.entry.id, epoch: one.item.epoch ?? 1, sv: EMPTY_SV })) },
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
      const op: Op = { op: core.nextId('o'), t: 'delete', id: entry.id, seen: v1.cursor }
      const { one, change } = core.outgoing(space, { t: 'op', op }, v1.cursor)
      space.queue(one)
      changes.push(change, core.counterRow())
    }
  }

  // And a file the account has never heard of is made there, folders first.
  for (const stray of strays) {
    if (!stray.dir && !shapeOf(kindOfName(stray.path))) continue
    const text = stray.dir ? undefined : await world.disk.read(world.join(space.row.root, stray.path))
    const madeHere = await made(core, space, {
      path: stray.path,
      folder: stray.dir,
      ...(text === null || text === undefined ? {} : { text: unixLines(text) }),
    })
    changes.push(...madeHere.changes)
  }

  changes.push(core.wantChange(space.id))
  await core.commit(changes)
  return alive()
}

/** The file is the epoch's words: the document is their seed, made here. */
function seed(core: Core, space: SpaceState, one: Matched, changes: Change[]) {
  const shape = shapeOf(one.entry.kind) ?? 'words'
  const epoch = one.item.epoch ?? 1
  const doc = core.made(one.entry.id, shape, epoch, seedOf(shape, one.entry.id, epoch, one.file), one.file ? 1 : 0)
  // Pulled from nothing: the pull brings whatever came after the seed, as a diff.
  core.wanted(space.id).set(one.entry.id, { docSeq: one.item.docSeq ?? 0, epoch })
  changes.push(...core.docChanges(doc))
  changes.push(
    put('written', { id: one.entry.id, text: one.file }),
  )
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
    const ancestor = one.tracked ? ((await core.world.ancestor?.(one.entry.id, one.tracked.hash)) ?? null) : null
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
  return changes
}

function hold(core: Core, id: string, base: string, local: string): Change[] {
  const against = { t: 'file', base, local } as const
  return core.holdChanges({
    row: { id, remote: againstBytes(against), remote_sv: new Uint8Array(), device: null, at: core.world.now() },
    against,
  })
}

/** The mirrors v1 starts from after an account goes back to it: each space's cursor,
 *  and each note's id and the digest of the words the account confirmed, by the path
 *  its file has here. A file that still says them is a note v1 knows; one written in
 *  since is a note v1 sends. */
export async function mirrorsFrom(core: Core): Promise<Record<string, Mirror>> {
  const out: Record<string, Mirror> = {}
  for (const space of core.spaces.values()) {
    const notes: Record<string, Tracked> = {}
    for (const entry of space.entries.values()) {
      if (entry.deleted || !entry.local_path || entry.seq === null || !shapeOf(entry.kind)) continue
      const doc = await core.doc(entry.id)
      if (!doc) continue
      notes[entry.local_path] = {
        id: entry.id,
        version: 0,
        hash: await core.world.digest(doc.confirmedText()),
      }
    }
    out[space.row.root] = {
      spaceId: space.id,
      root: space.row.root,
      cursor: space.row.cursor,
      notes,
      offered: {},
      files: {},
      dropped: false,
      shared: space.row.role !== null && space.row.role !== 'owner',
    }
  }
  return out
}
