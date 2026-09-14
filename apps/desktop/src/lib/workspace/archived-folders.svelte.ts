/** The folders of a space that have been put away, where those folders have no note.
 *
 *  A note keeps its own mark in its front matter and a plane under its `nib` key,
 *  which is what makes archiving the file's: it travels with the file, into another
 *  vault and into Obsidian. A folder that holds a note of its own name is drawn as
 *  that note and is archived through that note like any other; what is left for this
 *  map is a folder with no such note - one out of somebody's vault - which has no file
 *  anywhere to write a mark into. See folder-notes.ts and folder-icons.svelte.ts,
 *  which is this store's twin in every respect.
 *
 *  A dotfile in the folder would sync for free and survive a move without being told,
 *  but it puts a file in every folder somebody put away and every other tool that
 *  walks the vault sees it. So it is kept beside the space instead: the account for a
 *  space the account knows, this machine for one it does not.
 *
 *  An archived folder hides with everything under it. What is inside keeps its own
 *  mark, so taking the folder back brings back exactly what was not put away on its
 *  own - which is what makes unarchiving a folder the same promise as unarchiving a
 *  note: things end up where they were.
 *
 *  One map per space, from the folder's path as the space speaks it to the date and
 *  time it was put away. Paths are relative and `/`-separated, never a path on this
 *  disk, for the same reason a bookmark is: the map travels between machines and one
 *  of them is Windows. A rename or a move rewrites the key, which is the one thing the
 *  dotfile would have got for free; see `moved`. */

import { insideItsSpace, relativeTo } from '../space-paths'
import { isRecord, isString, keep, stored } from '../stored'
import { without, withOrWithout } from '../records'

export const STORAGE_KEY = 'nib:archived-folders'

/** How many folders of one space may be put away.
 *
 *  The number of folders a space may give an icon to, because the two maps are the
 *  same shape over the same keys and a space that may dress four hundred folders may
 *  put four hundred away. Far more than anybody archives by hand. */
export const MOST_ARCHIVED_FOLDERS = 400

/** How long a written date may be. Room for a date and time and then some; a value
 *  longer than this is not one this app wrote, and the path's own limit is
 *  `insideItsSpace`. */
const LONGEST_VALUE = 64

/** The map in an unknown, with whatever is not a folder and a value left out. Written
 *  by a newer build, by an older one, or by hand: what reads as a pair is kept and the
 *  rest is dropped, the way every other store here reads itself. */
export function archivedFolderMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [path, said] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_ARCHIVED_FOLDERS) break
    if (!insideItsSpace(path) || !isString(said)) continue

    const words = said.trim()
    if (words && words.length <= LONGEST_VALUE) out[path] = words
  }

  return out
}

/** One space's map, and which account it has already been folded into. */
interface Kept {
  folders: Record<string, string>
  /** The account this map has been folded into, or null while there was none. A
   *  different account signing in on this machine merges again; the same one signing
   *  in twice does not, or a folder it took back on another machine would be put away
   *  again straight after. */
  account: string | null
}

function read(): Record<string, Kept> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, Kept> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = {
      folders: archivedFolderMap(one.folders),
      account: isString(one.account) ? one.account : null,
    }
  }

  return out
}

/** Two maps as one. */
function same(one: Record<string, string>, other: Record<string, string>): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}

