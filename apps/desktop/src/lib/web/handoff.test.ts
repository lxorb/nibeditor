import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isEmpty, isHandoff, pack, unpack } from './handoff'

/** The browser build's storage, carried from one origin to another.
 *
 *  Two origins are two factories and two `localStorage`s; which one the module sees
 *  is whichever is the global when it is called. The drive in test/e2e/handoff.py
 *  does the same between two real origins, popup and all. */

interface Origin {
  indexedDB: IDBFactory
  local: Map<string, string>
}

function origin(): Origin {
  return { indexedDB: new IDBFactory(), local: new Map() }
}

function at(place: Origin) {
  vi.stubGlobal('indexedDB', place.indexedDB)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => place.local.get(key) ?? null,
    setItem: (key: string, value: string) => void place.local.set(key, value),
    removeItem: (key: string) => void place.local.delete(key),
    key: (index: number) => [...place.local.keys()][index] ?? null,
    get length() {
      return place.local.size
    },
  })
}

function opened(name: string, version: number, make: (db: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => make(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open'))
  })
}

/** The notes database's shape, as web/store.ts makes it. */
function notesShape(db: IDBDatabase) {
  db.createObjectStore('files', { keyPath: 'path' })
  db.createObjectStore('meta')
  db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }).createIndex(
    'notePath',
    'notePath',
  )
}

function write(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey) {
  return new Promise<void>((resolve, reject) => {
    const writing = db.transaction(store, 'readwrite')
    writing.objectStore(store).put(value, key)
    writing.oncomplete = () => resolve()
    writing.onerror = () => reject(writing.error ?? new Error('write'))
  })
}

function all(db: IDBDatabase, store: string) {
  return new Promise<{ keys: IDBValidKey[]; values: unknown[] }>((resolve, reject) => {
    const reading = db.transaction(store, 'readonly').objectStore(store)
    const keys = reading.getAllKeys()
    const values = reading.getAll()
    values.onsuccess = () => resolve({ keys: keys.result, values: values.result })
    values.onerror = () => reject(values.error ?? new Error('read'))
  })
}

let before: Origin
let now: Origin

beforeEach(() => {
  before = origin()
  now = origin()
})

describe('what the old address holds', () => {
  test('is every database, every store and every key', async () => {
    at(before)
    const db = await opened('nib', 2, notesShape)
    await write(db, 'files', { path: '/Notes/Mine.md', content: 'written in a browser' })
    await write(db, 'meta', 'yes', 'seeded')
    await write(db, 'snapshots', { notePath: '/Notes/Mine.md', content: 'earlier' })
    db.close()
    before.local.set('nib:session', '{"token":"t"}')

    const handoff = await pack()

    expect(isHandoff(handoff)).toBe(true)
    expect(isEmpty(handoff)).toBe(false)
    const notes = handoff.databases.find((one) => one.name === 'nib')
    expect(notes?.version).toBe(2)
    expect(notes?.stores.map((store) => store.name).sort()).toEqual(['files', 'meta', 'snapshots'])
    expect(notes?.stores.find((store) => store.name === 'snapshots')?.indexes).toEqual([
      { name: 'notePath', keyPath: 'notePath', unique: false, multiEntry: false },
    ])
    expect(handoff.local).toEqual([['nib:session', '{"token":"t"}']])
  })

  test('is nothing at an address that was never used, and asking leaves nothing behind', async () => {
    at(before)
    const handoff = await pack()

    expect(isEmpty(handoff)).toBe(true)
    expect(await indexedDB.databases()).toEqual([])
  })
})

describe('the new address, given it', () => {
  test('holds what the old one held, in place of its own welcome note', async () => {
    at(before)
    const old = await opened('nib', 2, notesShape)
    await write(old, 'files', { path: '/Notes/Mine.md', content: 'written in a browser' })
    await write(old, 'meta', 'yes', 'seeded')
    await write(old, 'snapshots', { notePath: '/Notes/Mine.md', content: 'earlier' })
    old.close()
    before.local.set('nib:session', '{"token":"t"}')
    const handoff = await pack()

    at(now)
    // The app is up at the new address, its seed written and the database open.
    const fresh = await opened('nib', 2, notesShape)
    await write(fresh, 'files', { path: '/Notes/Read me.md', content: '# Welcome to Orden' })
    now.local.set('nib:language', 'de')

    await unpack(handoff)

    expect((await all(fresh, 'files')).values).toEqual([
      { path: '/Notes/Mine.md', content: 'written in a browser' },
    ])
    expect(await all(fresh, 'meta')).toEqual({ keys: ['seeded'], values: ['yes'] })
    expect((await all(fresh, 'snapshots')).values).toEqual([
      { id: 1, notePath: '/Notes/Mine.md', content: 'earlier' },
    ])
    fresh.close()
    expect(now.local.get('nib:session')).toBe('{"token":"t"}')
    expect(now.local.get('nib:language')).toBe('de')
  })

  test('makes a database it did not have, stores and indexes as they were', async () => {
    at(before)
    const old = await opened('nib-pictures', 3, (db) => {
      db.createObjectStore('kept', { keyPath: 'id' }).createIndex('by', 'at', { unique: true })
    })
    await write(old, 'kept', { id: 'a', at: 5 })
    old.close()
    const handoff = await pack()

    at(now)
    await unpack(handoff)

    const made = await opened('nib-pictures', 3, () => undefined)
    expect(made.version).toBe(3)
    const index = made.transaction('kept').objectStore('kept').index('by')
    expect(index.unique).toBe(true)
    expect((await all(made, 'kept')).values).toEqual([{ id: 'a', at: 5 }])
    made.close()
  })
})

describe('a message', () => {
  test('is a handoff only when it says so', () => {
    expect(isHandoff({ kind: 'nib-handoff', databases: [], local: [] })).toBe(true)
    expect(isHandoff({ kind: 'something-else', databases: [], local: [] })).toBe(false)
    expect(isHandoff({ kind: 'nib-handoff' })).toBe(false)
    expect(isHandoff('nib-handoff')).toBe(false)
    expect(isHandoff(null)).toBe(false)
  })
})
