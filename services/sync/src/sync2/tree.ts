/** A space's tree as rows, and the one way anything changes it.
 *
 *  In sync v2 folders are rows with ids and a note's place is a folder and a name
 *  (docs/sync-v2.md section 5.9). The rules every change is made by are
 *  `@nib/sync-core/tree`, shared with the app, which applies its own operations by the
 *  same function; this file is what puts those rules over D1: the space read into a
 *  `TreeState`, the rules run on it in memory, and what moved written back in one
 *  batch, which D1 runs as one transaction.
 *
 *  Three things here are not the rules' business and are this file's:
 *
 *  - **The account serialises.** There is no object per space to queue requests in,
 *    so the batch carries a guard: it is refused if the space's cursor moved since the
 *    tree was read, and the whole read-apply-write is done again. Every write that
 *    matters to the rules (a tree change, a settle, a v1 save) takes a number off that
 *    cursor, so none can slip in between unnoticed.
 *  - **`path` stays current.** Publishing, the connector, v1 apps and `nib-sync.mjs`
 *    read a note by its path, so every note whose path a change moved is written in
 *    the same batch, descendants of a renamed folder included, live or in Recently
 *    deleted. Each takes a cursor of its own, because a v1 app learns of a path only
 *    from its change feed, which pages by cursor.
 *  - **Rows written before there was a tree** (a space nobody prepared, or a v1 write
 *    that raced the preparing) are read as the path they have and placed by it: see
 *    `heal`.
 *
 *  The writing is a handful of statements whatever the size of the change - the rows
 *  travel as JSON through `json_each` - because D1 counts queries per request, and a
 *  folder of five hundred notes renamed is five hundred rows but not five hundred
 *  statements. */

import { freePath } from '@nib/markdown/paths'
import {
  applyOp,
  contentChanged,
  type EntryKind,
  nameKey,
  type Op,
  type OpContext,
  type OpResult,
  type TreeEntry,
  type TreeState,
  treeState,
} from '@nib/sync-core'
import { chunks } from '../bound'
import { newId, now } from '../crypto'
import type { Env } from '../types'

/** The kinds that are documents: a room holds each as a Yjs document. A `file` is a
 *  blob by hash and a `folder` holds the others. */
export const DOCUMENT_KINDS: ReadonlySet<string> = new Set(['note', 'canvas', 'pages', 'url'])

/** The same four, as SQL, for the statements that ask. */
export const DOCUMENTS_SQL = "('note', 'canvas', 'pages', 'url')"

/** What an entry is, read off its name the way the app reads it. Anything that is not
 *  one of the four document kinds is a file. */
export function kindOfName(name: string): Exclude<EntryKind, 'folder'> {
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) return 'note'
  if (/\.canvas$/i.test(name)) return 'canvas'
  if (/\.pages$/i.test(name)) return 'pages'
  if (/\.(url|webloc)$/i.test(name)) return 'url'
  return 'file'
}

/** A kind as a column holds it, checked. */
function kindIn(value: string, name: string): EntryKind {
  if (value === 'folder' || value === 'file' || DOCUMENT_KINDS.has(value)) {
    // Checked against the list one line up.
    return value as EntryKind
  }
  return kindOfName(name)
}

/** What a new note starts with, beside its place: the hash, size and front of its
 *  words, and the epoch its document is on. A v2 create starts empty and its words
 *  arrive by push; a v1 create arrives with them. */
export interface Content {
  hash: string
  size: number
  front: string | null
  epoch: number
  epochBase: string | null
}

/** An entry as it was read, to tell afterwards what the rules changed. */
type Snapshot = Omit<TreeEntry, 'id' | 'kind'>

function snapshotOf(entry: TreeEntry): Snapshot {
  const { id: _id, kind: _kind, ...rest } = entry
  return { ...rest }
}

function sameAs(entry: TreeEntry, before: Snapshot): boolean {
  return (
    entry.parent === before.parent &&
    entry.name === before.name &&
    entry.deleted === before.deleted &&
    entry.seq === before.seq &&
    entry.docSeq === before.docSeq &&
    entry.by === before.by &&
    entry.docBy === before.docBy &&
    entry.deletedIn === before.deletedIn
  )
}

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  deleted: number
  seq: number
  updated_by: string | null
  deleted_in: number | null
}

