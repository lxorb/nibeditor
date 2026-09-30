/** The browser's stand-in for a disk. Notes are rows keyed by path, so the same
 *  path-shaped commands the desktop app sends work unchanged. IndexedDB rather
 *  than localStorage: it holds megabytes, and it can hold images.
 *
 *  A disk can be asked what it holds without being read; a store of rows cannot,
 *  because a row comes back whole and a note's row is the note. Listing a space of
 *  three thousand notes by reading every one of them is six megabytes of strings
 *  built to answer a question about names, and it was the first thing the app did
 *  on the way up. So the listing is kept apart: `stats` is one small row per path,
 *  written with the file and read on its own, which is what makes the file list
 *  cost the names and nothing else. See `tree` in commands.ts.
 *
 *  Keeping two stores in step is the price, and it is paid in one place: every
 *  write below that touches a path touches its stat in the same transaction, so
 *  the two cannot come apart even if the tab is closed mid-write. */

import { breathe } from '../breathe'

const NAME = 'nib'
const VERSION = 2

export interface FileRow {
  path: string
  content: string
  modified: number
  created: number
}

export interface AssetRow {
  path: string
  type: string
  data: string
  modified: number
}

export interface SnapshotRow {
  id?: number
  notePath: string
  content: string
  taken_at: number
  size: number
  /** Who it was kept for when that was not a save; see history.rs. */
  source?: string
}

/** What a file list needs and nothing else: a path and its two times. The same
 *  three fields the desktop's `read_tree` gets out of one `stat`.
 *
 *  And how long the file is, in characters, which is what lets a pass over the
 *  whole space take it a known amount at a time; see `scanLinks` in commands.ts.
 *  Missing from a row written before the listing kept it, until that pass has read
 *  the file and said; see `stats.learn`. Learnt rather than filled in by an upgrade
 *  of the database, because an upgrade waits on every tab still holding the old
 *  version open, and the tab an update leaves behind never lets go of it. */
export interface StatRow {
  path: string
  modified: number
  created: number
  size?: number
}

let open: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  if (open) return open

  open = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' })
      if (!db.objectStoreNames.contains('assets'))
        db.createObjectStore('assets', { keyPath: 'path' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')

      if (!db.objectStoreNames.contains('snapshots')) {
        const store = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        store.createIndex('notePath', 'notePath')
      }

      if (!db.objectStoreNames.contains('stats')) {
        db.createObjectStore('stats', { keyPath: 'path' })
        // A device that already holds notes has its listing read out of them
        // once, here, rather than every launch from now on. The upgrade owns
        // every store, so the walk and the writes are one transaction: either
        // this browser comes up with a listing or it comes up at version 1 and
        // tries again next launch.
        fillStats(request.transaction)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('could not open the database'))
  })

  return open
}

/** The listing, from the rows that were there before there was one. Runs inside
 *  the version change, so it sees both stores and needs no promise of its own. */
function fillStats(change: IDBTransaction | null) {
  if (!change) return

  const stats = change.objectStore('stats')

  for (const name of ['files', 'assets'] as const) {
    const cursor = change.objectStore(name).openCursor()
    cursor.onsuccess = () => {
      const at = cursor.result
      if (!at) return

      const row = at.value as FileRow | AssetRow
      stats.put(statOf(row))
      at.continue()
    }
  }
}

/** A row's listing. An asset has one time rather than two, and a file that was
 *  never told when it was made is as old as its last write. */
function statOf(row: FileRow | AssetRow): StatRow {
  const created = 'created' in row ? row.created : row.modified
  const size = 'content' in row ? row.content.length : row.data.length
  return { path: row.path, modified: row.modified, created, size }
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = action(transaction.objectStore(store))

        request.onsuccess = () => resolve(request.result as T)
        request.onerror = () => reject(request.error ?? new Error(`${store} failed`))
      }),
  )
}

/** Several writes as one, across however many stores they touch. IndexedDB
 *  commits a transaction when the last request in it settles, so the whole batch
 *  has to be queued together: this resolves on the transaction rather than on any
 *  one request, which is what makes "all of it, or none of it" true.
 *
 *  Every write goes through here now that a file and its listing are two rows: a
 *  note written without its stat is a note the file list cannot see. */
function batch(
  stores: readonly string[],
  queue: (transaction: IDBTransaction) => void,
): Promise<void> {
  const named = stores.join(' and ')

  return database().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([...stores], 'readwrite')

        transaction.oncomplete = () => resolve()
        transaction.onabort = () =>
          reject(transaction.error ?? new Error(`${named} was rolled back`))
        transaction.onerror = () => reject(transaction.error ?? new Error(`${named} failed`))

        queue(transaction)
      }),
  )
}

/** Every row of a store, one at a time and in key order, which for files is
 *  path order. What a search reads with: a whole space answers as it is read
 *  rather than after it, and no copy of the space is held to do it. */
function walk(store: string, visit: (row: FileRow) => void): Promise<void> {
  return database().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, 'readonly')
        const request = transaction.objectStore(store).openCursor()

        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return

          visit(cursor.value as FileRow)
          cursor.continue()
        }

        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error(`${store} failed`))
      }),
  )
}

