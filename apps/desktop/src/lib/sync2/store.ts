/** The device's sync store, as the engine sees it: one typed interface over SQLite on a
 *  desktop and a phone (src-tauri/src/sync_store.rs) and IndexedDB in a browser
 *  (web/sync-store.ts). The engine imports this and nothing else.
 *
 *  The tables are docs/sync-v2.md section 9.2, column for column and under the same
 *  names, so a row reads the same in the spec, in SQL and here. A pass is a handful of
 *  calls rather than one per note: `read` answers a list of questions from one snapshot
 *  and `write` applies a list of changes all or nothing.
 *
 *  Everything read back is checked against `TABLES` before the engine sees it, whichever
 *  store it came from: a row is unknown until it has been looked at (docs/conventions.md,
 *  "Types"). `TABLES` is the same list the crate holds in sync_store/tables.rs, and
 *  store.test.ts holds both to what the migration actually makes. */

import { isNative } from '../tauri'

/** A value a `meta` row may hold: the device id and the schema are text and numbers,
 *  and anything else the engine keeps there is one of the same or bytes. */
type MetaValue = string | number | Uint8Array | null

export interface MetaRow {
  key: string
  value: MetaValue
}

/** A space this device holds: where it is on disk, the feed cursor, this device's role
 *  in it and the web store its pages use. */
export interface SpaceRow {
  space_id: string
  root: string
  cursor: number
  role: string | null
  store: string | null
}

/** One entry of a space's tree, by the account's id, and where it is on this disk. */
export interface EntryRow {
  id: string
  space_id: string
  kind: string
  parent: string | null
  name: string
  /** The name on this disk, which is the account's name unless this platform cannot
   *  hold it (section 5.9). */
  local_path: string
  /** The file's identity on this disk; see `fileIdentity` in space-watch.ts. */
  file_key: string | null
  written_hash: string | null
  mtime: number | null
  size: number | null
  seq: number | null
  deleted: boolean
}

/** What nib last wrote to a note: the ancestor of every three-way merge with another
 *  program's edit (section 5.5). */
export interface WrittenRow {
  id: string
  text: string
}

/** A document: what the account confirmed, and what this device has not sent. */
export interface DocRow {
  id: string
  epoch: number
  client_id: number
  confirmed: Uint8Array
  confirmed_sv: Uint8Array
  pending: Uint8Array | null
  pending_at: number | null
}

/** A tree op waiting to go up. */
export interface OutboxRow {
  op_id: string
  space_id: string
  op: Uint8Array
  seen: number
  made_at: number
}

/** A note held for the question: what the account had when this device's edits
 *  diverged from it. */
export interface HeldRow {
  id: string
  remote: Uint8Array
  remote_sv: Uint8Array
  device: string | null
  at: number
}

/** Where a blob is: here, wanted, or on its way up. */
export interface FileStateRow {
  hash: string
  state: string
}

/** A web lease this device has seen. */
export interface WebRow {
  key: string
  fence: number | null
  version: number | null
  applied: number | null
}

/** One pass, for a person reading why sync did what it did. The store keeps the newest
 *  thousand. */
export interface LogRow {
  at: number
  space: string | null
  pulled: number | null
  pushed: number | null
  failed: string | null
}

/** Every table, by name, and the row it holds. */
export interface Rows {
  meta: MetaRow
  spaces: SpaceRow
  entries: EntryRow
  written: WrittenRow
  docs: DocRow
  outbox: OutboxRow
  held: HeldRow
  files: FileStateRow
  web: WebRow
  log: LogRow
}

export type TableName = keyof Rows

/** The tables a row can be found in by its key: all but the log. */
export type KeyedTable = Exclude<TableName, 'log'>

/** The tables whose rows belong to a space, which a scan and a clear can be narrowed to. */
export type SpacedTable = 'entries' | 'outbox' | 'log'

/** Each keyed table's key column. */
interface Keys {
  meta: 'key'
  spaces: 'space_id'
  entries: 'id'
  written: 'id'
  docs: 'id'
  outbox: 'op_id'
  held: 'id'
  files: 'hash'
  web: 'key'
}

/** What a column holds. `packed` is text the SQLite store compresses on its way to the
 *  disk; to everybody else it is text. */
