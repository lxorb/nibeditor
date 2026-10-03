/** Every file of a space that is not a note, a canvas, a page note or a web note: a
 *  picture, a recording, a PDF (docs/sync-v2.md section 5.8).
 *
 *  Such a file is an entry of kind `file` with the hash of its bytes, and the bytes are
 *  a blob on the account under that hash. Nothing merges. A file made here goes up as
 *  its bytes and then its `create`; one replaced here goes up as new bytes and a
 *  replace naming the bytes it replaced, which the account answers `moved` when another
 *  device replaced them first - and then the file is held and its person asked, with the
 *  same three answers a note has. A file the account has bytes for that this disk does
 *  not is fetched and written, unless this device replaced it meanwhile, which is the
 *  same question from the other side.
 *
 *  Two hashes on each entry say where it stands: `file_key` is the bytes the account
 *  last named, `written_hash` the bytes this disk was last known to hold. Equal is in
 *  step; a newer `file_key` is something to fetch; a disk that hashes to neither is a
 *  replacement made here.
 *
 *  Only where the world can carry bytes (`World.blobs`): the simulator's cannot, and
 *  there files are not kept at all. Up to 64 MB a file, in one request; a larger one
 *  stays on this device. */

import type { Core, Holding } from './core'
import { againstBytes, outgoingBytes } from './records'
import type { SpaceState } from './places'
import { put, type Change, type EntryRow } from './store'

/** The largest file that travels: the account's one-request ceiling. */
const LARGEST = 64 * 1024 * 1024

/** What the account answered a replacement. */
export type Replaced =
  { ok: true; seq: number } | { moved: { hash: string; size: number; at: number } } | { gone: true }

/** The world's road for bytes. Each request answers null when the account cannot be
 *  reached, as `Account.ask` does. */
export interface Blobs {
  /** A file's bytes on this disk, or null when it is not there. */
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  /** The hash a blob is named by. */
  hash(bytes: Uint8Array): Promise<string>
  /** The bytes, up to the account under their hash. Answers whether it keeps them now. */
  up(hash: string, bytes: Uint8Array): Promise<boolean | null>
  /** A file's bytes, from its space. `gone` for one the account no longer has. */
  down(space: string, id: string): Promise<Uint8Array | 'gone' | null>
  replace(space: string, id: string, hash: string, base: string): Promise<Replaced | null>
}

/** A file's bytes and their hash, read now; null for one that is not there, and for one
 *  too large to travel. */
async function readBytes(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
): Promise<{ bytes: Uint8Array; hash: string } | null> {
  const blobs = core.world.blobs
  if (!blobs || !entry.local_path) return null
  const bytes = await blobs.read(core.world.join(space.row.root, entry.local_path))
  if (!bytes || bytes.byteLength > LARGEST) return null
  return { bytes, hash: await blobs.hash(bytes) }
}

/** A file made here: its hash and size, for the entry and its `create`. Null when this
 *  world keeps no files, or the file is too large to travel. */
export async function fileMade(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
): Promise<{ hash: string; size: number } | null> {
  const read = await readBytes(core, space, entry)
  if (!read) return null
  entry.file_key = null
  entry.written_hash = read.hash
  entry.size = read.bytes.byteLength
  return { hash: read.hash, size: read.bytes.byteLength }
}

/** The bytes of every file a waiting `create` names, up before the ops that name them,
 *  since the account makes no entry for bytes it does not have. A file changed since it
 *  was made goes up as it is now, under its new hash. Answers whether everything got an
 *  answer. */
export async function sendMade(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
): Promise<boolean> {
  const blobs = core.world.blobs
  if (!blobs) return true
  for (const one of space.outbox) {
    if (one.record.t !== 'op' || one.record.sent) continue
    const op = one.record.op
    if (op.t !== 'create' || op.kind !== 'file') continue
    const entry = space.entries.get(op.id)
    if (!entry) continue
    const read = await readBytes(core, space, entry)
    if (!read) continue
    const stored = await blobs.up(read.hash, read.bytes)
    if (!alive() || stored === null) return false
    if (op.hash !== read.hash) {
      op.hash = read.hash
      entry.written_hash = read.hash
      entry.size = read.bytes.byteLength
      one.row = { ...one.row, op: outgoingBytes(one.record) }
      await core.commit([put('outbox', one.row), put('entries', { ...entry })])
    }
  }
  return true
}

