/** Plain objects used as maps: icons by folder, keys by shortcut id, mirrors by
 *  space root.
 *
 *  `delete record[key]` is the obvious way to drop an entry and the wrong one
 *  for most of these. Several are reactive state, and Svelte follows a
 *  reassignment rather than a mutation of what is already there; the rest are
 *  written straight back to storage, where a fresh object is no more work than
 *  a changed one. So an entry goes by building the map again without it. */

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
