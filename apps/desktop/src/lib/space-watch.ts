/** The space folders as the crate watches and lists them (src-tauri/src/space_watch.rs),
 *  typed and checked: what the sync engine reads foreign edits, renames and deletes out
 *  of. Inside the app only; a browser has no folders to watch.
 *
 *  Every path is spelled the way the root was handed over, so it joins and compares with
 *  the paths the rest of the app holds. `id` is a file's identity: the same through a
 *  rename or a move to another folder, different for a file deleted and made again, and
 *  opaque, so the only thing to do with two of them is compare them. */

import { Channel, invoke } from './native'

/** One file or folder. */
export interface Listed {
  path: string
  dir: boolean
  /** Bytes; 0 for a folder. */
  size: number
  /** Milliseconds since the epoch. */
  mtime: number
  id: string | null
}

/** One answer about one path. A folder that arrives brings a `created` for everything
 *  in it; a folder renamed or removed is one answer for everything in it. A path that
 *  holds a file before and after is `modified`, even when the file was replaced, which
 *  is how every editor saves. */
export type SpaceChange =
  | ({ kind: 'created' | 'modified' } & Listed)
  | { kind: 'removed'; path: string; dir: boolean; id: string | null }
  | ({ kind: 'renamed'; from: string } & Listed)

/** What happened in one space since the last message. */
export interface SpaceNews {
  root: string
  changes: SpaceChange[]
  /** The watch knows this space afresh: list it with `scanSpace` to catch up. Said once
   *  for every space as the watch starts, and again whenever the watcher lost events. */
  scan: boolean
  /** The folder is not there any more and is no longer watched. Never a reason to
   *  delete anything: a space renamed in Explorer is gone from here too. */
  gone: boolean
}

/** Watches `roots` (spaces, by their folders) and hands every message to `heard`,
 *  replacing whatever watch was running. Resolves once the watch is armed. */
export function watchSpaces(
  roots: readonly string[],
  heard: (news: SpaceNews) => void,
): Promise<void> {
  const news = new Channel<unknown>()
  news.onmessage = (message) => {
    const checked = newsOf(message)
    if (checked) heard(checked)
    else console.error('the space watcher said something odd', message)
  }
  return invoke('space_watch', { roots, news })
}

export function unwatchSpaces(): Promise<void> {
  return invoke('space_unwatch')
}

/** Everything in a space, each folder before what is in it. `each` hears the listing a
 *  chunk at a time as it arrives. */
export function scanSpace(root: string, each?: (chunk: Listed[]) => void): Promise<Listed[]> {
  return new Promise((resolve, reject) => {
    const all: Listed[] = []
    const listing = new Channel<unknown>()
    listing.onmessage = (message) => {
      const chunk = listingOf(message)
      if (!chunk) {
        reject(new Error('the space listing said something odd'))
        return
      }
      all.push(...chunk.listed)
      each?.(chunk.listed)
      if (chunk.done) resolve(all)
    }
    invoke('space_scan', { root, listing }).catch(reject)
  })
}

/** The identity of the file or folder at `path` in a space, or null when nothing is
 *  there. */
export async function fileIdentity(path: string): Promise<string | null> {
  const id: unknown = await invoke('file_identity', { path })
  return typeof id === 'string' ? id : null
}

// ---------------------------------------------------------------------------
// Checks

type Loose = Record<string, unknown>

const record = (value: unknown): value is Loose => typeof value === 'object' && value !== null

const whole = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

const identity = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

function listedOf(value: unknown): Listed | null {
  if (!record(value)) return null
  const { path, dir, size, mtime, id } = value
  if (typeof path !== 'string' || typeof dir !== 'boolean' || !whole(size) || !whole(mtime)) {
    return null
  }
  if (!identity(id)) return null
  return { path, dir, size, mtime, id }
}

function changeOf(value: unknown): SpaceChange | null {
  if (!record(value)) return null
  switch (value.kind) {
    case 'created':
    case 'modified': {
      const listed = listedOf(value)
      return listed && { kind: value.kind, ...listed }
    }
    case 'renamed': {
      const listed = listedOf(value)
      return listed && typeof value.from === 'string'
        ? { kind: 'renamed', from: value.from, ...listed }
        : null
    }
    case 'removed': {
      const { path, dir, id } = value
      return typeof path === 'string' && typeof dir === 'boolean' && identity(id)
        ? { kind: 'removed', path, dir, id }
        : null
    }
    default:
      return null
  }
}

/** A watcher message, checked, or null. */
export function newsOf(value: unknown): SpaceNews | null {
  if (!record(value)) return null
  const { root, changes, scan, gone } = value
  if (typeof root !== 'string' || !Array.isArray(changes)) return null
  if (typeof scan !== 'boolean' || typeof gone !== 'boolean') return null
  const checked = changes.map(changeOf)
  if (checked.some((one) => one === null)) return null
  return { root, changes: checked as SpaceChange[], scan, gone }
}

/** A chunk of a listing, checked, or null. */
export function listingOf(value: unknown): { listed: Listed[]; done: boolean } | null {
  if (!record(value) || !Array.isArray(value.listed) || typeof value.done !== 'boolean') {
    return null
  }
  const listed = value.listed.map(listedOf)
  if (listed.some((one) => one === null)) return null
  return { listed: listed as Listed[], done: value.done }
}