/** Fetches what the account has that this disk does not, and sends what this disk has
 *  that the account does not: every file entry of the space, compared by hash. Answers
 *  whether everything got an answer. */
export async function settleFiles(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
): Promise<boolean> {
  const blobs = core.world.blobs
  if (!blobs) return true
  const wanted = space.paths()
  for (const entry of [...space.entries.values()]) {
    if (entry.kind !== 'file' || entry.deleted || entry.seq === null) continue
    if (core.isHeld(entry.id) || !space.isLive(entry.id)) continue
    // A create still on its way: its bytes go up with it (`sendMade`).
    if (waitingCreate(space, entry.id)) continue
    const path = entry.local_path || wanted.get(entry.id)
    if (!path) continue
    const changedThere = entry.file_key !== null && entry.file_key !== entry.written_hash
    // Read only where something may have changed: what another program wrote is said by
    // the watcher and the launch scan (`touched`), so a quiet space reads nothing.
    if (!core.touched.has(entry.id) && !changedThere && entry.local_path) continue
    core.touched.delete(entry.id)

    const here = entry.local_path ? await readBytes(core, space, entry) : null
    const changedHere = here !== null && here.hash !== entry.written_hash

    if (here?.hash === entry.file_key) {
      // Both say the same: in step, whichever moved.
      if (entry.written_hash !== here.hash) await written(core, entry, here.hash, here.bytes)
      continue
    }
    if (changedHere && changedThere) {
      await core.commit(holdFile(core, entry, here.hash))
      continue
    }
    if (changedHere) {
      const stored = await blobs.up(here.hash, here.bytes)
      if (!alive() || stored === null) return false
      const answer = await blobs.replace(space.id, entry.id, here.hash, entry.file_key ?? '')
      if (!alive() || answer === null) return false
      if ('ok' in answer) {
        entry.file_key = here.hash
        await written(core, entry, here.hash, here.bytes)
      } else if ('moved' in answer) {
        entry.file_key = answer.moved.hash
        await core.commit(holdFile(core, entry, here.hash, answer.moved.at))
      }
      continue
    }
    if (changedThere || !entry.local_path) {
      const bytes = await blobs.down(space.id, entry.id)
      if (!alive() || bytes === null) return false
      if (bytes === 'gone') continue
      const full = core.world.join(space.row.root, path)
      await core.world.disk.mkdir(core.world.join(space.row.root, folderPath(path)))
      await blobs.write(full, bytes)
      entry.local_path = path
      entry.file_key = await blobs.hash(bytes)
      await written(core, entry, entry.file_key, bytes)
      space.changed()
    }
  }
  return true
}

/** Whether a `create` for this entry is still waiting to go up. */
function waitingCreate(space: SpaceState, id: string): boolean {
  return space.outbox.some(
    (one) => one.record.t === 'op' && one.record.op.t === 'create' && one.record.op.id === id,
  )
}

async function written(core: Core, entry: EntryRow, hash: string, bytes: Uint8Array) {
  entry.written_hash = hash
  entry.size = bytes.byteLength
  await core.commit([put('entries', { ...entry })])
}

function folderPath(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/** A file both sides replaced, held for the question: this disk keeps its bytes, the
 *  account keeps the other's, and nothing goes either way until it is answered. */
function holdFile(core: Core, entry: EntryRow, mine: string, at = core.world.now()): Change[] {
  const against = { t: 'blob', mine, theirs: entry.file_key ?? '', at } as const
  const holding: Holding = {
    row: {
      id: entry.id,
      remote: againstBytes(against),
      remote_sv: new Uint8Array(),
      device: core.by.get(entry.id) ?? null,
      at: core.world.now(),
    },
    against,
  }
  return [...core.holdChanges(holding), put('entries', { ...entry })]
}