/** One change to the rows, as anything holding a copy of them hears it. */
export interface RowChange {
  /** The rows as they now stand. */
  rows: FileRow[]
  /** The paths that no longer have one. */
  gone: string[]
}

/** Where a change to the rows is called out, so that a thread holding a copy of
 *  them can keep up.
 *
 *  Here rather than at the call sites, because here is the only place a row is
 *  written: every write below is one transaction over the file and its listing, so
 *  a change that is announced from here cannot be a change nobody mentioned. The
 *  search worker is the one listener, and what it does with a change is read that
 *  one note again rather than the space; see space-cache.ts.
 *
 *  A broadcast rather than the worker's own `postMessage`, because the page is not
 *  the only thing that writes: a second tab of the same app writes these rows too,
 *  and a channel reaches both. */
const CHANNEL = 'nib:rows'

let channel: BroadcastChannel | null = null

/** The channel, opened when something first writes or listens, and nothing at all
 *  where the browser has none: a search that reads the store every time is slower,
 *  not wrong. */
function bus(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  return (channel ??= new BroadcastChannel(CHANNEL))
}

function announce(rows: FileRow[], gone: string[]): void {
  bus()?.postMessage({ rows, gone } satisfies RowChange)
}

function isRowChange(value: unknown): value is RowChange {
  if (typeof value !== 'object' || value === null) return false

  const shape = value as { rows?: unknown; gone?: unknown }
  return (
    Array.isArray(shape.rows) &&
    shape.rows.every((row) => typeof (row as FileRow | null)?.path === 'string') &&
    Array.isArray(shape.gone) &&
    shape.gone.every((path) => typeof path === 'string')
  )
}

/** Hears every row written or dropped, wherever it was written. What comes over a
 *  channel is unknown until something has looked, so it is checked here. */
export function watchRows(heard: (change: RowChange) => void): void {
  const listening = bus()
  if (!listening) return

  listening.onmessage = (event: MessageEvent<unknown>) => {
    if (isRowChange(event.data)) heard(event.data)
  }
}

/** How many rows one slice of a whole-store read holds.
 *
 *  `getAll` with nothing narrowing it builds every row inside one callback, and the
 *  listing of five thousand notes is several hundred milliseconds in which nothing
 *  else on the thread runs. On the way up that is the file list appearing and then
 *  the app holding still; the browser blamed `IDBRequest.onsuccess` for the longest
 *  task of every launch, and for one during a pan of a canvas.
 *
 *  Five hundred is a few milliseconds a slice, and eleven slices for a space of five
 *  thousand notes. The rows and the order are exactly what one read gave. */
const SLICE = 500

/** Every row of a store keyed by path, in path order, a slice at a time with the
 *  thread handed back between them.
 *
 *  Separate reads on purpose rather than one cursor: a transaction commits as soon
 *  as the event loop goes quiet, so a walk that breathed inside one would find it
 *  closed underneath. A range starting just past the last key read is where the
 *  next slice begins, which is the same walk of the same tree `between` does.
 *
 *  Exported so store.test.ts can count the slices: what this is for is that no one
 *  task builds the whole listing, and a count says that where a clock says what the
 *  machine was doing at the time. */
export async function inSlices<T>(
  read: (after: string | null, most: number) => Promise<T[]>,
  keyOf: (row: T) => string,
  most: number = SLICE,
): Promise<T[]> {
  const out: T[] = []
  let after: string | null = null

  for (;;) {
    const slice = await read(after, most)
    out.push(...slice)

    const last = slice.at(-1)
    // Short of what was asked for is the end of the store, and so is nothing at
    // all - which is also what an empty store answers the first time.
    if (slice.length < most || last === undefined) return out

    after = keyOf(last)
    await breathe()
  }
}

/** One slice of a store keyed by path: everything after `after`, up to `most`.
 *
 *  The first slice asks with no range at all rather than with a null one, because
 *  "no range" is what it means and null is not a key. */
function slice<T>(store: string, after: string | null, most: number): Promise<T[]> {
  const range = after === null ? undefined : IDBKeyRange.lowerBound(after, true)
  return run<T[]>(store, 'readonly', (one) => one.getAll(range, most))
}

/** Both stores a path can live in, plus the listing they share. */
const WITH_STATS = ['files', 'stats'] as const
const ASSETS_WITH_STATS = ['assets', 'stats'] as const

