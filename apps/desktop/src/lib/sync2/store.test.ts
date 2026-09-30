import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import {
  answerOf,
  changeOf,
  countsOf,
  get,
  openedOf,
  patch,
  patchOf,
  put,
  queryOf,
  remove,
  rowOf,
  scan,
  scanSpace,
  TABLES,
  type Change,
  type Query,
  type TableName,
} from './store'

/** The one list of tables the TypeScript side checks rows against, held to what the
 *  crate's migration makes: the same SQL file, run in Node's own SQLite. The crate holds
 *  its own copy of the list to the same file (sync_store/tables.rs), so the three cannot
 *  drift apart without one of the two tests saying so. */

const SCHEMA = readFileSync(
  new URL('../../../src-tauri/src/sync_store/1.sql', import.meta.url),
  'utf8',
)

interface Made {
  name: string
  type: string
  notnull: number
  pk: number
}

describe('the tables', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)

  test('are the tables the migration makes, column for column', () => {
    const made = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => String(row.name))
    expect(made).toEqual(Object.keys(TABLES).sort())

    for (const [name, spec] of Object.entries(TABLES)) {
      const columns = db.prepare(`pragma table_info(${name})`).all() as unknown as Made[]
      expect(
        columns.map((one) => one.name),
        name,
      ).toEqual(spec.columns.map((one) => one.name))

      for (const [at, column] of spec.columns.entries()) {
        const sql = columns[at]
        expect(sql, `${name}.${column.name}`).toBeDefined()
        if (!sql) continue
        // A text primary key may be null in SQLite; both stores hold it to what a key means.
        expect(column.required, `${name}.${column.name}`).toBe(sql.notnull === 1 || sql.pk > 0)
        expect(spec.key === column.name, `${name}.${column.name} is the key`).toBe(sql.pk > 0)
        const declared = ['integer', 'bool'].includes(column.kind)
          ? 'INTEGER'
          : column.kind === 'text'
            ? 'TEXT'
            : 'BLOB'
        expect(sql.type, `${name}.${column.name}`).toBe(declared)
      }
    }
  })
})

const doc = {
  id: 'n',
  epoch: 1,
  client_id: 7,
  confirmed: new Uint8Array([1, 2]),
  confirmed_sv: new Uint8Array([3]),
  pending: null,
  pending_at: null,
}

describe('a row', () => {
  test('is every column of its table, checked, and nothing else', () => {
    expect(rowOf('docs', doc)).toEqual(doc)
    // A missing column that may be empty is empty; one that may not is refused.
    expect(rowOf('docs', { ...doc, pending: undefined }).pending).toBeNull()
    expect(() => rowOf('docs', { ...doc, epoch: undefined })).toThrow('docs.epoch may not be empty')
  })

  test('refuses what its columns do not take, by name', () => {
    expect(() => rowOf('docs', { ...doc, epoch: '1' })).toThrow('docs.epoch')
    expect(() => rowOf('docs', { ...doc, epoch: 1.5 })).toThrow('docs.epoch')
    expect(() => rowOf('docs', { ...doc, epoch: 2 ** 53 })).toThrow('docs.epoch')
    expect(() => rowOf('docs', { ...doc, confirmed: [1, 2] })).toThrow('docs.confirmed')
    expect(() => rowOf('docs', { ...doc, extra: 1 })).toThrow('docs has no column extra')
    expect(() => rowOf('entries', null)).toThrow('not an object')
    expect(() => rowOf('meta', { key: 'k', value: true })).toThrow('meta.value')
    expect(rowOf('meta', { key: 'k', value: new Uint8Array([9]) }).value).toEqual(
      new Uint8Array([9]),
    )
  })
})

describe('a change', () => {
  test('is checked whole', () => {
    const good: Change[] = [
      put('files', { hash: 'h', state: 'here' }),
      patch('docs', 'n', { pending: new Uint8Array([1]), pending_at: 5 }),
      remove('files', 'h'),
      { t: 'clear', table: 'outbox', space: 's' },
    ]
    for (const one of good) expect(changeOf(one)).toBe(one)
  })

  test('never changes a key, and always changes something', () => {
    expect(() => patchOf('files', { hash: 'other' })).toThrow('cannot change its hash')
    expect(() => patchOf('files', {})).toThrow('changes nothing')
    expect(() => patchOf('files', { size: 1 })).toThrow('files has no column size')
  })

  test('names a table the store has, and one that fits the change', () => {
    const odd = [
      { t: 'put', table: 'nothing', row: {} },
      { t: 'delete', table: 'log', key: '1' },
      { t: 'clear', table: 'files', space: 's' },
    ] as unknown as Change[]
    for (const one of odd) expect(() => changeOf(one)).toThrow()
  })
})

describe('a question and its answer', () => {
  test('a get answers a row or null, and a scan answers rows', () => {
    expect(answerOf(get('docs', 'n'), doc)).toEqual(doc)
    expect(answerOf(get('docs', 'n'), null)).toBeNull()
    expect(answerOf(scan('docs'), [doc])).toEqual([doc])
    expect(() => answerOf(scan('docs'), doc)).toThrow('did not answer rows')
    expect(() => answerOf(scan('docs'), [{ id: 'n' }])).toThrow('docs.epoch')
  })

  test('a scan by space is only for a table with spaces', () => {
    expect(queryOf(scanSpace('entries', 's'))).toBeTruthy()
    const odd = { t: 'scan', table: 'files', space: 's' } as unknown as Query
    expect(() => queryOf(odd)).toThrow('belong to no space')
    const keyless = { t: 'get', table: 'log', key: '1' } as unknown as Query
    expect(() => queryOf(keyless)).toThrow('no key')
  })

  test('what a store says it opened and counted is checked too', () => {
    const opened = { device: 'd', wasClean: false, schema: 1, recovered: false }
    expect(openedOf(opened)).toEqual(opened)
    expect(() => openedOf({ ...opened, schema: '1' })).toThrow()
    expect(() => openedOf(null)).toThrow()
    expect(countsOf([1, 0], 2)).toEqual([1, 0])
    expect(() => countsOf([1], 2)).toThrow()
    expect(() => countsOf(['1'], 1)).toThrow()
  })
})

test('every table name is one TABLES has', () => {
  const names: TableName[] = [
    'meta',
    'spaces',
    'entries',
    'written',
    'docs',
    'outbox',
    'held',
    'files',
    'web',
    'log',
  ]
  expect(Object.keys(TABLES)).toEqual(names)
})
