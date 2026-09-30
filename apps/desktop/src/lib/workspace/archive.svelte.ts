/** What each space has put away. Nothing moves and nothing is written into the file,
 *  so an archived row keeps its path, bytes and modified time and comes back exactly
 *  where it was; a map beside the space says it instead, as Gmail, Keep and Bear keep
 *  theirs. A path as the space speaks it, to a moment: positive while archived,
 *  negative once taken back, so a synced restore is not mistaken for a path nobody
 *  archived. A folder stands for everything under it. See archive-map.ts for how two
 *  copies meet, and docs/archive.md. */

import { insideItsSpace, movedTo, relativeTo, within } from '../space-paths'
import { isNumber, isRecord, keep } from '../stored'
import { filledIn, type Folded, readSpaces, without } from '../records'

export const STORAGE_KEY = 'nib:archived'

/** Moments per path: positive while archived, negative once taken back. */
export type ArchiveMap = Record<string, number>

/** Entries per map, restores included; the service's number too. */
export const MOST_ARCHIVED = 1000

/** The map in an unknown, with whatever is not a path and a moment left out. */
export function archiveMap(value: unknown): ArchiveMap {
  if (!isRecord(value)) return {}

  const kept: [string, number][] = []
  for (const [path, when] of Object.entries(value)) {
    if (kept.length >= MOST_ARCHIVED) break
    if (insideItsSpace(path) && isNumber(when) && Number.isSafeInteger(when) && when !== 0) {
      kept.push([path, when])
    }
  }

  // Gathered and then made into a map: a folder may be called `__proto__`.
  return Object.fromEntries(kept)
}

/** The archived path hiding `at`: itself, or the innermost folder above it. */
export function coveredBy(keys: ReadonlySet<string>, at: string): string | null {
  if (!keys.size) return null

  for (let path = at; ;) {
    if (keys.has(path)) return path
    const cut = path.lastIndexOf('/')
    if (cut === -1) return null
    path = path.slice(0, cut)
  }
}

function under(path: string, key: string, root: string): boolean {
  return !!key && within(key, path, root) !== null
}

interface Kept extends Folded {
  map: ArchiveMap
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({ map: archiveMap(one.map) }))
}

const EMPTY: ArchiveMap = {}

export class Archive {
  /** Raw: a change replaces a map whole, and deep would be a signal per path. */
  private spaces = $state.raw<Record<string, Kept>>(read())
  private live = new WeakMap<ArchiveMap, ReadonlySet<string>>()
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}

  constructor(private readonly root: () => string | null) {}

  /** Once the plugin's storage has answered; see even/local.ts. */
  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  of(root: string): ArchiveMap {
    return this.spaces[root]?.map ?? EMPTY
  }

  account(root: string): string | null {
    return this.spaces[root]?.account ?? null
  }

  /** The paths a space has archived, as the space speaks of them. */
  keysOf(root: string): ReadonlySet<string> {
    const map = this.of(root)
    let keys = this.live.get(map)
    if (!keys) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one map's snapshot, replaced with the map
      keys = new Set(Object.keys(map).filter((path) => (map[path] ?? 0) > 0))
      this.live.set(map, keys)
    }

    return keys
  }

  get any(): boolean {
    const root = this.root()
    return root !== null && this.keysOf(root).size > 0
  }

  /** Either spelling of a path. */
  coverIn(root: string, path: string): string | null {
    return coveredBy(this.keysOf(root), relativeTo(root, path))
  }

  has(path: string): boolean {
    const root = this.root()
    return root !== null && this.coverIn(root, path) !== null
  }

  /** Whether a path is archived, or holds something that is: what deleting asks. */
  holdsIn(root: string, path: string): boolean {
    const at = relativeTo(root, path)
    return (
      this.coverIn(root, path) !== null ||
      [...this.keysOf(root)].some((one) => under(one, at, root))
    )
  }

  /** A row renamed or moved: archived at the new path, taken back at the old. */
  moved(from: string, to: string, root = this.root()) {
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    const carried = [...this.keysOf(root)].filter((one) => under(one, was, root))
    const landed = carried.map((one) => movedTo(one, was, now, root) ?? one)
    if (carried.length) void this.change(root, landed, carried)
  }

  /** Archives some paths and takes others back; see `changed` in archive-map.ts. */
  change(root: string, archive: readonly string[], restore: readonly string[]): Promise<void> {
    return import('./archive-map').then(({ changed }) => {
      const next = changed(this.of(root), archive, restore, Date.now())
      if (next) this.put(root, next)
    })
  }

  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.write()
  }

  adopt(root: string, theirs: unknown, accountId: string): Promise<void> {
    return import('./archive-map').then(({ fold }) => fold(this, root, theirs, accountId))
  }

  /** A map replaced, and the account told unless `account` says it is its copy. */
  put(root: string, map: ArchiveMap, account: string | null = null) {
    const held = this.spaces[root]
    const whose = account ?? held?.account ?? null
    if (map === held?.map && whose === held.account) return

    this.spaces = { ...this.spaces, [root]: { map, account: whose } }
    this.write()
    if (account === null) this.soon(root)
  }

  soon(root: string) {
    clearTimeout(this.pushing[root])
    this.pushing[root] = setTimeout(
      () => void import('./archive-map').then(({ send }) => send(this, root)),
      700,
    )
  }

  private write() {
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