type Kind = 'text' | 'integer' | 'bool' | 'blob' | 'packed' | 'any'

interface Column {
  name: string
  kind: Kind
  required: boolean
}

export interface TableSpec {
  /** The column a row is found by; null for the log. */
  key: string | null
  /** The column that says which space a row belongs to, where there is one. */
  space: string | null
  columns: readonly Column[]
}

const maybe = (name: string, kind: Kind): Column => ({ name, kind, required: false })
const always = (name: string, kind: Kind): Column => ({ name, kind, required: true })

/** Every table, as schema 1 made it. */
export const TABLES: Readonly<Record<TableName, TableSpec>> = {
  meta: { key: 'key', space: null, columns: [always('key', 'text'), maybe('value', 'any')] },
  spaces: {
    key: 'space_id',
    space: null,
    columns: [
      always('space_id', 'text'),
      always('root', 'text'),
      always('cursor', 'integer'),
      maybe('role', 'text'),
      maybe('store', 'text'),
    ],
  },
  entries: {
    key: 'id',
    space: 'space_id',
    columns: [
      always('id', 'text'),
      always('space_id', 'text'),
      always('kind', 'text'),
      maybe('parent', 'text'),
      always('name', 'text'),
      always('local_path', 'text'),
      maybe('file_key', 'text'),
      maybe('written_hash', 'text'),
      maybe('mtime', 'integer'),
      maybe('size', 'integer'),
      maybe('seq', 'integer'),
      always('deleted', 'bool'),
    ],
  },
  written: { key: 'id', space: null, columns: [always('id', 'text'), always('text', 'packed')] },
  docs: {
    key: 'id',
    space: null,
    columns: [
      always('id', 'text'),
      always('epoch', 'integer'),
      always('client_id', 'integer'),
      always('confirmed', 'blob'),
      always('confirmed_sv', 'blob'),
      maybe('pending', 'blob'),
      maybe('pending_at', 'integer'),
    ],
  },
  outbox: {
    key: 'op_id',
    space: 'space_id',
    columns: [
      always('op_id', 'text'),
      always('space_id', 'text'),
      always('op', 'blob'),
      always('seen', 'integer'),
      always('made_at', 'integer'),
    ],
  },
  held: {
    key: 'id',
    space: null,
    columns: [
      always('id', 'text'),
      always('remote', 'blob'),
      always('remote_sv', 'blob'),
      maybe('device', 'text'),
      always('at', 'integer'),
    ],
  },
  files: { key: 'hash', space: null, columns: [always('hash', 'text'), always('state', 'text')] },
  web: {
    key: 'key',
    space: null,
    columns: [
      always('key', 'text'),
      maybe('fence', 'integer'),
      maybe('version', 'integer'),
      maybe('applied', 'integer'),
    ],
  },
  log: {
    key: null,
    space: 'space',
    columns: [
      always('at', 'integer'),
      maybe('space', 'text'),
      maybe('pulled', 'integer'),
      maybe('pushed', 'integer'),
      maybe('failed', 'text'),
    ],
  },
}

/** How many rows of the log a store keeps. */
export const LOG_ROWS = 1000

// ---------------------------------------------------------------------------
// Questions and changes

/** One row by its key, answered with the row or null. */
export interface Get<T extends KeyedTable = KeyedTable> {
  t: 'get'
  table: T
  key: string
}

/** Every row of a table, or of one space in it, in the table's order: by key, the
 *  outbox oldest first, the log as it was written. */
export interface Scan<T extends TableName = TableName> {
  t: 'scan'
  table: T
  space?: string
}

export type Query =
  { [T in KeyedTable]: Get<T> }[KeyedTable] | { [T in TableName]: Scan<T> }[TableName]

/** What one question is answered with. */
export type Answer<Q> =
  Q extends Get<infer T> ? Rows[T] | null : Q extends Scan<infer T> ? Rows[T][] : never

/** What a list of questions is answered with, answer for question. */
export type Answers<Q extends readonly Query[]> = { -readonly [I in keyof Q]: Answer<Q[I]> }

export const get = <T extends KeyedTable>(table: T, key: string): Get<T> => ({
  t: 'get',
  table,
  key,
})

