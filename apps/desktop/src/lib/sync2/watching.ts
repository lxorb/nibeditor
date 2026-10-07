/** The space folders as another program changes them, heard by the engine
 *  (docs/sync-v2.md section 5.5).
 *
 *  The crate watches each space's folder and lists it once as the watch starts
 *  (src-tauri/src/space_watch.rs, space-watch.ts here). A file whose words are not nib's
 *  last write was changed by something else and is folded in three ways (ingest.ts); a
 *  file nobody made here is a create, one gone is a delete, one that moved - the same
 *  file at a new path - is a move. Read a hundred at a time, a tick apart, so a `git
 *  checkout` of another branch never holds the window up.
 *
 *  Not what nib did itself: the workspace says those once (workspace/file-ops.ts), and
 *  the engine's own moves and deletes are marked as they are made (`own`). A folder that
 *  is not there any more is never read as a reason to delete anything: a space renamed in
 *  Explorer is gone from here too, and it is the workspace that says what became of it. */

import {
  scanSpace,
  type SpaceChange,
  type SpaceNews,
  unwatchSpaces,
  watchSpaces,
} from '../space-watch'
import type { Engine } from './engine'
import { holdsDocument } from './kinds'
import { kindOfName } from './create'
import { relative } from './engine'

/** How many changes one tick reads. */
const BATCH = 100

/** Whether a path is the app's own (a dotted file or folder) rather than the person's. */
function hidden(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((part) => part.startsWith('.'))
}

/** Whether a path is something the engine keeps: a folder, a document, or - where the
 *  world carries bytes - any other file (files.ts). */
function kept(engine: Engine, path: string, dir: boolean): boolean {
  if (hidden(path)) return false
  return dir || holdsDocument(kindOfName(path)) || !!engine.core.world.blobs
}

export interface Watching {
  engine: Engine
  /** Whether the engine itself just moved or removed this path. */
  own(path: string): boolean
  /** Whether a space's first pass is done, so its folder can be read against its tree. */
  ready(spaceId: string): boolean
  /** Something changed that a pass should send. */
  changed(): void
}

/** Watches every space the engine keeps. Answers how to stop. */
export function watchFolders(how: Watching): () => void {
  const queue: (() => Promise<void>)[] = []
  let draining = false
  let stopped = false

  const drain = async () => {
    if (draining) return
    draining = true
    try {
      while (queue.length && !stopped) {
        const batch = queue.splice(0, BATCH)
        for (const one of batch) await one().catch(() => undefined)
        how.changed()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      draining = false
    }
  }

  const heard = (news: SpaceNews) => {
    if (news.gone) return
    if (news.scan) queue.push(() => scanned(how, news.root))
    for (const change of news.changes) queue.push(() => changed(how, change))
    void drain()
  }

  const roots = [...how.engine.core.spaces.values()].map((space) => space.row.root)
  void watchSpaces(roots, heard).catch(() => undefined)
  return () => {
    stopped = true
    void unwatchSpaces().catch(() => undefined)
  }
}

async function changed(how: Watching, change: SpaceChange): Promise<void> {
  const engine = how.engine
  if (change.kind === 'renamed') {
    if (how.own(change.from) || !kept(engine, change.path, change.dir)) return
    if (engine.entryAt(change.from)) {
      await engine.moved(change.from, change.path)
      return
    }
    if (!engine.entryAt(change.path)) await made(engine, change.path, change.dir)
    return
  }
  if (!kept(engine, change.path, change.dir) || how.own(change.path)) return
  if (change.kind === 'removed') {
    if (engine.entryAt(change.path)) await engine.removed(change.path)
    return
  }
  if (engine.entryAt(change.path)) {
    if (!change.dir) await engine.foreign(change.path)
    return
  }
  if (change.kind === 'created') await made(engine, change.path, change.dir)
}

/** Whether the tree already has a folder where `path` is: the engine makes one on this
 *  disk a moment before it writes down where (a note moving into a folder another
 *  device made, places.ts `settle`), and hearing that back is its own echo, never a
 *  second folder of the same name. */
function wantedFolder(engine: Engine, path: string): boolean {
  const placed = engine.placed(path)
  if (!placed) return false
  const { space } = placed
  const key = space.key(placed.path)
  for (const [id, want] of space.paths()) {
    if (space.key(want) === key && space.entries.get(id)?.kind === 'folder') return true
  }
  return false
}

async function made(engine: Engine, path: string, dir: boolean) {
  if (dir && wantedFolder(engine, path)) return
  if (dir || !holdsDocument(kindOfName(path))) {
    await engine.created(path, dir)
    return
  }
  const text = await engine.core.world.disk.read(path)
  if (text !== null) await engine.created(path, dir, text)
}

/** A space's folder read whole against its tree: what changed while nib was not
 *  watching - closed, or the watcher having lost events. */
async function scanned(how: Watching, root: string): Promise<void> {
  const engine = how.engine
  const space = [...engine.core.spaces.values()].find((one) => one.row.root === root)
  if (!space || !how.ready(space.id)) return
  const listed = await scanSpace(root)
  const seen = new Set<string>()

  for (const one of listed) {
    const inside = relative(root, one.path)
    if (inside === null || !kept(engine, inside, one.dir)) continue
    seen.add(space.key(inside))
    const entry = space.at(inside)
    if (!entry) {
      await made(engine, one.path, one.dir)
    } else if (!one.dir && (entry.mtime !== one.mtime || entry.size !== one.size)) {
      await engine.foreign(one.path)
      // Read once: the next launch reads it again only if it changed again.
      await engine.stamped(one.path, one.mtime, one.size)
    }
  }

  // Deleted while nib was closed: the entries whose files the folder no longer has.
  // Asked of the disk once more first: a pass may have moved a file since the listing.
  for (const entry of [...space.entries.values()]) {
    if (!entry.local_path || entry.deleted || seen.has(space.key(entry.local_path))) continue
    if (hidden(entry.local_path)) continue
    const full = engine.core.world.join(root, entry.local_path)
    if (how.own(full) || (await engine.core.world.disk.exists(full))) continue
    await engine.removed(full)
  }
}
