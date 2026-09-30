/** The sync store in a browser: the same tables as the SQLite store (section 9.2 of
 *  docs/sync-v2.md), one IndexedDB object store each, one database per account, and the
 *  same answers to the same questions. Fetched only by `openSyncStore` in sync2/store.ts,
 *  and only in the browser build.
 *
 *  Two things differ from the crate's store, and neither shows through the interface.
 *  What nib last wrote is kept as text rather than compressed: the browser's own store
 *  already compresses what it keeps, and compressing here would be an await inside a
 *  transaction, which IndexedDB answers by committing it. And there is no damaged file
 *  to set aside: a browser that cannot open its store says so, and signing out and in
 *  again makes a new one.
 *
 *  A browser can have the app open in several tabs, and one engine per browser is the
 *  rule, not one per tab: `leadSync` is the election, over the Web Locks API, the same
 *  thing that keeps two tabs of one site from both being the one that syncs. Every tab
 *  may read the store; only the leader writes it. See `web/store.ts` for the pattern
 *  every write here follows: one transaction per batch, resolved on the transaction
 *  rather than on any one request. */

import {
  answerOf,
  changeOf,
  LOG_ROWS,
  patchOf,
  queryOf,
  rowOf,
  StoreError,
  TABLES,
  type Answers,
  type Change,
  type Opened,
  type Query,
  type SyncStore,
  type TableName,
} from '../sync2/store'

/** The schema this build makes, which is the SQLite store's schema number too. */
const SCHEMA = 1

/** Every table's name, in the order TABLES lists them. */
const NAMES = Object.keys(TABLES) as TableName[]

/** The index every table with spaces keeps them under, and the one the outbox keeps its
 *  age under, which is the order a scan of it answers in. */
const BY_SPACE = 'space'
const BY_AGE = 'age'

/** One database per account, so signing out is one delete and two accounts on one
 *  browser never see each other's rows. */
const nameOf = (account: string) => `nib-sync:${account}`

/** Opens an account's store, making it the first time. */
export async function openWeb(account: string): Promise<SyncStore> {
  const db = await database(account)
  // A second tab signing out deletes the database; this tab lets go of it rather than
  // holding the delete up until it is closed.
  db.onversionchange = () => db.close()

  const opened = await started(db)
  return {
    opened,
    read: <const Q extends readonly Query[]>(queries: Q) => answered(db, queries),
    write: (changes) => written(db, changes),
    cleanExit: (clean) =>
      settled(db, ['meta'], (tx) => {
        tx.objectStore('meta').put({ key: 'clean_exit', value: clean ? 1 : 0 })
      }),
    close: () => {
      db.close()
      return Promise.resolve()
    },
  }
}

/** Deletes an account's store. */
export function forgetWeb(account: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(nameOf(account))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new StoreError('the sync store stayed'))
  })
}

function database(account: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(nameOf(account), SCHEMA)
    request.onupgradeneeded = () => made(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new StoreError('the sync store would not open'))
    request.onblocked = () => reject(new StoreError('another tab holds an older sync store open'))
  })
}

/** Schema 1: every table an object store keyed as the SQL keys it. The log has no key
 *  of its own, so its rows are numbered in the order they arrive, which is SQLite's
 *  `rowid` order too. */
function made(db: IDBDatabase): void {
  for (const name of NAMES) {
    const spec = TABLES[name]
    const store =
      spec.key === null
        ? db.createObjectStore(name, { autoIncrement: true })
        : db.createObjectStore(name, { keyPath: spec.key })
    if (name === 'outbox') {
      // Oldest first, and op id among equals: the SQL's `order by made_at, op_id`.
      store.createIndex(BY_SPACE, ['space_id', 'made_at'])
      store.createIndex(BY_AGE, 'made_at')
    } else if (spec.space !== null) {
      store.createIndex(BY_SPACE, spec.space)
    }
  }
}

/** Reads the device id and the last session's word on how it ended, and marks this one
 *  as not ended yet, in one transaction. */
function started(db: IDBDatabase): Promise<Opened> {
  const found: { device?: unknown; clean?: unknown } = {}
  let device = ''

  return settled(db, ['meta'], (tx) => {
    const meta = tx.objectStore('meta')
    const asked = meta.get('device')
    asked.onsuccess = () => {
      found.device = (asked.result as { value?: unknown } | undefined)?.value
      device = typeof found.device === 'string' ? found.device : crypto.randomUUID()
      if (device !== found.device) meta.put({ key: 'device', value: device })
    }
    const clean = meta.get('clean_exit')
    clean.onsuccess = () => {
      found.clean = (clean.result as { value?: unknown } | undefined)?.value
      meta.put({ key: 'clean_exit', value: 0 })
    }
    meta.put({ key: 'schema', value: SCHEMA })
  }).then(() => ({
    device,
    // A store that never said is a new one, with nothing a rotation could protect.
    wasClean: found.clean !== 0,
    schema: SCHEMA,
    recovered: false,
  }))
}