export const files = {
  get: (path: string) => run<FileRow | undefined>('files', 'readonly', (s) => s.get(path)),
  all: () => run<FileRow[]>('files', 'readonly', (s) => s.getAll()),
  /** Every path, in path order, and not one body. What anything that only has to
   *  know whether a name is taken asks for. */
  paths: () => run<string[]>('files', 'readonly', (s) => s.getAllKeys()),
  each: (visit: (row: FileRow) => void) => walk('files', visit),
  /** Every row from `from` up to and including `to`, in path order.
   *
   *  A stretch of the store rather than a list of paths, because that is what the
   *  store is good at: one walk of the tree between two keys, the way `all` walks
   *  it from end to end. Asking for a few hundred paths one at a time was three
   *  times the work of asking for all of them at once, which is not a saving of
   *  any kind. What this is for is a pass over a whole space that takes it a
   *  stretch at a time and lets go of the thread between them; see `scanLinks` in
   *  commands.ts. */
  between: (from: string, to: string) =>
    run<FileRow[]>('files', 'readonly', (s) => s.getAll(IDBKeyRange.bound(from, to))),
  // Each of the three writes says what it did once it has done it, and not
  // before: a listener that read a row on the strength of an announcement that
  // had not landed yet would read the row as it was.
  put: (row: FileRow) =>
    batch(WITH_STATS, (change) => {
      change.objectStore('files').put(row)
      change.objectStore('stats').put(statOf(row))
    }).then(() => announce([row], [])),
  remove: (path: string) =>
    batch(WITH_STATS, (change) => {
      change.objectStore('files').delete(path)
      change.objectStore('stats').delete(path)
    }).then(() => announce([], [path])),
  /** Writes `rows` and drops `gone`, all or nothing. What a rename is: every
   *  note under the folder lands under its new name at the same moment. */
  move: (rows: FileRow[], gone: string[]) =>
    batch(WITH_STATS, (change) => {
      const store = change.objectStore('files')
      const listing = change.objectStore('stats')

      for (const row of rows) {
        store.put(row)
        listing.put(statOf(row))
      }

      // After the writes, so a path that is both written and dropped - a
      // rename that only changes a folder above it - keeps the new row.
      for (const path of gone) {
        if (rows.some((row) => row.path === path)) continue

        store.delete(path)
        listing.delete(path)
      }
    }).then(() =>
      announce(
        rows,
        gone.filter((path) => !rows.some((row) => row.path === path)),
      ),
    ),
}

export const assets = {
  get: (path: string) => run<AssetRow | undefined>('assets', 'readonly', (s) => s.get(path)),
  all: () => run<AssetRow[]>('assets', 'readonly', (s) => s.getAll()),
  /** Every path, and not one picture. A picture is a data URI in its row, so this
   *  is the difference between listing the papers in a space and loading them. */
  paths: () => run<string[]>('assets', 'readonly', (s) => s.getAllKeys()),
  put: (row: AssetRow) =>
    batch(ASSETS_WITH_STATS, (change) => {
      change.objectStore('assets').put(row)
      change.objectStore('stats').put(statOf(row))
    }),
  remove: (path: string) =>
    batch(ASSETS_WITH_STATS, (change) => {
      change.objectStore('assets').delete(path)
      change.objectStore('stats').delete(path)
    }),
}

/** The listing: one row per path, whichever store the file itself is in. Read as
 *  a whole, because that is the one question it exists to answer - and in slices,
 *  because on the way up it is the one question that holds everything else; see
 *  `inSlices`. */
export const stats = {
  all: () =>
    inSlices<StatRow>(
      (after, most) => slice<StatRow>('stats', after, most),
      (row) => row.path,
    ),
  /** Sizes a pass over the files found out, written into the rows that did not
   *  have one. Only into a row still describing the file that was read - the same
   *  modified time - since a file written meanwhile has written its own. */
  learn: (found: readonly { path: string; modified: number; size: number }[]) =>
    batch(['stats'], (change) => {
      const listing = change.objectStore('stats')

      for (const one of found) {
        const asked = listing.get(one.path)
        asked.onsuccess = () => {
          const row = asked.result as StatRow | undefined
          if (row?.size === undefined && row?.modified === one.modified) {
            listing.put({ ...row, size: one.size })
          }
        }
      }
    }),
}

export const meta = {
  get: (key: string) => run<string | undefined>('meta', 'readonly', (s) => s.get(key)),
  put: (key: string, value: string) =>
    run<IDBValidKey>('meta', 'readwrite', (s) => s.put(value, key)),
  remove: (key: string) => run<undefined>('meta', 'readwrite', (s) => s.delete(key)),
  /** Every key, in key order. What the installed themes are listed from: they
   *  live here under a shared prefix, the way they live in a folder on a
   *  desktop. */
  keys: () => run<IDBValidKey[]>('meta', 'readonly', (s) => s.getAllKeys()),
}

export const snapshots = {
  put: (row: SnapshotRow) => run<IDBValidKey>('snapshots', 'readwrite', (s) => s.put(row)),
  remove: (id: number) => run<undefined>('snapshots', 'readwrite', (s) => s.delete(id)),
  forNote: (notePath: string) =>
    run<SnapshotRow[]>('snapshots', 'readonly', (s) => s.index('notePath').getAll(notePath)),
  /** Every note's versions at once, which is what the retention sweep walks. */
  all: () => run<SnapshotRow[]>('snapshots', 'readonly', (s) => s.getAll()),
}

/** Folders have no rows of their own - a folder exists because something is in
 *  it. This is the marker that keeps an empty one alive. */
export const KEEP = '.keep'