export const scan = <T extends TableName>(table: T): Scan<T> => ({ t: 'scan', table })

export const scanSpace = <T extends SpacedTable>(table: T, space: string): Scan<T> => ({
  t: 'scan',
  table,
  space,
})

/** A whole row, over whatever had its key. A log row is added. */
export interface Put<T extends TableName = TableName> {
  t: 'put'
  table: T
  row: Rows[T]
}

/** Some columns of a row that is already there, never its key: what lets the pending
 *  half of a document be written without the confirmed half. Counts 0 when there is no
 *  such row. */
export interface Patch<T extends KeyedTable = KeyedTable> {
  t: 'patch'
  table: T
  key: string
  set: Partial<Omit<Rows[T], Keys[T]>>
}

export interface Delete {
  t: 'delete'
  table: KeyedTable
  key: string
}

/** Every row of one space in a table that has spaces. */
export interface Clear {
  t: 'clear'
  table: SpacedTable
  space: string
}

export type Change =
  | { [T in TableName]: Put<T> }[TableName]
  | { [T in KeyedTable]: Patch<T> }[KeyedTable]
  | Delete
  | Clear

export const put = <T extends TableName>(table: T, row: Rows[T]): Put<T> => ({
  t: 'put',
  table,
  row,
})

export const patch = <T extends KeyedTable>(
  table: T,
  key: string,
  set: Partial<Omit<Rows[T], Keys[T]>>,
): Patch<T> => ({ t: 'patch', table, key, set })

export const remove = (table: KeyedTable, key: string): Delete => ({ t: 'delete', table, key })

export const clear = (table: SpacedTable, space: string): Clear => ({ t: 'clear', table, space })

// ---------------------------------------------------------------------------
// The store

/** What opening a store found. */
export interface Opened {
  /** This device's id, made the first time and kept for the store's life. */
  device: string
  /** Whether the session before this one said it ended cleanly. False after a crash,
   *  which is when every document's client id is rotated (section 5.2). */
  wasClean: boolean
  schema: number
  /** Whether the store could not be read and was made again empty; the engine then
   *  rebuilds from the account and the files. */
  recovered: boolean
}

export interface SyncStore {
  readonly opened: Opened
  /** Answers every question, in order, from one snapshot. */
  read<const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>>
  /** Applies every change in one transaction and answers how many rows each touched.
   *  One refusal and nothing of the batch is written. */
  write(changes: readonly Change[]): Promise<number[]>
  /** Says whether this session is ending cleanly: true once everything the engine held
   *  is written, as the app quits. Opening sets it false again. */
  cleanExit(clean: boolean): Promise<void>
  close(): Promise<void>
}

/** Opens an account's store in whichever build this is. */
export async function openSyncStore(account: string): Promise<SyncStore> {
  if (isNative) {
    const { openNative } = await import('../native-sync-store')
    return openNative(account)
  }
  const { openWeb } = await import('../web/sync-store')
  return openWeb(account)
}

/** Deletes an account's store, as signing out does. */
export async function forgetSyncStore(account: string): Promise<void> {
  if (isNative) {
    const { forgetNative } = await import('../native-sync-store')
    return forgetNative(account)
  }
  const { forgetWeb } = await import('../web/sync-store')
  return forgetWeb(account)
}

// ---------------------------------------------------------------------------
// Checks, the same in both directions and both stores

/** Why a store refused, or why what it answered could not be read. */
export class StoreError extends Error {
  override name = 'StoreError'
}

/** A table the store has, or the refusal. */
function tableNamed(name: string): TableSpec {
  if (!(name in TABLES)) throw new StoreError(`the sync store has no table ${name}`)
  // Asked of TABLES on the line above, which is every name `TableName` has.
  return TABLES[name as TableName]
}

/** The largest whole number both stores keep exactly. */
const fits = (value: unknown): value is number => Number.isSafeInteger(value)

/** Whether a value is what a column holds; null is judged by `required` instead. */
function holds(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'text':
    case 'packed':
      return typeof value === 'string'
    case 'integer':
      return fits(value)
    case 'bool':
      return typeof value === 'boolean'
    case 'blob':
      return value instanceof Uint8Array
    case 'any':
      return typeof value === 'string' || fits(value) || value instanceof Uint8Array
  }
}