/** Every question answered from one read transaction, which is one snapshot. */
async function answered<const Q extends readonly Query[]>(
  db: IDBDatabase,
  queries: Q,
): Promise<Answers<Q>> {
  for (const query of queries) queryOf(query)
  if (queries.length === 0) return [] as Answers<Q>

  const raw: unknown[] = []
  const tables = [...new Set(queries.map((query) => query.table))]
  await settled(
    db,
    tables,
    (tx) => {
      queries.forEach((query, at) => {
        const store = tx.objectStore(query.table)
        const request =
          query.t === 'get'
            ? store.get(query.key)
            : query.space !== undefined
              ? spaceIndexRead(store, query.table, query.space)
              : query.table === 'outbox'
                ? store.index(BY_AGE).getAll()
                : store.getAll()
        request.onsuccess = () => {
          raw[at] = request.result
        }
      })
    },
    'readonly',
  )

  // Checked answer by answer, against the question each answers.
  return queries.map((query, at) => answerOf(query, raw[at] ?? null)) as Answers<Q>
}

/** A space's rows, in the table's order. */
function spaceIndexRead(store: IDBObjectStore, table: TableName, space: string): IDBRequest {
  const index = store.index(BY_SPACE)
  if (table !== 'outbox') return index.getAll(space)
  return index.getAll(IDBKeyRange.bound([space, -Infinity], [space, Infinity]))
}

/** Every change applied in one transaction. Every change is checked before the
 *  transaction starts, so a refusal writes nothing at all; a failure inside it aborts
 *  it, which writes nothing either. */
async function written(db: IDBDatabase, changes: readonly Change[]): Promise<number[]> {
  const checked = changes.map((change) => changeOf(change))
  if (checked.length === 0) return []

  const counts = checked.map(() => 0)
  const tables = [...new Set(checked.map((change) => change.table))]
  let logged = false

  await settled(db, tables, (tx) => {
    checked.forEach((change, at) => {
      const store = tx.objectStore(change.table)
      switch (change.t) {
        case 'put': {
          store.put(rowOf(change.table, change.row))
          counts[at] = 1
          logged ||= change.table === 'log'
          return
        }
        case 'patch': {
          const set = patchOf(change.table, change.set)
          const found = store.get(change.key)
          found.onsuccess = () => {
            const row: unknown = found.result
            if (typeof row !== 'object' || row === null) return
            store.put({ ...row, ...set })
            counts[at] = 1
          }
          return
        }
        case 'delete': {
          const there = store.count(change.key)
          there.onsuccess = () => {
            counts[at] = there.result
          }
          store.delete(change.key)
          return
        }
        case 'clear': {
          const keys = spaceKeys(store, change.table, change.space)
          keys.onsuccess = () => {
            counts[at] = keys.result.length
            for (const key of keys.result) store.delete(key)
          }
          return
        }
      }
    })
    if (logged) trim(tx.objectStore('log'))
  })

  return counts
}

function spaceKeys(
  store: IDBObjectStore,
  table: TableName,
  space: string,
): IDBRequest<IDBValidKey[]> {
  const index = store.index(BY_SPACE)
  if (table !== 'outbox') return index.getAllKeys(space)
  return index.getAllKeys(IDBKeyRange.bound([space, -Infinity], [space, Infinity]))
}

/** The log down to its newest `LOG_ROWS`, in the transaction that grew it. */
function trim(log: IDBObjectStore): void {
  const counted = log.count()
  counted.onsuccess = () => {
    let over = counted.result - LOG_ROWS
    if (over <= 0) return
    const walking = log.openCursor()
    walking.onsuccess = () => {
      const cursor = walking.result
      if (!cursor || over <= 0) return
      cursor.delete()
      over -= 1
      cursor.continue()
    }
  }
}

/** Runs `queue` in one transaction over `tables` and resolves when the transaction
 *  commits, which is when all of it is written or, on an abort, none of it. */
function settled(
  db: IDBDatabase,
  tables: readonly string[],
  queue: (tx: IDBTransaction) => void,
  mode: IDBTransactionMode = 'readwrite',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...tables], mode)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new StoreError('the sync store rolled a batch back'))
    tx.onerror = () => reject(tx.error ?? new StoreError('the sync store failed'))
    try {
      queue(tx)
    } catch (error) {
      tx.abort()
      reject(error instanceof Error ? error : new StoreError(String(error)))
    }
  })
}

// ---------------------------------------------------------------------------
// One engine per browser

/** The lock every tab of the app asks for; the one holding it runs the engine. */
const LEADER = 'nib-sync'

/** Being the tab that syncs, and the way to stop being it. */
export interface Leadership {
  release(): void
}

/** Waits until this tab is the one that syncs, and answers how to stop being it; null
 *  when `signal` gave up first.
 *
 *  A Web Lock is held until the tab closes, crashes or lets go, and the browser hands it
 *  to the next tab waiting at once, so the engine moves to another tab the moment the
 *  leader's goes and never runs in two. A browser without Web Locks (they need a secure
 *  context, and every browser nib supports has had them since 2022) leads at once: a
 *  second tab there is a second engine, the rows are the same rows, and every write is a
 *  transaction, so it costs work rather than words. */
export function leadSync(signal?: AbortSignal): Promise<Leadership | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (!locks) return Promise.resolve({ release: () => undefined })

  return new Promise((resolve) => {
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => {
      release = done
    })

    const options: LockOptions = signal ? { signal } : {}
    locks
      .request(LEADER, options, () => {
        resolve({ release })
        return held
      })
      .catch(() => {
        // The only way the request rejects is the signal giving up before the lock was
        // granted, which is the null this answers.
        resolve(null)
      })
  })
}