interface NoteRow {
  id: string
  kind: string
  folder_id: string | null
  name: string | null
  deleted: number
  seq: number
  doc_seq: number | null
  updated_by: string | null
  doc_by: string | null
  deleted_in: number | null
  path: string
  epoch: number
}

/** One space's tree, read and being changed. */
export class Tree {
  readonly state: TreeState
  /** What each entry was when read. An entry with none is new. */
  private readonly before = new Map<string, Snapshot>()
  /** Each note's path as the row holds it. */
  private readonly paths = new Map<string, string>()
  /** Notes whose rows carried no tree yet, placed by their path; see `heal`. */
  private readonly raw: NoteRow[] = []
  private readonly rawIds = new Set<string>()
  /** What each note made in this batch starts with. */
  readonly content = new Map<string, Content>()
  /** The ops answered in this batch for the first time, with their answers. */
  private readonly answered = new Map<string, OpResult>()
  /** Whether a document in the space is still on no epoch: see `commit`. */
  private unmarked = false

  constructor(
    readonly spaceId: string,
    /** The cursor's next value as read: what the batch's guard holds it to. */
    readonly next: number,
    folders: readonly FolderRow[],
    notes: readonly NoteRow[],
    /** The device the changes are made for, which a note whose path moved because a
     *  folder above it did is written down as changed by. */
    private readonly device: string | undefined,
  ) {
    const entries: TreeEntry[] = []
    for (const row of folders) entries.push(folderEntry(row))
    for (const row of notes) {
      if (row.epoch === 0 && DOCUMENT_KINDS.has(kindIn(row.kind, row.name ?? row.path))) {
        this.unmarked = true
      }
      this.paths.set(row.id, row.path)
      if (row.name === null) {
        this.raw.push(row)
        this.rawIds.add(row.id)
        continue
      }
      entries.push(noteEntry(row, row.name))
    }

    this.state = treeState(entries, next - 1)
    for (const entry of this.state.entries.values()) this.before.set(entry.id, snapshotOf(entry))
    this.heal()
  }

  /** Whether any of this space's notes was written before it had a tree. */
  get healed(): boolean {
    return this.raw.length > 0
  }

  /** Places every note whose row has no tree yet by its path: a folder row for each
   *  folder in it, found or made, and its name, numbered where a live sibling already
   *  answers to it the way Windows and a Mac compare names. Oldest first, so where two
   *  collide it is the later that is numbered (section 8). Folders that differ only
   *  by case or normalisation are one folder: on those two systems they already are,
   *  and a Linux device's two spellings join rather than one of them growing a
   *  number. */
  private heal() {
    const rows = [...this.raw].sort((a, b) => a.seq - b.seq)
    for (const row of rows) {
      const parts = row.path.split('/')
      const name = parts.pop() ?? row.path
      const live = row.deleted === 0

      let parent: string | null = null
      for (const part of parts) parent = this.folderFor(parent, part, live, row.seq)

      const placed = live ? this.freeName(parent, name) : name
      const entry = noteEntry(row, placed)
      entry.parent = parent
      entry.kind = kindIn(row.kind === 'note' ? kindOfName(name) : row.kind, name)
      this.state.entries.set(entry.id, entry)
      // Known before, so it is written as a row that changed rather than one made; and
      // as one whose name was nothing, so it is written at all.
      this.before.set(entry.id, { ...snapshotOf(entry), name: '' })
    }
  }

  /** The folder called `name` in `parent`, a live one first; made if there is none,
   *  and brought back if the only one is deleted and a live note needs it. */
  private folderFor(parent: string | null, name: string, live: boolean, seq: number): string {
    const key = nameKey(name)
    let deleted: TreeEntry | undefined
    for (const entry of this.state.entries.values()) {
      if (entry.kind !== 'folder' || entry.parent !== parent || nameKey(entry.name) !== key) continue
      if (!entry.deleted) return entry.id
      deleted ??= entry
    }

    if (deleted) {
      if (live) {
        deleted.deleted = false
        delete deleted.deletedIn
        deleted.seq = this.tick()
      }
      return deleted.id
    }

    const folder: TreeEntry = {
      id: newId(),
      kind: 'folder',
      parent,
      name: live ? this.freeName(parent, name) : name,
      deleted: !live,
      seq: this.tick(),
      docSeq: 0,
    }
    if (!live) folder.deletedIn = seq
    this.state.entries.set(folder.id, folder)
    return folder.id
  }

