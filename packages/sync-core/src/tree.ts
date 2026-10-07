/** A space's tree, and the rules every tree operation is applied by.
 *
 *  In sync v2 folders are rows with ids, and renaming or moving something is an
 *  operation on its id rather than a delete of one path and a create of another, so
 *  a note keeps its history, its document and its place in everybody's tabs however
 *  it is renamed while apart (docs/sync-v2.md section 5.9, road 6 in section 1).
 *  The account applies operations in the order they arrive and answers each with
 *  what became of it; devices apply the account's feed in the same order and so
 *  converge on it. A device also applies its own operations at once, optimistically,
 *  with this same function, so what it shows and what the account will decide are
 *  the same rules.
 *
 *  The rules, in the order they come up:
 *
 *  - **Names are unique per folder**, compared as Windows and macOS compare them:
 *    after NFC normalisation and without case (`nameKey`). A name that is taken is
 *    numbered the way the file list numbers a duplicate, `Plan 2.md`.
 *  - **A mergeable create** ("this note, if it is not there yet": the append action,
 *    the journal) that lands on a live note of the same name is answered `merged`
 *    with that note's id, and the device merges its words into it.
 *  - **An edit beats a delete.** A note written in after the delete's `seen` is not
 *    deleted (`edited`). A folder delete takes only what its device had seen; what
 *    was made, moved in, renamed or written in since stays, and keeps the folder.
 *    A content change landing on a deleted note brings it back.
 *  - **A move or a create into a deleted folder brings the folder back**, with its
 *    ancestors.
 *  - **A move that would put a folder inside itself** is refused (`cycle`): with the
 *    account serialising, refusing the second of two crossing moves is enough.
 *  - **Tree operations are last-writer-wins by arrival**: the later of two renames
 *    stands, and a rename or move of something deleted after its device last looked
 *    brings it back, as a delete after a rename deletes it.
 *
 *  Nothing here reads a clock or a disk. The state is plain data the Worker loads for
 *  a batch and writes back, and the only numbers that move are the space's cursor. */

import { freePath } from '@nib/markdown/paths'
import type { EntryKind, Op, OpResult } from './wire'

export interface TreeEntry {
  id: string
  kind: EntryKind
  /** The folder it is in, or null at the top of the space. */
  parent: string | null
  name: string
  deleted: boolean
  /** The space's cursor at its latest change of any sort. */
  seq: number
  /** The cursor at its latest content change, 0 for none. */
  docSeq: number
  /** The devices that made its latest change of any sort, and its latest content
   *  change. A device's own writing never stands against its own delete: it had
   *  seen it, whatever its cursor says. */
  by?: string
  docBy?: string
  /** The cursor of the delete that took it, so a folder restored brings back what
   *  was deleted with it and nothing that was deleted before. */
  deletedIn?: number
}

export interface TreeState {
  readonly entries: Map<string, TreeEntry>
  /** The space's cursor: every change takes the next number. */
  cursor: number
  /** What each op id was answered with: an op seen before answers the same again. */
  readonly done: Map<string, OpResult>
}

/** Who is asking, which is all the rules need to know about them. */
export interface OpContext {
  role: 'owner' | 'write' | 'read'
  /** The device the op came from. */
  device?: string
}

/** A name as a folder compares it: NFC, and without case. Two names with one key
 *  cannot both live in one folder on Windows or on a Mac, so they cannot on the
 *  account either. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/** What an entry is, read off its name: the one rule the app and the account both
 *  read a name by, so a file made on one is the same kind on the other. Anything that
 *  is not one of the document kinds, an online terminal's `.term` or a chat's `.chat`,
 *  is a file. A chat is found by the id its pointer's words name, never by this entry
 *  (docs/chats.md 4.2): the kind only says what the file is. */
