/** The browser build's notes, taken from the old address to the new one.
 *
 *  A browser keeps a site's storage per origin. The web build at nibeditor.com
 *  keeps notes that were never synced in that origin's IndexedDB and the session in
 *  its `localStorage`, and orden.so cannot read either. Once nibeditor.com sends
 *  pages on to orden.so, somebody who only ever wrote in the browser would arrive at
 *  an empty app. So the new address asks the old one, the one way a browser allows:
 *
 *  1. orden.so opens `nibeditor.com/handoff` as a popup, on a press. A popup is a
 *     top-level page, so it reads the old origin's own storage; a frame would be
 *     handed a partitioned, empty one.
 *  2. That page reads every database and every key (`pack`) and posts them to its
 *     opener, addressed to orden.so and nothing else, then closes. A page that
 *     opened it from anywhere else is not delivered a thing.
 *  3. orden.so takes the message only from that popup and from the old origin, and
 *     only while it holds nothing of anybody's - a first visit, nobody signed in -
 *     writes it into its own storage (`unpack`) and starts again from it. The
 *     session comes with it, so the person is signed in as they were.
 *
 *  Both addresses are build settings so a drive can play both parts on two local
 *  origins; see test/e2e/handoff.py. */

import { keep, storedText } from '../stored'

/** Where the browser build lives now, and where it lived before the rename. */
export const WEB: string = import.meta.env.VITE_NIB_WEB ?? 'https://orden.so'
export const LEGACY_WEB: string = import.meta.env.VITE_NIB_LEGACY_WEB ?? 'https://nibeditor.com'

/** The old address's page that hands its storage over: `handoff.html`. */
export const HANDOFF_PATH = '/handoff'

const KIND = 'nib-handoff'

/** The databases worth asking for when a browser cannot list them: the notes. */
const KNOWN = ['nib']

interface IndexShape {
  name: string
  keyPath: string | string[]
  unique: boolean
  multiEntry: boolean
}

interface StoreDump {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: IndexShape[]
  keys: IDBValidKey[]
  values: unknown[]
}

interface DatabaseDump {
  name: string
  version: number
  stores: StoreDump[]
}

/** Everything one origin held, as the message carries it. Structured-cloned, so a
 *  row holding a blob or a date arrives as one. */
export interface Handoff {
  kind: typeof KIND
  databases: DatabaseDump[]
  local: [string, string][]
}

export function isHandoff(value: unknown): value is Handoff {
  if (typeof value !== 'object' || value === null) return false
  const said = value as Partial<Handoff>
  return said.kind === KIND && Array.isArray(said.databases) && Array.isArray(said.local)
}

/** Whether there was nothing at the old address at all. */
export function isEmpty(handoff: Handoff): boolean {
  return (
    handoff.local.length === 0 &&
    handoff.databases.every((database) => database.stores.every((store) => store.keys.length === 0))
  )
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the database refused'))
  })
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('the write failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('the write was abandoned'))
  })
}

/** The databases this origin has, by name and version. None for a browser that
 *  cannot list them (Firefox before 126), which is asked for `KNOWN` instead. */
async function listed(): Promise<{ name: string; version: number }[]> {
  if (!('databases' in indexedDB)) return []
  const listing = await indexedDB.databases().catch(() => null)
  if (!listing) return []
  return listing.flatMap((one) =>
    typeof one.name === 'string' && typeof one.version === 'number'
      ? [{ name: one.name, version: one.version }]
      : [],
  )
}

/** An existing database, opened as it is; null when there is none by that name.
 *  Opening one that is not there would make it, so the making is called off. */
function existing(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function dump(name: string): Promise<DatabaseDump | null> {
  const db = await existing(name)
  if (!db) return null

  try {
    const names = [...db.objectStoreNames]
    if (names.length === 0) return { name, version: db.version, stores: [] }

    const reading = db.transaction(names, 'readonly')
    const stores = await Promise.all(
      names.map(async (storeName) => {
        const store = reading.objectStore(storeName)
        const indexes = [...store.indexNames].map((indexName) => {
          const index = store.index(indexName)
          return {
            name: indexName,
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry,
          }
        })
        // Both in key order, so the nth key is the nth value's.
        const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())])
        return {
          name: storeName,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes,
          keys,
          values,
        }
      }),
    )
    return { name, version: db.version, stores }
  } finally {
    db.close()
  }
}

/** Everything this origin holds: every database, every store in it, every key in
 *  `localStorage`. */
export async function pack(): Promise<Handoff> {
  const names = (await listed()).map((one) => one.name)
  const databases: DatabaseDump[] = []
  for (const name of names.length > 0 ? names : KNOWN) {
    const one = await dump(name)
    if (one) databases.push(one)
  }

  const local: [string, string][] = []
  for (let at = 0; at < localStorage.length; at++) {
    const key = localStorage.key(at)
    const value = key === null ? null : storedText(key)
    if (key !== null && value !== null) local.push([key, value])
  }

  return { kind: KIND, databases, local }
}

/** One database, as it was at the old address: the stores it had, made if they
 *  are missing, and each emptied and filled with the rows the old one held. */
function restore(database: DatabaseDump, version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database.name, version)

    request.onupgradeneeded = () => {
      const db = request.result
      const change = request.transaction
      for (const shape of database.stores) {
        const store = db.objectStoreNames.contains(shape.name)
          ? change?.objectStore(shape.name)
          : db.createObjectStore(shape.name, {
              keyPath: shape.keyPath,
              autoIncrement: shape.autoIncrement,
            })
        for (const index of shape.indexes) {
          if (store && !store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, {
              unique: index.unique,
              multiEntry: index.multiEntry,
            })
          }
        }
      }
    }

    // A tab still holding the database at an older version keeps the upgrade from
    // happening at all; better to say so than to wait for ever.
    request.onblocked = () => reject(new Error('another tab holds the notes open'))
    request.onerror = () => reject(request.error ?? new Error('the database refused'))

    request.onsuccess = () => {
      const db = request.result
      const names = database.stores
        .map((store) => store.name)
        .filter((name) => db.objectStoreNames.contains(name))
      if (names.length === 0) {
        db.close()
        resolve()
        return
      }

      const writing = db.transaction(names, 'readwrite')
      for (const shape of database.stores) {
        if (!names.includes(shape.name)) continue
        const store = writing.objectStore(shape.name)
        store.clear()
        shape.values.forEach((value, at) => {
          if (shape.keyPath === null) store.put(value, shape.keys[at])
          else store.put(value)
        })
      }
      finished(writing)
        .then(resolve, reject)
        .finally(() => db.close())
    }
  })
}

/** What the old address held, written into this one's storage. Called only while
 *  this origin holds nothing of anybody's, which is what makes emptying a store
 *  before filling it safe: what it held was the welcome note of this visit. */
export async function unpack(handoff: Handoff): Promise<void> {
  const versions = new Map((await listed()).map((one) => [one.name, one.version]))
  for (const database of handoff.databases) {
    await restore(database, Math.max(database.version, versions.get(database.name) ?? 1))
  }
  for (const [key, value] of handoff.local) {
    if (!keep(key, value)) throw new Error('this browser keeps no more site data')
  }
}