  /** The first spelling of a file's name free among the live entries of a folder. */
  private freeName(parent: string | null, wanted: string): string {
    const taken = new Set<string>()
    for (const entry of this.state.entries.values()) {
      if (!entry.deleted && entry.parent === parent) taken.add(nameKey(entry.name))
    }
    return freePath(wanted, (candidate) => taken.has(nameKey(candidate)))
  }

  private tick(): number {
    this.state.cursor += 1
    return this.state.cursor
  }

  /** One op, by the rules, answered. An op id seen before is answered as it was. */
  apply(op: Op, context: OpContext): OpResult {
    const repeated = this.state.done.has(op.op)
    const result = applyOp(this.state, op, context)
    if (!repeated) this.answered.set(op.op, result)
    return result
  }

  /** The answers ops were given before, read in so that sending one again is
   *  answered the same way. */
  remember(done: ReadonlyMap<string, OpResult>) {
    for (const [op, result] of done) this.state.done.set(op, result)
  }

  /** A document's content changed, which brings a deleted one back; see
   *  `contentChanged`. */
  touch(id: string, device?: string): number {
    return contentChanged(this.state, id, device)
  }

  entry(id: string): TreeEntry | undefined {
    return this.state.entries.get(id)
  }

  /** The live entry called `name` in `parent`, as a folder compares names. */
  child(parent: string | null, name: string): TreeEntry | undefined {
    const key = nameKey(name)
    for (const entry of this.state.entries.values()) {
      if (!entry.deleted && entry.parent === parent && nameKey(entry.name) === key) return entry
    }
    return undefined
  }

  /** Where an entry is, as a path: its folders' names and its own, `/`-separated. A
   *  loop in the parents - which the rules never make, and a row edited by hand could -
   *  ends the walk rather than the Worker. */
  pathOf(id: string): string {
    const names: string[] = []
    const seen = new Set<string>()
    for (let at: string | null = id; at !== null && !seen.has(at);) {
      seen.add(at)
      const entry = this.state.entries.get(at)
      if (!entry) break
      names.push(entry.name)
      at = entry.parent
    }
    return names.reverse().join('/')
  }

  /** Every note's path, and which changed; those whose own row did not change take a
   *  cursor, so a v1 app's feed carries the move. */
  private moved(): Map<string, string> {
    const out = new Map<string, string>()
    for (const entry of this.state.entries.values()) {
      if (entry.kind === 'folder') continue
      const path = this.pathOf(entry.id)
      if (path === this.paths.get(entry.id)) continue
      out.set(entry.id, path)

      const before = this.before.get(entry.id)
      if (this.rawIds.has(entry.id) || (before && sameAs(entry, before))) {
        entry.seq = this.tick()
        if (this.device === undefined) delete entry.by
        else entry.by = this.device
      }
    }
    return out
  }