export function kindOfName(name: string): Exclude<EntryKind, 'folder'> {
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) return 'note'
  if (/\.canvas$/i.test(name)) return 'canvas'
  if (/\.pages$/i.test(name)) return 'pages'
  if (/\.(url|webloc)$/i.test(name)) return 'url'
  if (/\.term$/i.test(name)) return 'term'
  if (/\.chat$/i.test(name)) return 'chat'
  return 'file'
}

/** A tree to apply operations to: the entries a space holds, and its cursor. */
export function treeState(entries: Iterable<TreeEntry> = [], cursor = 0): TreeState {
  const map = new Map<string, TreeEntry>()
  let highest = cursor
  for (const entry of entries) {
    map.set(entry.id, entry)
    highest = Math.max(highest, entry.seq, entry.docSeq)
  }
  return { entries: map, cursor: highest, done: new Map() }
}

function tick(state: TreeState): number {
  state.cursor += 1
  return state.cursor
}

/** The names already taken in a folder, as keys, leaving out one entry: the one being
 *  placed, which never collides with itself. */
function takenIn(state: TreeState, parent: string | null, except: string): Set<string> {
  const taken = new Set<string>()
  for (const entry of state.entries.values()) {
    if (entry.deleted || entry.parent !== parent || entry.id === except) continue
    taken.add(nameKey(entry.name))
  }
  return taken
}

/** The first spelling of `wanted` free in a folder. A file steps aside the way the
 *  file list steps it, the number before the extension (`freePath`); a folder has no
 *  extension, so a dot in its name is a dot. */
function freeName(
  state: TreeState,
  parent: string | null,
  wanted: string,
  kind: EntryKind,
  except: string,
): string {
  const taken = takenIn(state, parent, except)
  const free = (candidate: string) => !taken.has(nameKey(candidate))

  if (kind !== 'folder') return freePath(wanted, (candidate) => !free(candidate))
  if (free(wanted)) return wanted
  for (let counter = 2; ; counter += 1) {
    const candidate = `${wanted} ${String(counter)}`
    if (free(candidate)) return candidate
  }
}

/** Whether `ancestor` is `id` or holds it, however deep. Deleted folders count: a
 *  parent pointer is a parent pointer, and a cycle through a deleted folder is still
 *  a cycle the day it is restored. */
function holds(state: TreeState, ancestor: string, id: string | null): boolean {
  const seen = new Set<string>()
  for (let at = id; at !== null;) {
    if (at === ancestor) return true
    if (seen.has(at)) return true
    seen.add(at)
    at = state.entries.get(at)?.parent ?? null
  }
  return false
}

/** One change to an entry: it takes the next cursor, and says which device made it. */
function changed(state: TreeState, entry: TreeEntry, device: string | undefined) {
  entry.seq = tick(state)
  if (device === undefined) delete entry.by
  else entry.by = device
}

/** Brings an entry back where it was, renumbered if its name was taken meanwhile. */
function revive(state: TreeState, entry: TreeEntry, device: string | undefined) {
  if (!entry.deleted) return
  entry.name = freeName(state, entry.parent, entry.name, entry.kind, entry.id)
  entry.deleted = false
  delete entry.deletedIn
  changed(state, entry, device)
}

/** Brings back every deleted folder above a place, top first, so each is named among
 *  siblings that are already back. */
function reviveAbove(state: TreeState, parent: string | null, device: string | undefined) {
  const chain: TreeEntry[] = []
  const seen = new Set<string>()
  for (let at = parent; at !== null && !seen.has(at);) {
    seen.add(at)
    const folder = state.entries.get(at)
    if (!folder) break
    chain.push(folder)
    at = folder.parent
  }
  for (const folder of chain.reverse()) revive(state, folder, device)
}

/** Whether a place can hold things: the top of the space, or a folder the account
 *  has (deleted or not: a deleted one comes back). */
function isPlace(state: TreeState, parent: string | null): boolean {
  if (parent === null) return true
  return state.entries.get(parent)?.kind === 'folder'
}

