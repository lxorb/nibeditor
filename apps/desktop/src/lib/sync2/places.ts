/** A space's tree as this device holds it, and where each entry is on this disk.
 *
 *  Two trees are kept in one table. What the account has said - the feed, and the
 *  answers to this device's own ops - is each entry's row. What the person sees is
 *  that, with every op still waiting in the outbox applied on top by the very rules the
 *  account applies them by (`applyOp` in @nib/sync-core/tree), so a rename made offline
 *  is a rename at once and the account's answer only ever corrects it (section 5.9).
 *
 *  Where an entry is on the disk is its `local_path`, relative to the space's root.
 *  Usually that is its names from the top down; a name this platform cannot hold (`CON`,
 *  `a:b`, a trailing dot on Windows) is spelled another way here and nowhere else, so the
 *  account never sees the local spelling. `settle` makes the disk agree with the shown
 *  tree: moves, folders made, and files the account deleted taken away - unless this
 *  device has written in them since, when the edit beats the delete and they stay. */

import { type OpResult, type Op } from '@nib/sync-core/wire'
import { applyOp, nameKey, type TreeEntry, type TreeState, treeState } from '@nib/sync-core/tree'
import type { Outgoing } from './records'
import type { EntryRow, OutboxRow, SpaceRow } from './store'
import type { Disk, World } from './world'

/** One row of the outbox, read. */
export interface Outboxed {
  row: OutboxRow
  record: Outgoing
}

/** Folder paths join with this, whatever the platform: the world joins them onto a
 *  root in its own spelling. */
export const SEP = '/'

export function folderOf(path: string): string {
  const at = path.lastIndexOf(SEP)
  return at < 0 ? '' : path.slice(0, at)
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf(SEP) + 1)
}

export function joined(folder: string, name: string): string {
  return folder ? `${folder}${SEP}${name}` : name
}

/** Names Windows will not hold, whatever their extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** What Windows holds in no name, beside the control characters. */
const FORBIDDEN = '<>:"\\|?*'

/** How a name is spelled on this disk: as the account writes it, unless this platform
 *  cannot hold it. */
function localName(name: string, platform: World['platform']): string {
  if (platform === 'windows') {
    let out = Array.from(name, (char) =>
      char < ' ' || FORBIDDEN.includes(char) ? '_' : char,
    ).join('')
    if (RESERVED.test(out)) out = `_${out}`
    return out.replace(/[. ]+$/, (tail) => '_'.repeat(tail.length))
  }
  if (platform === 'mac') return name.replace(/:/g, '_')
  return name
}

export class SpaceState {
  entries: Map<string, EntryRow>
  outbox: Outboxed[]
  private shownCache: TreeState | null = null
  private pathsCache: Map<string, string> | null = null

  constructor(
    public row: SpaceRow,
    entries: readonly EntryRow[],
    outbox: readonly Outboxed[],
    private readonly device: string,
    private readonly world: Pick<World, 'platform' | 'foldsCase'>,
  ) {
    this.entries = new Map(entries.map((entry) => [entry.id, entry]))
    this.outbox = [...outbox]
  }

  get id(): string {
    return this.row.space_id
  }

  /** Something about the tree changed: what is shown is worked out again when next
   *  asked. */
  changed() {
    this.shownCache = null
    this.pathsCache = null
  }

  /** The tree the account has confirmed: every entry it has named, as it named it. */
  confirmed(): TreeState {
    const entries: TreeEntry[] = []
    for (const entry of this.entries.values()) {
      if (entry.seq === null) continue
      entries.push({
        id: entry.id,
        kind: entry.kind as TreeEntry['kind'],
        parent: entry.parent,
        name: entry.name,
        deleted: entry.deleted,
        seq: entry.seq,
        docSeq: 0,
      })
    }
    return treeState(entries, this.row.cursor)
  }

  /** What the person sees: the confirmed tree with every waiting op applied. A day's
   *  note waiting to be made keeps its own place here even where the account will
   *  merge it into one of the same name: until it answers, both are on the disk. */
  shown(): TreeState {
    if (this.shownCache) return this.shownCache
    const state = this.confirmed()
    for (const one of this.outbox) {
      if (one.record.t !== 'op') continue
      const op: Op = { ...one.record.op }
      if (op.t === 'create') delete op.mergeable
      applyOp(state, op, { role: 'owner', device: this.device })
    }
    this.shownCache = state
    return state
  }