  /** The batch that writes what changed, or null when nothing did. */
  statements(env: Env): D1PreparedStatement[] | null {
    const moved = this.moved()
    const at = now()

    const folders: Record<string, unknown>[] = []
    const newFolders: Record<string, unknown>[] = []
    const notes: Record<string, unknown>[] = []
    const newNotes: Record<string, unknown>[] = []

    for (const entry of this.state.entries.values()) {
      const before = this.before.get(entry.id)
      if (before && sameAs(entry, before) && !moved.has(entry.id)) continue

      const gone = before && before.deleted !== entry.deleted ? (entry.deleted ? 1 : 0) : 2
      const row = {
        id: entry.id,
        parent: entry.parent,
        name: entry.name,
        key: nameKey(entry.name),
        seq: entry.seq,
        deleted: entry.deleted ? 1 : 0,
        gone,
        deletedIn: entry.deletedIn ?? null,
        by: entry.by ?? null,
      }

      if (entry.kind === 'folder') {
        ;(before ? folders : newFolders).push(row)
        continue
      }

      const path = moved.get(entry.id) ?? this.paths.get(entry.id) ?? this.pathOf(entry.id)
      const placed = {
        ...row,
        kind: entry.kind,
        path,
        docSeq: entry.docSeq,
        docBy: entry.docBy ?? null,
        // A v1 app reads a note's version as "it changed": a note whose path or whose
        // being deleted moved has; one that only had its tree written down has not.
        bump: moved.has(entry.id) || gone !== 2 ? 1 : 0,
      }
      if (before) {
        notes.push(placed)
        continue
      }

      const content = this.content.get(entry.id) ?? emptyContent(entry.kind)
      newNotes.push({
        ...placed,
        hash: content.hash,
        size: content.size,
        front: content.front,
        epoch: content.epoch,
        epochBase: content.epochBase,
      })
    }

    const ops = [...this.answered].map(([op, result]) => ({
      id: `${this.spaceId}/${op}`,
      result: JSON.stringify(result),
    }))

    const changed = folders.length + newFolders.length + notes.length + newNotes.length > 0
    if (!changed && !ops.length && !this.unmarked) return null

    const db = env.DB
    const space = this.spaceId
    const out: D1PreparedStatement[] = []

    if (changed) {
      out.push(guard(db, space, this.next))

      // Every row about to change lets go of its name first, so a batch that swaps two
      // names - or renames into a name another row is leaving - never meets itself
      // half way: SQLite holds a unique index row by row, not at the end.
      for (const piece of chunks(folders.map((one) => one.id), 500)) {
        out.push(
          db
            .prepare(
              `update folders set name_key = char(0) || id
                where space_id = ?1 and id in (select value from json_each(?2))`,
            )
            .bind(space, JSON.stringify(piece)),
        )
      }
      for (const piece of chunks(notes.map((one) => one.id), 500)) {
        out.push(
          db
            .prepare(
              `update notes set name_key = char(0) || id, path = char(0) || id
                where space_id = ?1 and id in (select value from json_each(?2))`,
            )
            .bind(space, JSON.stringify(piece)),
        )
      }

      for (const piece of chunks(folders, 500)) out.push(updateFolders(db, space, at, piece))
      for (const piece of chunks(newFolders, 500)) out.push(insertFolders(db, space, at, piece))
      for (const piece of chunks(notes, 500)) out.push(updateNotes(db, space, at, piece))
      for (const piece of chunks(newNotes, 500)) out.push(insertNotes(db, space, at, piece))

      out.push(
        db
          .prepare(
            `insert into space_cursor (space_id, next) values (?1, ?2)
             on conflict(space_id) do update set next = excluded.next`,
          )
          .bind(space, this.state.cursor + 1),
      )
    }

    if (this.unmarked) out.push(markEpochs(db, space))

    for (const piece of chunks(ops, 200)) {
      out.push(
        db
          .prepare(
            `insert or ignore into tree_ops (op_id, space_id, result, at)
             select json_extract(value, '$.id'), ?1, json_extract(value, '$.result'), ?2
               from json_each(?3)`,
          )
          .bind(space, at, JSON.stringify(piece)),
      )
    }

    return out
  }
}

/** Every document of a space still on no epoch, put on the first one, seeded from the
 *  words it has now (section 11, step 3). One statement, so the words and the hash the
 *  epoch names can never be two different moments. */
export function markEpochs(db: D1Database, space: string): D1PreparedStatement {
  return db
    .prepare(
      `update notes set epoch = 1, epoch_base = hash
        where space_id = ?1 and epoch = 0 and kind in ${DOCUMENTS_SQL}`,
    )
    .bind(space)
}

/** What a note made by a tree op holds until its words arrive: nothing, on the first
 *  epoch, seeded from nothing. A file's bytes are its blob, and its hash comes with
 *  the op; see `Content` and ops.ts. */
function emptyContent(kind: EntryKind): Content {
  const document = DOCUMENT_KINDS.has(kind)
  return {
    hash: EMPTY_HASH,
    size: 0,
    front: null,
    epoch: document ? 1 : 0,
    epochBase: document ? EMPTY_HASH : null,
  }
}

/** sha256 of nothing, which is what an empty note's row says its words hash to. */
export const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Refuses the batch when the space's cursor is not where it was when the tree was
 *  read. It inserts the space's own cursor row a second time exactly then, which the
 *  primary key refuses, and D1 takes the whole batch back. */
function guard(db: D1Database, space: string, next: number): D1PreparedStatement {
  return db
    .prepare(
      `insert into space_cursor (space_id, next)
       select ?1, 0 where coalesce((select next from space_cursor where space_id = ?1), 1) != ?2`,
    )
    .bind(space, next)
}

