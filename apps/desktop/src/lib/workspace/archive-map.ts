/** How one space's archive meets the account's copy, and goes up to it.
 *
 *  Entry by entry, the later moment winning, on every listing rather than only the
 *  first: so two machines archiving different notes at once both keep theirs, a restore
 *  made on one is not undone by a copy the other sent before it heard, and a write that
 *  raced another is healed by the next listing, which folds the difference back in and
 *  sends it up. The whole map still goes up in one request, the way every column a
 *  space keeps does; this is the per-entry shape docs/sync-v2.md plans for all of them.
 *
 *  Fetched with the account, like arranging.ts: a window that never signs in never
 *  reads it. See archive.svelte.ts for the map itself. */

import { insideItsSpace } from '../space-paths'
import { type Archive, type ArchiveMap, archiveMap, MOST_ARCHIVED } from './archive.svelte'

/** A moment later than `held`, so a change beats what it changed whatever the clock. */
export function stampAfter(held: number | undefined, now: number): number {
  return Math.max(now, Math.abs(held ?? 0) + 1)
}

/** A map with some paths archived and others taken back, each at a moment later than
 *  the one it replaces, or null where that changes nothing. */
export function changed(
  map: ArchiveMap,
  archive: readonly string[],
  restore: readonly string[],
  now: number,
): ArchiveMap | null {
  const put = archive.filter((path) => insideItsSpace(path))
  const back = restore.filter((path) => (map[path] ?? 0) > 0)
  if (!put.length && !back.length) return null

  const next = { ...map }
  for (const path of put) next[path] = stampAfter(next[path], now)
  for (const path of back) next[path] = -stampAfter(next[path], now)
  return next
}

/** How long a restore is remembered. Long enough for every machine that was asleep to
 *  hear it; one away for longer may put the row away again, which loses nothing. */
export const REMEMBERED = 30 * 24 * 60 * 60 * 1000

/** The map without restores older than `REMEMBERED`, and cut to `MOST_ARCHIVED` with
 *  the oldest restores going first. */
export function trimmed(map: ArchiveMap, now: number): ArchiveMap {
  const entries = Object.entries(map).filter(([, when]) => when > 0 || now + when < REMEMBERED)
  if (entries.length > MOST_ARCHIVED) {
    entries.sort(
      ([, one], [, other]) =>
        Number(one > 0) - Number(other > 0) || Math.abs(one) - Math.abs(other),
    )
    entries.splice(0, entries.length - MOST_ARCHIVED)
  }

  return entries.length === Object.keys(map).length ? map : Object.fromEntries(entries)
}

/** Two maps as one: every path each knows, at the later of its two moments. An exact
 *  tie keeps the row archived, the answer that hides nothing for good. */
export function merged(theirs: ArchiveMap, mine: ArchiveMap, now: number): ArchiveMap {
  const out: ArchiveMap = { ...theirs }
  for (const [path, when] of Object.entries(mine)) {
    const other = out[path]
    const later = other === undefined || Math.abs(when) > Math.abs(other)
    if (later || (Math.abs(when) === Math.abs(other) && when > other)) out[path] = when
  }

  return trimmed(archiveMap(out), now)
}

export function sameMap(one: ArchiveMap, other: ArchiveMap): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}

/** The account's copy of a space's archive met with this machine's: kept here when it
 *  changed anything, and sent back up when the account was behind. Read rather than
 *  trusted, since the service is deployed on its own and an older one sends nothing. */
export function fold(store: Archive, root: string, theirs: unknown, accountId: string) {
  const account = archiveMap(theirs)
  const mine = store.of(root)
  const met = merged(account, mine, Date.now())

  if (!sameMap(met, mine) || store.account(root) !== accountId) {
    store.put(root, sameMap(met, mine) ? mine : met, accountId)
  }
  if (!sameMap(met, account)) store.soon(root)
}

/** The map as it stands, sent up so every other machine hides the same rows. */
export async function send(store: Archive, root: string) {
  const { push } = await import('./pushing')
  await push(root, (api, token, spaceId) =>
    api.saveArchived(token, spaceId, trimmed(store.of(root), Date.now())),
  )
}