  /** Where every live entry of the shown tree goes on this disk, relative to the root. */
  paths(): Map<string, string> {
    if (this.pathsCache) return this.pathsCache
    const shown = this.shown()
    const children = new Map<string | null, TreeEntry[]>()
    for (const entry of shown.entries.values()) {
      if (entry.deleted) continue
      const list = children.get(entry.parent) ?? []
      list.push(entry)
      children.set(entry.parent, list)
    }

    const out = new Map<string, string>()
    const walk = (parent: string | null, folder: string) => {
      const siblings = (children.get(parent) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1))
      const taken = new Set<string>()
      for (const entry of siblings) {
        let name = localName(entry.name, this.world.platform)
        // Two account names one spelling here: the later id steps aside.
        for (let counter = 2; taken.has(this.key(name)); counter += 1) {
          name = numbered(localName(entry.name, this.world.platform), counter)
        }
        taken.add(this.key(name))
        const path = joined(folder, name)
        out.set(entry.id, path)
        if (entry.kind === 'folder') walk(entry.id, path)
      }
    }
    walk(null, '')
    this.pathsCache = out
    return out
  }

  /** How this disk compares two paths. */
  key(path: string): string {
    return this.world.foldsCase ? nameKey(path) : path.normalize('NFC')
  }

  /** The entry whose file is at `path` on this disk now. */
  at(path: string): EntryRow | null {
    const wanted = this.key(path)
    for (const entry of this.entries.values()) {
      if (entry.local_path && this.key(entry.local_path) === wanted) return entry
    }
    return null
  }

  /** The folder id a local folder path names: null for the top of the space. Undefined
   *  for a folder this tree does not have. */
  folderAt(path: string): string | null | undefined {
    if (!path) return null
    const entry = this.at(path)
    return entry?.kind === 'folder' && !entry.deleted ? entry.id : undefined
  }

  /** Whether an entry is live in what the person sees. */
  isLive(id: string): boolean {
    const entry = this.shown().entries.get(id)
    return entry !== undefined && !entry.deleted
  }

  /** An op this device made, applied to what it sees at once and waiting to go up. */
  queue(one: Outboxed) {
    this.outbox.push(one)
    this.changed()
  }

  /** What an op the account answered makes of an entry's row: where it ended up, or that
   *  it is gone. Answers the rows that changed. */
  answered(op: Op, result: OpResult): EntryRow[] {
    const touched: EntryRow[] = []
    if ('refused' in result || 'merged' in result) return touched
    const entry = this.entries.get(op.id)
    if (!entry) return touched
    if (op.t === 'delete') {
      entry.deleted = true
    } else if ('parent' in result) {
      entry.parent = result.parent
      entry.name = result.name
      entry.deleted = false
    }
    entry.seq ??= 0
    touched.push(entry)
    this.changed()
    return touched
  }
}

function numbered(name: string, counter: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0
    ? `${name.slice(0, dot)} ${String(counter)}${name.slice(dot)}`
    : `${name} ${String(counter)}`
}

/** What settling a space's disk needs besides the disk. */
export interface Settling {
  disk: Disk
  join: (root: string, path: string) => string
  /** Whether this device has written in a document the account no longer shows, or is
   *  holding it: then its file stays, and the push brings it back. */
  keeps: (id: string) => boolean
  /** A document this device will not hear of again: its rows go. */
  forget: (id: string) => void
}

/** A path nothing here uses yet, beside `path`: where a file waits while another takes
 *  its place. */
function aside(path: string, id: string): string {
  return joined(folderOf(path), `.nib-moving-${id}`)
}

/** Makes the disk agree with what is shown. Answers the entries whose `local_path`
 *  changed, which the caller writes down.
 *
 *  Files the account deleted go first, so a name they held is free; then every move,
 *  shallow before deep, a folder carrying what is in it; then folders that are new. A
 *  move onto a path another entry still holds waits aside under a name of its own until
 *  that entry has moved on. Documents new to this device are written by the pull that
 *  brings their words, not here. */
