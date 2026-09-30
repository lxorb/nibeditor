/** The notes and folders a space leaves out of what it says about itself.
 *
 *  Three things read it, and they are the three that speak for the whole space
 *  rather than for one note: the search, the picture of its links, and the
 *  mentions of a note that are not links yet. An archive of last year's notes is
 *  still there to open and still syncs; it simply stops answering questions asked
 *  of the space.
 *
 *  Paths, not patterns. The way in is a row's own menu, and a row always names a
 *  note or a folder; a folder stands for everything under it, which is the only
 *  pattern a file tree needs. A text field of globs would be a second language to
 *  learn beside the search's own, in a settings pane nobody asked for.
 *
 *  Relative and `/`-separated, never a path on this disk, for the same reason a
 *  bookmark is: the list travels between machines and one of them is Windows.
 *  `nib:folder-icons` is this store's twin in every respect, down to remembering
 *  which account a space's list has been folded into. */

import { insideItsSpace, movedTo, relativeTo, samePath, within } from '../space-paths'
import { isString, keep } from '../stored'
import { filledIn, type Folded, type Folding, meet, readSpaces, without } from '../records'

export const STORAGE_KEY = 'nib:excluded'

/** How many paths one space may leave out. Far more than anybody excludes by
 *  hand; the service holds a space to the same number, so a list that fits here
 *  fits there. */
export const MOST_EXCLUDED = 200

/** The list in an unknown, with whatever is not a path inside a space left out.
 *  Written by a newer build, by an older one, or by hand: what reads as a path is
 *  kept and the rest is dropped, the way every other store here reads itself. */
export function excludedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  // One entry at a time rather than the list whole: these are paths, and one
  // unreadable entry says nothing about the others. The service reads it the same
  // way.
  for (const one of value) {
    if (out.length >= MOST_EXCLUDED) break
    if (isString(one) && insideItsSpace(one) && !out.includes(one)) out.push(one)
  }

  return out
}

/** One space's list, and which account it has already been folded into. */
interface Kept extends Folded {
  paths: string[]
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({ paths: excludedPaths(one.paths) }))
}

/** Two lists as one. */
function same(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((path, at) => path === other[at])
}

/** This machine's paths after the account's, the ones it already has left out. */
const PATHS: Folding<string[]> = {
  fold: (theirs, mine) => [...theirs, ...mine.filter((one) => !theirs.includes(one))],
  same,
}

/** Whether a path is the one excluded, or inside a folder that is. */
function under(path: string, excluded: string, root?: string): boolean {
  return !!excluded && within(excluded, path, root) !== null
}

export class Excluded {
  private spaces = $state<Record<string, Kept>>(read())

  /** Which space the rows on screen belong to. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** Reads the list again, once the storage that holds it has answered. For the
   *  plugin; see `reread` in folder-icons.svelte.ts, which is the same fact about
   *  the same storage. */
  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  of(root: string): string[] {
    return this.spaces[root]?.paths ?? []
  }

  /** What the space being looked at leaves out, as the space speaks of it. */
  get here(): string[] {
    const root = this.root()
    return root === null ? [] : this.of(root)
  }

  /** Whether a path is left out: the path itself, or a folder above it.
   *
   *  Takes a path as the app holds one or as the space speaks it, because the
   *  surfaces that ask disagree: a row in the tree knows where the file is on this
   *  disk, and a search hit or a graph node knows it relative to the space. The
   *  same two readings `links.iconOf` takes. */
  has(path: string): boolean {
    const root = this.root()
    if (root === null) return false

    const held = this.of(root)
    if (!held.length) return false

    const at = relativeTo(root, path)
    return held.some((one) => under(at, one))
  }

  /** Whether this exact path is the one excluded, rather than something inside an
   *  excluded folder. What the menu row reads, so it says "take back" only for the
   *  row that can be taken back. */
  names(path: string): boolean {
    const root = this.root()
    if (root === null) return false

    const at = relativeTo(root, path)
    return this.of(root).some((one) => samePath(one, at, root))
  }

  /** Leaves a path out, or takes it back. */
  toggle(path: string) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    if (!insideItsSpace(at)) return

    const held = this.of(root)
    if (held.some((one) => samePath(one, at, root))) {
      this.put(
        root,
        held.filter((one) => !samePath(one, at, root)),
      )
      return
    }

    if (held.length >= MOST_EXCLUDED) return
    // A path inside a folder that is already left out says nothing more than the
    // folder does.
    if (held.some((one) => under(at, one, root))) return

    // And a folder being left out says everything the paths under it said.
    this.put(root, [...held.filter((one) => !under(one, at, root)), at])
  }

  /** A note or a folder that has been renamed or moved, with everything under it.
   *  The one thing a marker inside the file would have got for free, and the reason
   *  every path that changes has to say so. */
  moved(from: string, to: string, root = this.root()) {
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    if (!was) return

    const held = this.of(root)
    const next = held.map((one) => movedTo(one, was, now, root) ?? one)

    if (!same(held, next)) this.put(root, next)
  }

  /** A note or a folder that has gone, with everything under it. */
  gone(path: string, root = this.root()) {
    if (root === null) return

    const at = relativeTo(root, path)
    const held = this.of(root)
    const next = held.filter((one) => !under(one, at, root))

    if (!same(held, next)) this.put(root, next)
  }

  /** A space folder that has been renamed, which re-keys the list at once: it is
   *  kept under the root, and the root is what moved. */
  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  /** Forgets a space's list, for a space that is no longer here. */
  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.write()
  }

  /** Takes over what the account holds for one space: this machine's own paths
   *  folded in the first time an account sees the space, and the account's list
   *  outright on every pass after that.
   *
   *  After the first contact the account holds the one copy, because a union run on
   *  every pass would hand back a path another machine had deliberately taken back.
   *  Exactly what `bookmarks.adopt` does, and for the same reason. */
  adopt(root: string, theirs: unknown, accountId: string) {
    // Read rather than trusted: the service is deployed on its own, so a build of
    // it older than this app answers with nothing at all.
    const account = excludedPaths(theirs)
    const held = this.spaces[root]
    const met = meet(held, accountId, held?.paths ?? [], account, PATHS)
    if (!met) return

    this.spaces = { ...this.spaces, [root]: { paths: met.value, account: accountId } }
    this.write()

    if (met.tell) void this.push(root)
  }

  private put(root: string, paths: string[]) {
    this.spaces = {
      ...this.spaces,
      [root]: { paths, account: this.spaces[root]?.account ?? null },
    }
    this.write()
    void this.push(root)
  }

  /** The space's list as it now stands, sent up so every other machine leaves out
   *  the same notes. See pushing.ts. */
  private async push(root: string) {
    const { push } = await import('./pushing')
    await push(root, (api, token, spaceId) => api.saveExcluded(token, spaceId, this.of(root)))
  }

  private write() {
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