/** One value for one column, or the sentence that says why not. */
function checked(table: string, column: Column, value: unknown): unknown {
  if (value === null || value === undefined) {
    if (column.required) throw new StoreError(`${table}.${column.name} may not be empty`)
    return null
  }
  if (!holds(column.kind, value)) {
    throw new StoreError(`${table}.${column.name} does not take ${describe(value)}`)
  }
  return value
}

function describe(value: unknown): string {
  if (value instanceof Uint8Array) return `${value.length} bytes`
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return typeof value
}

/** A row as a table keeps it: every column, each checked, and nothing else. What both
 *  stores run every row they write through, and every row they read back. */
export function rowOf<T extends TableName>(table: T, value: unknown): Rows[T] {
  if (typeof value !== 'object' || value === null) {
    throw new StoreError(`a ${table} row is not an object`)
  }
  const given = value as Record<string, unknown>
  const spec = TABLES[table]
  for (const name of Object.keys(given)) {
    if (!spec.columns.some((column) => column.name === name)) {
      throw new StoreError(`${table} has no column ${name}`)
    }
  }

  const row: Record<string, unknown> = {}
  for (const column of spec.columns) row[column.name] = checked(table, column, given[column.name])
  // Checked column by column against TABLES, which is `Rows` spelled as values.
  return row as unknown as Rows[T]
}

/** The columns a patch sets, each checked, and never the key. */
export function patchOf(table: KeyedTable, set: unknown): Record<string, unknown> {
  if (typeof set !== 'object' || set === null) {
    throw new StoreError(`a patch of ${table} is not an object`)
  }
  const spec = TABLES[table]
  const entries = Object.entries(set)
  if (entries.length === 0) throw new StoreError(`a patch of ${table} changes nothing`)

  const out: Record<string, unknown> = {}
  for (const [name, value] of entries) {
    const column = spec.columns.find((one) => one.name === name)
    if (!column) throw new StoreError(`${table} has no column ${name}`)
    if (name === spec.key) throw new StoreError(`a patch of ${table} cannot change its ${name}`)
    out[name] = checked(table, column, value)
  }
  return out
}

/** A change, checked whole before anything is written. */
export function changeOf(change: Change): Change {
  const spec = tableNamed(change.table)
  switch (change.t) {
    case 'put':
      rowOf(change.table, change.row)
      return change
    case 'patch':
      patchOf(change.table, change.set)
      return change
    case 'delete':
      if (spec.key === null) throw new StoreError(`${change.table} rows have no key`)
      return change
    case 'clear':
      if (spec.space === null) throw new StoreError(`${change.table} rows belong to no space`)
      return change
  }
}

/** A question, checked. */
export function queryOf(query: Query): Query {
  const spec = tableNamed(query.table)
  if (query.t === 'get' && spec.key === null) {
    throw new StoreError(`${query.table} rows have no key`)
  }
  if (query.t === 'scan' && query.space !== undefined && spec.space === null) {
    throw new StoreError(`${query.table} rows belong to no space`)
  }
  return query
}

/** One answer, checked against the question it answers. */
export function answerOf<Q extends Query>(query: Q, value: unknown): Answer<Q> {
  if (query.t === 'get') {
    return (value === null || value === undefined ? null : rowOf(query.table, value)) as Answer<Q>
  }
  if (!Array.isArray(value)) throw new StoreError(`a scan of ${query.table} did not answer rows`)
  return value.map((row) => rowOf(query.table, row)) as Answer<Q>
}

/** What a store says it opened, checked. */
export function openedOf(value: unknown): Opened {
  const said = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const { device, wasClean, schema, recovered } = said
  if (
    typeof device !== 'string' ||
    typeof wasClean !== 'boolean' ||
    !fits(schema) ||
    typeof recovered !== 'boolean'
  ) {
    throw new StoreError('the sync store answered an odd opening')
  }
  return { device, wasClean, schema, recovered }
}

/** How many rows each change touched, checked. */
export function countsOf(value: unknown, changes: number): number[] {
  if (!Array.isArray(value) || value.length !== changes || !value.every(fits)) {
    throw new StoreError('the sync store answered an odd count')
  }
  return value
}