/** Whether a path is the folder itself, or something inside it. */
function under(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

export class ArchivedFolders {
  private spaces = $state<Record<string, Kept>>(read())

  /** Which space the rows on screen belong to. A function rather than a value because
   *  the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** Reads the map again, once the storage that holds it has answered. For the plugin;
   *  see `reread` in folder-icons.svelte.ts, which is the same fact about the same
   *  storage. */
  reread(): void {
    const held = read()
    const spaces = { ...this.spaces }
    let grew = false

    for (const [root, kept] of Object.entries(held)) {
      if (spaces[root]) continue

      spaces[root] = kept
      grew = true
    }

    if (grew) this.spaces = spaces
  }

  of(root: string): Record<string, string> {
    return this.spaces[root]?.folders ?? {}
  }

  /** Every folder of the open space that has been put away, as the space speaks of
   *  them. What the one predicate is built from; see left-out.svelte.ts. */
  get here(): string[] {
    const root = this.root()
    return root === null ? [] : Object.keys(this.of(root))
  }

  /** When the folder at this path was put away, as written, or null for one nobody
   *  has. Takes a path as the app holds one or as the space speaks it, the way
   *  `folderIcons.iconOf` does. */
  archivedAt(path: string): string | null {
    const root = this.root()
    if (root === null) return null

    return this.of(root)[relativeTo(root, path)] ?? null
  }

  /** Puts a folder away, or takes it back when `when` is null. */
  set(path: string, when: string | null) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    if (!insideItsSpace(at)) return

    const held = this.of(root)
    if ((held[at] ?? null) === when) return
    if (when !== null && Object.keys(held).length >= MOST_ARCHIVED_FOLDERS && !(at in held)) return

    // A folder inside one that is already away says nothing more than the outer one
    // does, and an outer one being put away says everything the folders under it said.
    if (when !== null && Object.keys(held).some((one) => under(at, one) && one !== at)) return

    const next = withOrWithout(held, at, when)
    this.put(
      root,
      when === null
        ? next
        : Object.fromEntries(Object.entries(next).filter(([one]) => !under(one, at) || one === at)),
    )
  }

  /** A folder that has been renamed or moved, with everything under it.
   *
   *  The one thing a dotfile inside the folder would have got for free, and the reason
   *  every path that changes has to say so: a key nobody rewrote is a folder that
   *  quietly comes back. Called from the same places `folderIcons.moved` is. */
  moved(from: string, to: string) {
    const root = this.root()
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    const held = this.of(root)
    const next: Record<string, string> = {}
    let touched = false

    for (const [path, when] of Object.entries(held)) {
      const inside = under(path, was)
      next[inside ? now + path.slice(was.length) : path] = when
      touched ||= inside
    }

    if (touched) this.put(root, next)
  }

  /** A folder that has gone, with everything under it.
   *
   *  A folder that is away cannot be deleted - that is the whole promise - so this is
   *  for the folder above one, and for a space whose files somebody moved out from
   *  under the app. See `remove` in workspace.svelte.ts. */
  gone(path: string) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    const held = this.of(root)
    const next = Object.fromEntries(Object.entries(held).filter(([one]) => !under(one, at)))

    if (Object.keys(next).length !== Object.keys(held).length) this.put(root, next)
  }

  /** A space folder that has been renamed, which re-keys the whole map at once: the
   *  map is kept under the root, and the root is what moved. */
  spaceMoved(from: string, to: string) {
    const held = this.spaces[from]
    if (!held || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: held }
    this.write()
  }

  /** Forgets a space's map, for a space that is no longer here. */
  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.write()
  }

  /** Takes over what the account holds for one space: this machine's own folders folded
   *  in the first time an account sees the space, and the account's map outright on
   *  every pass after that.
   *
   *  After the first contact the account holds the one copy, because a union run on
   *  every pass would put back a folder another machine had deliberately taken out.
   *  Exactly what `excluded.adopt` does, and for the same reason. */
  adopt(root: string, theirs: unknown, accountId: string) {
    // Read rather than trusted: the service is deployed on its own, so a build of it
    // older than this app answers with nothing at all.
    const account = archivedFolderMap(theirs)
    const held = this.spaces[root]
    const first = held?.account !== accountId
    const mine = held?.folders ?? {}
    const folders = first ? { ...account, ...mine } : account

    if (held && !first && same(held.folders, folders)) return

    this.spaces = { ...this.spaces, [root]: { folders, account: accountId } }
    this.write()

    if (first && !same(folders, account)) void this.push(root)
  }

  private put(root: string, folders: Record<string, string>) {
    this.spaces = {
      ...this.spaces,
      [root]: { folders, account: this.spaces[root]?.account ?? null },
    }
    this.write()
    void this.push(root)
  }

  /** The space's map as it now stands, sent up so every other machine leaves the same
   *  folders out.
   *
   *  Signed out, in a space the account has never heard of, or in one shared to read,
   *  it stays on this machine. Imported where it is used, for the reason folder-icons
   *  gives: the syncing loop reads the workspace this store belongs to, and the two
   *  would import each other. */
  private async push(root: string) {
    const [{ account }, { api }, { sync }] = await Promise.all([
      import('../account.svelte'),
      import('../api'),
      import('../sync.svelte'),
    ])

    const token = account.token
    const spaceId = sync.remoteIdFor(root)
    if (!token || !spaceId) return
    if (account.spaces.find((one) => one.id === spaceId)?.role === 'read') return

    await api.saveArchivedFolders(token, spaceId, this.of(root)).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  private write() {
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