function placement(op: Op, entry: TreeEntry): OpResult {
  return { op: op.op, ok: true, id: entry.id, parent: entry.parent, name: entry.name }
}

/** Everything under a folder, however deep, in tree order: parents before children. */
function under(state: TreeState, folder: string): TreeEntry[] {
  const children = new Map<string, TreeEntry[]>()
  for (const entry of state.entries.values()) {
    if (entry.parent === null) continue
    const list = children.get(entry.parent) ?? []
    list.push(entry)
    children.set(entry.parent, list)
  }

  const out: TreeEntry[] = []
  const seen = new Set<string>([folder])
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      if (child.kind === 'folder') walk(child.id)
    }
  }
  walk(folder)
  return out
}

/** Whether something written after `seen` by another device stands against a delete. */
function writtenSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const byOther = (by: string | undefined) => device === undefined || by !== device
  return entry.docSeq > seen && byOther(entry.docBy)
}

/** Whether a delete of the folder around an entry has to leave it: something about it
 *  changed after `seen`, by another device. */
function changedSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const byOther = device === undefined || entry.by !== device
  return (entry.seq > seen && byOther) || writtenSince(entry, seen, device)
}

/** The rules, with one op's device in hand. */
class Rules {
  constructor(
    private readonly state: TreeState,
    private readonly device: string | undefined,
  ) {}

  /** Places a new entry: its parent brought back if it was deleted, its name
   *  numbered if taken. */
  made(op: Op, id: string, kind: EntryKind, parent: string | null, wanted: string): OpResult {
    const { state, device } = this
    const existing = state.entries.get(id)
    if (existing) return existing.deleted ? { op: op.op, refused: 'gone' } : placement(op, existing)
    if (!isPlace(state, parent)) return { op: op.op, refused: 'gone' }

    reviveAbove(state, parent, device)
    const entry: TreeEntry = {
      id,
      kind,
      parent,
      name: freeName(state, parent, wanted, kind, id),
      deleted: false,
      seq: 0,
      docSeq: 0,
    }
    changed(state, entry, device)
    state.entries.set(id, entry)
    return placement(op, entry)
  }

  /** A mergeable create: the live note of that name in that folder, if there is one. */
  merged(op: Op & { t: 'create' }): OpResult | null {
    if (!op.mergeable) return null
    const key = nameKey(op.name)
    for (const one of this.state.entries.values()) {
      if (one.deleted || one.parent !== op.parent || one.kind !== op.kind) continue
      if (one.id !== op.id && nameKey(one.name) === key) return { op: op.op, merged: one.id }
    }
    return null
  }

  /** The entry an op on an existing id acts on, brought back first if it was deleted
   *  after its device last looked, or the refusal. */
  target(op: Op & { id: string }): TreeEntry | OpResult {
    const entry = this.state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    if (!entry.deleted) return entry
    if (entry.seq <= op.seen) return { op: op.op, refused: 'gone' }

    reviveAbove(this.state, entry.parent, this.device)
    revive(this.state, entry, this.device)
    return entry
  }

  renamed(op: Op & { t: 'rename' }): OpResult {
    const entry = this.target(op)
    if (!isEntry(entry)) return entry
    const name = freeName(this.state, entry.parent, op.name, entry.kind, entry.id)
    if (name !== entry.name) {
      entry.name = name
      changed(this.state, entry, this.device)
    }
    return placement(op, entry)
  }

  moved(op: Op & { t: 'move' }): OpResult {
    const { state, device } = this
    const current = state.entries.get(op.id)
    if (!current || !isPlace(state, op.parent)) return { op: op.op, refused: 'gone' }
    if (current.kind === 'folder' && holds(state, current.id, op.parent)) {
      return { op: op.op, refused: 'cycle' }
    }

    const entry = this.target(op)
    if (!isEntry(entry)) return entry
    reviveAbove(state, op.parent, device)
    const name = freeName(state, op.parent, op.name ?? entry.name, entry.kind, entry.id)
    if (name !== entry.name || op.parent !== entry.parent) {
      entry.name = name
      entry.parent = op.parent
      changed(state, entry, device)
    }
    return placement(op, entry)
  }