function field(name: string): string {
  return `json_extract(value, '$.${name}')`
}

function updateFolders(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `update folders set parent_id = c.parent, name = c.name, name_key = c.key, seq = c.seq,
              deleted = c.deleted,
              deleted_at = case c.gone when 1 then ?2 when 0 then null else folders.deleted_at end,
              deleted_in = c.deleted_in, updated_at = ?2, updated_by = c.by
         from (select ${field('id')} as fid, ${field('parent')} as parent, ${field('name')} as name,
                      ${field('key')} as key, ${field('seq')} as seq, ${field('deleted')} as deleted,
                      ${field('gone')} as gone, ${field('deletedIn')} as deleted_in,
                      ${field('by')} as by
                 from json_each(?3)) as c
        where folders.id = c.fid and folders.space_id = ?1`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function insertFolders(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `insert into folders (id, space_id, parent_id, name, name_key, seq, deleted, deleted_at,
                            deleted_in, updated_at, updated_by)
       select ${field('id')}, ?1, ${field('parent')}, ${field('name')}, ${field('key')},
              ${field('seq')}, ${field('deleted')},
              case ${field('deleted')} when 1 then ?2 else null end,
              ${field('deletedIn')}, ?2, ${field('by')}
         from json_each(?3)`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function updateNotes(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `update notes set folder_id = c.parent, name = c.name, name_key = c.key, kind = c.kind,
              path = c.path, seq = c.seq, deleted = c.deleted,
              deleted_at = case c.gone when 1 then ?2 when 0 then null else notes.deleted_at end,
              deleted_in = c.deleted_in, updated_by = c.by, doc_seq = c.doc_seq,
              doc_by = c.doc_by, version = notes.version + c.bump,
              updated_at = case c.bump when 1 then ?2 else notes.updated_at end
         from (select ${field('id')} as nid, ${field('parent')} as parent, ${field('name')} as name,
                      ${field('key')} as key, ${field('kind')} as kind, ${field('path')} as path,
                      ${field('seq')} as seq, ${field('deleted')} as deleted,
                      ${field('gone')} as gone, ${field('deletedIn')} as deleted_in,
                      ${field('by')} as by, ${field('docSeq')} as doc_seq,
                      ${field('docBy')} as doc_by, ${field('bump')} as bump
                 from json_each(?3)) as c
        where notes.id = c.nid and notes.space_id = ?1`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function insertNotes(
  db: D1Database,
  space: string,
  at: number,
  rows: readonly Record<string, unknown>[],
): D1PreparedStatement {
  return db
    .prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, deleted_at, size,
                          hash, front, folder_id, name, name_key, kind, epoch, epoch_base,
                          doc_seq, doc_by, updated_by, deleted_in)
       select ${field('id')}, ?1, ${field('path')}, ${field('seq')}, 1, ?2, ${field('deleted')},
              case ${field('deleted')} when 1 then ?2 else null end, ${field('size')},
              ${field('hash')}, ${field('front')}, ${field('parent')}, ${field('name')},
              ${field('key')}, ${field('kind')}, ${field('epoch')}, ${field('epochBase')},
              ${field('docSeq')}, ${field('docBy')}, ${field('by')}, ${field('deletedIn')}
         from json_each(?3)`,
    )
    .bind(space, at, JSON.stringify(rows))
}

function folderEntry(row: FolderRow): TreeEntry {
  const entry: TreeEntry = {
    id: row.id,
    kind: 'folder',
    parent: row.parent_id,
    name: row.name,
    deleted: row.deleted === 1,
    seq: row.seq,
    docSeq: 0,
  }
  if (row.updated_by !== null) entry.by = row.updated_by
  if (row.deleted_in !== null) entry.deletedIn = row.deleted_in
  return entry
}

function noteEntry(row: NoteRow, name: string): TreeEntry {
  const entry: TreeEntry = {
    id: row.id,
    kind: kindIn(row.kind, name),
    parent: row.folder_id,
    name,
    deleted: row.deleted === 1,
    seq: row.seq,
    // A note written before there was a tree was last written when its row last moved:
    // what a delete made since then has to have seen.
    docSeq: row.doc_seq ?? row.seq,
  }
  if (row.updated_by !== null) entry.by = row.updated_by
  if (row.doc_by !== null) entry.docBy = row.doc_by
  if (row.deleted_in !== null) entry.deletedIn = row.deleted_in
  return entry
}

/** The space's tree as the rows hold it. Notes purged from Recently deleted are not in
 *  it: their words are gone for good, and nothing may bring one back. */
export async function readTree(env: Env, spaceId: string, device?: string): Promise<Tree> {
  const cursor = await env.DB.prepare('select next from space_cursor where space_id = ?')
    .bind(spaceId)
    .first<{ next: number }>()
  const folders = await env.DB.prepare(
    `select id, parent_id, name, deleted, seq, updated_by, deleted_in
       from folders where space_id = ?`,
  )
    .bind(spaceId)
    .all<FolderRow>()
  const notes = await env.DB.prepare(
    `select id, kind, folder_id, name, deleted, seq, doc_seq, updated_by, doc_by, deleted_in,
            path, epoch
       from notes where space_id = ? and not (deleted = 1 and deleted_at is null)`,
  )
    .bind(spaceId)
    .all<NoteRow>()

  return new Tree(spaceId, cursor?.next ?? 1, folders.results, notes.results, device)
}

/** What a change to the tree answers with: what the work handed back, the cursor the
 *  space is at, and whether anything was written. */
export interface Changed<T> {
  value: T
  cursor: number
  changed: boolean
}

/** How often a change is tried again when somebody else moved the space in between. */
const ATTEMPTS = 6

/** Reads the tree, lets `work` change it by the rules, and writes what moved, as one
 *  transaction guarded by the cursor; tried again from a fresh read when another write
 *  landed in between. `work` must therefore decide from the tree it is handed and from
 *  nothing it remembered from a previous try. */
export async function changeTree<T>(
  env: Env,
  spaceId: string,
  device: string | undefined,
  work: (tree: Tree) => T | Promise<T>,
  opIds: readonly string[] = [],
): Promise<Changed<T>> {
  for (let attempt = 0; ; attempt++) {
    const tree = await readTree(env, spaceId, device)
    if (opIds.length) tree.remember(await answeredBefore(env, spaceId, opIds))
    const value = await work(tree)
    const batch = tree.statements(env)
    if (!batch) return { value, cursor: tree.state.cursor, changed: false }

    try {
      await env.DB.batch(batch)
      return { value, cursor: tree.state.cursor, changed: tree.state.cursor >= tree.next }
    } catch (error) {
      if (attempt + 1 >= ATTEMPTS || !(await cursorMoved(env, spaceId, tree.next))) throw error
    }
  }
}

async function cursorMoved(env: Env, spaceId: string, next: number): Promise<boolean> {
  const row = await env.DB.prepare('select next from space_cursor where space_id = ?')
    .bind(spaceId)
    .first<{ next: number }>()
  return (row?.next ?? 1) !== next
}

/** How long an op's answer is kept for a device that sends it again. The nightly job
 *  takes older ones; see `sweepTreeOps`. */
export const OPS_KEPT_FOR = 30 * 24 * 60 * 60 * 1000

/** What the space answered any of these ops with before: what makes a retried op the
 *  same op. The ids travel as one JSON list, because two hundred of them bound one by
 *  one would be past what a statement may bind. */
async function answeredBefore(
  env: Env,
  spaceId: string,
  opIds: readonly string[],
): Promise<Map<string, OpResult>> {
  const prefix = `${spaceId}/`
  const { results } = await env.DB.prepare(
    'select op_id, result from tree_ops where op_id in (select value from json_each(?))',
  )
    .bind(JSON.stringify(opIds.map((op) => prefix + op)))
    .all<{ op_id: string; result: string }>()

  const out = new Map<string, OpResult>()
  for (const row of results) {
    if (!row.op_id.startsWith(prefix)) continue
    try {
      // Written by this file from an `OpResult` and nothing else.
      out.set(row.op_id.slice(prefix.length), JSON.parse(row.result) as OpResult)
    } catch {
      // A row that does not parse answers nothing, and the op is applied as new.
    }
  }
  return out
}

/** Takes answers older than a device would ever resend: the nightly job's. */
export async function sweepTreeOps(env: Env, at: number): Promise<void> {
  await env.DB.prepare('delete from tree_ops where at < ?')
    .bind(at - OPS_KEPT_FOR)
    .run()
}
