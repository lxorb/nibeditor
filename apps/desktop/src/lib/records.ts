/** Plain objects used as maps: icons by folder, keys by shortcut id, mirrors by
 *  space root.
 *
 *  `delete record[key]` is the obvious way to drop an entry and the wrong one
 *  for most of these. Several are reactive state, and Svelte follows a
 *  reassignment rather than a mutation of what is already there; the rest are
 *  written straight back to storage, where a fresh object is no more work than
 *  a changed one. So an entry goes by building the map again without it.
 *
 *  And the maps the per-space stores keep - folder icons, arranged orders, graph
 *  settings, exclusions, bookmarks - one value per space root beside the account it
 *  was folded into, read back and met with the account's copy the same way; see
 *  `readSpaces` and `meet`. */

import { isRecord, isString, stored } from './stored'

export function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([one]) => one !== key))
}

/** `record` with every entry of `from` it has no key for, or null when there is
 *  none. What a store that read its storage too early does once the storage has
 *  answered - the plugin's is seeded seconds after the page was built; see
 *  lib/even/local.ts. Filled in, never replaced: what is here was written this
 *  launch and is newer than anything storage is only now getting round to
 *  mentioning. */
export function filledIn<T>(
  record: Record<string, T>,
  from: Record<string, T>,
): Record<string, T> | null {
  const missing = Object.entries(from).filter(([key]) => record[key] === undefined)
  return missing.length ? { ...record, ...Object.fromEntries(missing) } : null
}

/** `record` with `key` set, or with it dropped when the value is null. Both
 *  halves of "an icon, or no icon" in one place, since every caller wants
 *  exactly that pair. */
export function withOrWithout<T>(
  record: Record<string, T>,
  key: string,
  value: T | null,
): Record<string, T> {
  return value === null ? without(record, key) : { ...record, [key]: value }
}

/** The account a space's value has been folded into, or null while there was none.
 *  A different account signing in on this machine merges again; the same one signing
 *  in twice does not, or what it took back on another machine would be handed
 *  straight back to it. */
export interface Folded {
  account: string | null
}

/** Every space's entry under `key`, its value read by `own`. An entry that is not a
 *  record at all is dropped, and `own` keeps what reads in the rest, the way every
 *  store here reads what a newer build, an older one or a hand wrote. */
export function readSpaces<T>(
  key: string,
  own: (one: Record<string, unknown>) => T,
): Record<string, T & Folded> {
  const saved = stored(key)
  if (!isRecord(saved)) return {}

  const out: Record<string, T & Folded> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = { ...own(one), account: isString(one.account) ? one.account : null }
  }

  return out
}

/** How one store's values meet: `fold` puts this machine's into the account's, and
 *  `same` says whether two say the same thing. */
export interface Folding<T> {
  fold: (theirs: T, mine: T) => T
  same: (one: T, other: T) => boolean
}

/** The account's copy of one space's value meeting this machine's: the value to
 *  keep and whether the account should be told it, or null where nothing changes.
 *
 *  The first time an account sees the space this machine's value is folded in, and
 *  sent back up where that added anything. After that the account's copy is taken
 *  outright, because a fold on every pass would hand back what another machine had
 *  deliberately taken away. A store that writes down whether its last push landed
 *  also folds while `sent` is false: the account cannot be the one copy of a choice
 *  it never heard. */
export function meet<T>(
  held: (Folded & { sent?: boolean }) | undefined,
  accountId: string,
  mine: T,
  theirs: T,
  { fold, same }: Folding<T>,
): { value: T; tell: boolean } | null {
  const ours = held?.account !== accountId || held.sent === false
  const value = ours ? fold(theirs, mine) : theirs

  if (held && !ours && same(mine, value)) return null

  return { value, tell: ours && !same(value, theirs) }
}