  /** A delete, with the edit-beats-delete rule. */
  deleted(op: Op & { t: 'delete' }): OpResult {
    const { state, device } = this
    const entry = state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    if (entry.deleted) return { op: op.op, ok: true }

    if (entry.kind !== 'folder') {
      if (writtenSince(entry, op.seen, device)) return { op: op.op, refused: 'edited' }
      entry.deleted = true
      changed(state, entry, device)
      entry.deletedIn = entry.seq
      return { op: op.op, ok: true }
    }

    // What the deleting device had not seen stays, and so does every folder between
    // it and the one deleted.
    const inside = under(state, entry.id).filter((one) => !one.deleted)
    const kept = new Set<string>()
    for (const one of inside) {
      if (!changedSince(one, op.seen, device)) continue
      for (let at: string | null = one.id; at !== null && !kept.has(at);) {
        kept.add(at)
        at = state.entries.get(at)?.parent ?? null
      }
    }

    const batch = state.cursor + 1
    for (const one of inside.reverse()) {
      if (kept.has(one.id)) continue
      one.deleted = true
      one.deletedIn = batch
      changed(state, one, device)
    }

    if (kept.has(entry.id)) return { op: op.op, refused: 'edited' }
    entry.deleted = true
    entry.deletedIn = batch
    changed(state, entry, device)
    return { op: op.op, ok: true }
  }

  /** A restore: the entry, the folders above it, and for a folder everything that
   *  was deleted with it. */
  restored(op: Op & { t: 'restore' }): OpResult {
    const { state, device } = this
    const entry = state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    if (!entry.deleted) return placement(op, entry)

    const batch = entry.deletedIn
    reviveAbove(state, entry.parent, device)
    revive(state, entry, device)

    if (entry.kind === 'folder' && batch !== undefined) {
      for (const one of under(state, entry.id)) {
        if (one.deleted && one.deletedIn === batch) revive(state, one, device)
      }
    }
    return placement(op, entry)
  }

  applied(op: Op): OpResult {
    switch (op.t) {
      case 'mkdir':
        return this.made(op, op.id, 'folder', op.parent, op.name)
      case 'create':
        return this.merged(op) ?? this.made(op, op.id, op.kind, op.parent, op.name)
      case 'rename':
        return this.renamed(op)
      case 'move':
        return this.moved(op)
      case 'delete':
        return this.deleted(op)
      case 'restore':
        return this.restored(op)
    }
  }
}

function isEntry(value: TreeEntry | OpResult): value is TreeEntry {
  return 'kind' in value
}

/** Applies one operation, in arrival order, and answers what became of it. The same
 *  op id is answered the same way however often it arrives. */
export function applyOp(state: TreeState, op: Op, context: OpContext): OpResult {
  const before = state.done.get(op.op)
  if (before) return before

  const result: OpResult =
    context.role === 'read'
      ? { op: op.op, refused: 'role' }
      : new Rules(state, context.device).applied(op)
  state.done.set(op.op, result)
  return result
}

/** A document's content changed: it takes the next cursor as its `docSeq`, and a note
 *  somebody deleted while this was being written comes back, with its folders.
 *  Answers the cursor it took. */
export function contentChanged(state: TreeState, id: string, device?: string): number {
  const entry = state.entries.get(id)
  if (!entry) return state.cursor
  if (entry.deleted) {
    reviveAbove(state, entry.parent, device)
    revive(state, entry, device)
  }
  changed(state, entry, device)
  entry.docSeq = entry.seq
  if (device === undefined) delete entry.docBy
  else entry.docBy = device
  return entry.seq
}
