/** Changes to the file tree, applied before the filesystem has answered.
 *
 *  Making a note, renaming one, moving one, deleting one: each is a round trip
 *  to disk and then a fresh listing of the whole folder, and until both come
 *  back the tree shows the way it was. On a local disk that is a flicker; over
 *  a synced folder, or in the browser build where the listing is rebuilt from
 *  storage, it is long enough to wonder whether the click landed. So the row
 *  moves at once and the listing that follows puts it right - it is still the
 *  truth, and an operation that failed simply undoes itself when it arrives.
 *
 *  Every function here returns a new tree rather than editing the one it was
 *  given, so the reactive state sees a change, and none of them touch the
 *  filesystem: they are what the tree would look like if the operation
 *  succeeded, which it usually does. */

import { folderOf, nameOf } from './space-paths'
import type { Entry, SortKey, TreeOptions } from './workspace.svelte'

/** Whether `path` names something inside the folder at `base`, at any depth. */
function under(base: string, path: string): boolean {
  if (!path.startsWith(base)) return false

  const next = path[base.length]
  // A space that is the whole of its store has the separator in `base` already;
  // see `spaces_root` in the browser build.
  return base.endsWith('/') ? path.length > base.length : next === '/' || next === '\\'
}

/** The order the listing itself uses: folders first, then the chosen key. */
function compareEntries(options: TreeOptions): (a: Entry, b: Entry) => number {
  const key: SortKey = options.sort
  const by = (a: Entry, b: Entry) => {
    if (key === 'modified') return a.modified - b.modified
    if (key === 'created') return a.created - b.created
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
  }

  return (a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return options.descending ? -by(a, b) : by(a, b)
  }
}

/** `tree` with `change` applied to the children of the folder at `path`. */
function inFolder(tree: Entry, path: string, change: (children: Entry[]) => Entry[]): Entry {
  if (tree.path === path) return { ...tree, children: change([...tree.children]) }
  if (!path.startsWith(tree.path)) return tree

  return {
    ...tree,
    children: tree.children.map((child) => (child.is_dir ? inFolder(child, path, change) : child)),
  }
}

/** A new note or folder, in the place the listing would put it. */
export function withEntry(tree: Entry, entry: Entry, options: TreeOptions): Entry {
  const order = compareEntries(options)
  return inFolder(tree, folderOf(entry.path), (children) => {
    const kept = children.filter((child) => child.path !== entry.path)
    const at = kept.findIndex((child) => order(entry, child) < 0)
    if (at < 0) return [...kept, entry]
    return [...kept.slice(0, at), entry, ...kept.slice(at)]
  })
}

/** The tree without the rows the space is not showing, at any depth.
 *
 *  One filter for the whole file list, rather than one at each of the places that walk
 *  it. The panel mounts a slice of the rows and the arrow keys walk all of them, and
 *  they count from the same list: a row hidden from one and not the other is Down
 *  landing on nothing. So the tree they are both drawn from is the filtered one, and
 *  neither knows anything about it.
 *
 *  A folder that is left out goes with everything under it, which needs no saying here:
 *  the branch is dropped, so nothing inside it is walked.
 *
 *  `leaving` is handed the whole entry rather than its path, because a row is not always
 *  the file it is about: a folder that holds a note of its own name is drawn as that note,
 *  and whether that row is left out is a question about the note. Only the caller knows
 *  that rule, so only the caller is asked.
 *
 *  The tree itself is never dropped, whatever it says: the space's own folder is the
 *  list, not a row in it. See workspace/left-out.svelte.ts for what does the leaving. */
export function withoutLeftOut(
  tree: Entry | null,
  leaving: (entry: Entry) => boolean,
): Entry | null {
  if (!tree) return null

  const kept = pruned(tree.children, leaving)
  return kept === tree.children ? tree : { ...tree, children: kept }
}

/** One folder's children, filtered, and the same array back where nothing changed - so
 *  a space with nothing archived in it is not rebuilt on every keystroke. */
function pruned(children: readonly Entry[], leaving: (entry: Entry) => boolean): Entry[] {
  let touched = false
  const out: Entry[] = []

  for (const child of children) {
    if (leaving(child)) {
      touched = true
      continue
    }

    const inside = child.children.length ? pruned(child.children, leaving) : child.children
    if (inside === child.children) {
      out.push(child)
      continue
    }

    touched = true
    out.push({ ...child, children: inside })
  }

  return touched ? out : (children as Entry[])
}

/** A row that is on its way out. */
export function withoutEntry(tree: Entry, path: string): Entry {
  return inFolder(tree, folderOf(path), (children) =>
    children.filter((child) => child.path !== path),
  )
}

/** The entry at `path`, or null. */
export function entryAt(tree: Entry | null, path: string): Entry | null {
  if (!tree) return null
  if (tree.path === path) return tree
  if (!path.startsWith(tree.path)) return null

  for (const child of tree.children) {
    const found = entryAt(child, path)
    if (found) return found
  }
  return null
}

/** Every path under `entry`, itself included, rewritten from `from` to `to`.
 *  A folder takes its contents along, so the rows inside it keep working. */
function rebased(entry: Entry, from: string, to: string): Entry {
  const path = to + entry.path.slice(from.length)
  return {
    ...entry,
    path,
    name: nameOf(path),
    children: entry.children.map((child) => rebased(child, from, to)),
  }
}

/** The rows for notes the account has named and this machine has not written yet.
 *
 *  The same idea as everything above, over a longer wait: a first sync knows every
 *  note's *name* one request in and spends the next half minute fetching bodies,
 *  so the list is drawn from the names and the rows fill in behind them. A row
 *  here is a row like any other - it is the file that is coming, not the row - and
 *  the folders above it are made as well, since a note the account keeps two
 *  folders deep has neither of them on this disk yet.
 *
 *  Sorted before they go in, so the same listing lands the same way twice. No time
 *  on them: a file that is not here has no age, and the listing that follows
 *  brings the real one.
 *
 *  A path the listing already holds is left alone, which is what makes this safe
 *  to apply to every pass rather than only the first. */
export function withComing(tree: Entry, paths: readonly string[], options: TreeOptions): Entry {
  let out = tree

  for (const path of [...paths].sort()) {
    if (!under(tree.path, path)) continue
    if (entryAt(out, path)) continue

    out = withFolders(out, folderOf(path), options)
    out = withEntry(out, blank(path, false), options)
  }

  return out
}

/** The folder at `path`, and every folder above it the listing has none for. */
function withFolders(tree: Entry, path: string, options: TreeOptions): Entry {
  if (!path || path === tree.path || entryAt(tree, path)) return tree

  return withEntry(withFolders(tree, folderOf(path), options), blank(path, true), options)
}

function blank(path: string, isFolder: boolean): Entry {
  return {
    name: nameOf(path),
    path,
    is_dir: isFolder,
    modified: 0,
    created: 0,
    children: [],
  }
}

/** A note or folder under its new name, or in its new folder. */
export function withMove(tree: Entry, from: string, to: string, options: TreeOptions): Entry {
  const entry = entryAt(tree, from)
  if (!entry || from === to) return tree
  return withEntry(withoutEntry(tree, from), rebased(entry, from, to), options)
}