export async function settle(space: SpaceState, how: Settling): Promise<EntryRow[]> {
  const wanted = space.paths()
  const moved = new Set<EntryRow>()
  const root = space.row.root
  const full = (path: string) => how.join(root, path)

  for (const entry of space.entries.values()) {
    if (!entry.local_path || wanted.has(entry.id)) continue
    if (entry.kind !== 'folder' && how.keeps(entry.id)) continue
    // A folder goes once nothing it holds is staying.
    if (entry.kind === 'folder' && holdsKept(space, entry, how)) continue

    if (await how.disk.exists(full(entry.local_path))) {
      await how.disk.remove(full(entry.local_path), entry.kind === 'folder' ? 'folder' : 'file')
    }
    if (entry.kind === 'folder') forgetUnder(space, entry.local_path, moved, how)
    entry.local_path = ''
    moved.add(entry)
    if (entry.kind !== 'folder') how.forget(entry.id)
  }

  for (let round = 0; round <= space.entries.size; round += 1) {
    const due = [...space.entries.values()]
      .filter((entry) => {
        const want = wanted.get(entry.id)
        return entry.local_path && want !== undefined && entry.local_path !== want
      })
      .sort((a, b) => depth(a.local_path) - depth(b.local_path))
    if (!due.length) break

    for (const entry of due) {
      const want = wanted.get(entry.id)
      if (want === undefined || entry.local_path === want) continue
      const kind = entry.kind === 'folder' ? 'folder' : 'file'
      const holder = space.at(want)
      if (holder && holder !== entry) {
        // Somebody else is still there: it waits aside, and moves on in its own turn.
        const out = aside(holder.local_path, holder.id)
        const holding = holder.kind === 'folder' ? 'folder' : 'file'
        await how.disk.move(full(holder.local_path), full(out), holding)
        carry(space, holder, out, moved)
      } else if (!holder && (await how.disk.exists(full(want)))) {
        // A file this tree does not know about is in the way. Left where it is; the
        // entry stays where it was until that file has become an entry of its own.
        continue
      }
      await how.disk.mkdir(full(folderOf(want)))
      await how.disk.move(full(entry.local_path), full(want), kind)
      carry(space, entry, want, moved)
    }
  }

  for (const [id, want] of wanted) {
    const entry = space.entries.get(id)
    if (entry?.kind !== 'folder' || entry.local_path) continue
    await how.disk.mkdir(full(want))
    entry.local_path = want
    moved.add(entry)
  }

  if (moved.size) space.changed()
  return [...moved]
}

function depth(path: string): number {
  return path.split(SEP).length
}

/** An entry now at `to`, and everything under it if it is a folder. */
function carry(space: SpaceState, entry: EntryRow, to: string, moved: Set<EntryRow>) {
  const from = entry.local_path
  if (entry.kind === 'folder') {
    const inside = space.key(`${from}${SEP}`)
    for (const one of space.entries.values()) {
      if (one === entry || !one.local_path) continue
      if (!space.key(one.local_path).startsWith(inside)) continue
      one.local_path = `${to}${one.local_path.slice(from.length)}`
      moved.add(one)
    }
  }
  entry.local_path = to
  moved.add(entry)
}

/** Everything under a folder that was taken off the disk is off the disk, and a
 *  document in it is one this device will not hear of again. */
function forgetUnder(space: SpaceState, folder: string, moved: Set<EntryRow>, how: Settling) {
  const inside = space.key(`${folder}${SEP}`)
  for (const one of space.entries.values()) {
    if (!one.local_path || !space.key(one.local_path).startsWith(inside)) continue
    one.local_path = ''
    moved.add(one)
    if (one.kind !== 'folder') how.forget(one.id)
  }
}

function holdsKept(space: SpaceState, folder: EntryRow, how: Settling): boolean {
  const inside = space.key(`${folder.local_path}${SEP}`)
  for (const one of space.entries.values()) {
    if (!one.local_path || !space.key(one.local_path).startsWith(inside)) continue
    if (one.kind !== 'folder' && how.keeps(one.id)) return true
  }
  return false
}
