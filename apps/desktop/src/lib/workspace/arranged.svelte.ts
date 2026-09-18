/** The order somebody arranged the rows of a folder into, by hand.
 *
 *  Six of the file list's seven orders are a rule - a name, a time, either way
 *  round - and need nothing kept anywhere. The seventh is a decision, one drag at
 *  a time, and a decision has to be written down somewhere.
 *
 *  Not in a file beside the notes. A dotfile in every arranged folder would sync
 *  for free and survive a move without being told, and it would also put a file
 *  into somebody's vault that every other tool walking it can see; the space holds
 *  Obsidian-compatible files and nothing else. So the order is kept beside the
 *  space, exactly where a folder's icon is kept and for the same reason:
 *  workspace/folder-icons.svelte.ts is this store's twin in every respect, down to
 *  remembering which account a space's map has been folded into.
 *
 *  One map per space, from a folder's path as the space speaks it to the names of
 *  its children in the order they are drawn. The empty key is the top of the
 *  space, which is where most notes live and so the one folder that could not be
 *  left out.
 *
 *  Names rather than paths, because a name is what the list draws and what a
 *  folder's children are told apart by; and only as far as somebody actually
 *  arranged, because a name the list does not hold falls to the end in the order the
 *  folder would have read in anyway. Somebody who pulls three notes to the top of a
 *  folder of four hundred has arranged three names, and three names is all that is
 *  written, synced and rewritten when one of the four hundred is renamed. A folder
 *  nobody has moved a row in keeps nothing at all; see `trimmed` in
 *  tree-arranging.ts.
 *
 *  Which order a space is read in is not here: that is a view rather than a fact
 *  about the notes, so it stays on the machine, in workspace/device.svelte.ts,
 *  beside how far down the list each space was left. */

import { insideItsSpace, nameOf, relativeTo } from '../space-paths'
import { renamedIn, withoutName } from '../tree-order'
import { isRecord, isString, keep, stored } from '../stored'
import { without } from '../records'

export const STORAGE_KEY = 'nib:arranged'

/** How many folders of one space may carry an order somebody arranged.
 *
 *  Fewer than the four hundred folders that may wear an icon, because an icon is
 *  one press and an order is a drag: nobody arranges two hundred folders by hand.
 *  The service holds an account to the same number, so a map that fits here fits
 *  there. */
export const MOST_ARRANGED = 200

/** How many names one folder's list may hold. A ceiling nobody writing notes
 *  meets, since the list only runs as far as the last row somebody moved. */
export const MOST_NAMES = 500

/** How long a name may be. The limit every filesystem the app runs on keeps. */
const LONGEST_NAME = 255

/** Whether this is the name of a child of a folder rather than a path.
 *
 *  A name, because that is what the list draws: a separator in it would be a path
 *  pretending to be one, and `..` would be the folder above pretending to be
 *  inside it. */
function isName(value: unknown): value is string {
  return (
    isString(value) &&
    !!value &&
    value.length <= LONGEST_NAME &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..' &&
    !/\p{Cc}/u.test(value)
  )
}

/** Whether this key names a folder of the space. The empty key is the top of the
 *  space and is the one exception; every other key is a path the space could
 *  resolve on any machine, which is the same reading the icons keep. */
function isFolderKey(key: string): boolean {
  return key === '' || insideItsSpace(key)
}

/** One folder's list as it was written, with whatever is not a name left out and
 *  a name said twice said once. */
function namesIn(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  for (const one of value) {
    if (out.length >= MOST_NAMES) break
    if (isName(one) && !out.includes(one)) out.push(one)
  }

  return out
}

/** The map in an unknown, with whatever is not a folder and an order left out.
 *  Written by a newer build, by an older one, or by hand: what reads as a folder
 *  with names in it is kept and the rest is dropped, the way every other store
 *  here reads itself. */
export function arrangedMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}

  const out: Record<string, string[]> = {}
  for (const [folder, names] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_ARRANGED) break
    if (!isFolderKey(folder)) continue

    const kept = namesIn(names)
    // A folder whose list is empty reads in name order, which is what no entry at
    // all already means.
    if (kept.length) out[folder] = kept
  }

  return out
}

/** One space's map, and which account it has already been reconciled with. The
 *  three fields the folder icons keep, for the three reasons they keep them. */
interface Kept {
  folders: Record<string, string[]>
  /** The account this map has been folded into, or null while there was none. A
   *  different account signing in on this machine merges again; the same one
   *  signing in twice does not, or an order it rearranged on another machine would
   *  be handed straight back to it. */
  account: string | null
  /** Whether the account has heard what is here. False for a push that did not
   *  land, and then the next pass keeps this machine's map and sends it again
   *  instead of taking the account's word for a drag the account never heard. */
  sent: boolean
}

function read(): Record<string, Kept> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, Kept> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = {
      folders: arrangedMap(one.folders),
      account: isString(one.account) ? one.account : null,
      sent: one.sent !== false,
    }
  }

  return out
}

/** Two lists as one. */
function sameNames(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((name, at) => name === other[at])
}

/** How long after the last drop the account is told, in milliseconds. The number
 *  the folder icons wait, for the reason they wait: a row dragged three times in a
 *  row is three writes here and one request there. The list on screen and this
 *  machine's storage are written on the spot either way. */
const SETTLING = 700

/** The order a drag is showing but has not committed to: the folder it is in and
 *  the names as they would be if the row were dropped here.
 *
 *  Kept in the store rather than in the component, which is what makes the gap
 *  under the pointer the same gap the whole list is drawn from: one source for the
 *  order, so the rows in the window, the rows the keyboard walks and the row being
 *  dragged cannot come to different answers. Escape and a drag that ends nowhere
 *  drop it and the rows slide back. */
interface Showing {
  root: string
  folder: string
  names: string[]
}

export class Arranged {
  private spaces = $state<Record<string, Kept>>(read())
  private showing = $state<Showing | null>(null)
  /** A push waiting for the dragging to stop, per space. Bookkeeping rather than
   *  state: nothing on screen is drawn from it. */
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}
  /** The account's half, once it has been asked for. */
  private talking: Promise<typeof import('./arranging')> | null = null

  /** Which space the rows on screen belong to. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** Reads the map again, once the storage that holds it has answered. For the
   *  plugin, which reads a store seeded seconds after the page was built; see
   *  `reread` in device.svelte.ts, which is the same fact about the same storage. */
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

  of(root: string): Record<string, string[]> {
    return this.spaces[root]?.folders ?? {}
  }

  /** The names one folder's rows are drawn in, as far as anybody arranged them.
   *  Takes the folder's path as the app holds one; empty for a folder nobody has
   *  arranged, which reads in name order.
   *
   *  The order a drag is showing wins while it is showing, which is how the gap
   *  under the pointer becomes the order the list is drawn in. */
  listOf(folder: string): readonly string[] {
    const root = this.root()
    if (root === null) return []

    const at = relativeTo(root, folder)
    const shown = this.showing
    if (shown?.root === root && shown.folder === at) return shown.names

    return this.of(root)[at] ?? []
  }

  /** The same list, ignoring whatever a drag is showing.
   *
   *  What every move is computed from, so a drag is idempotent: the answer to "this
   *  row, beside that one" depends on where the pointer is and on nothing the pointer
   *  did on the way there. Computed from what is showing instead, a drag drifts - each
   *  frame builds on the last, and a row dragged down and back does not come back. */
  savedList(folder: string): readonly string[] {
    const root = this.root()
    if (root === null) return []

    return this.of(root)[relativeTo(root, folder)] ?? []
  }

  /** Whether a drag is showing an order it has not committed to. */
  get dragging(): boolean {
    return this.showing !== null
  }

  /** The order a drag would leave behind if it were dropped here. Written down
   *  rather than committed, so the rows slide to it and Escape puts them back. */
  show(folder: string, names: readonly string[]) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, folder)
    if (!isFolderKey(at)) return

    // The pointer moves many times between one gap and the next, and the order it
    // would leave behind is the same answer every time: written again only where it
    // has actually changed, so nothing downstream is redrawn for nothing.
    const shown = this.showing
    if (shown?.folder === at && sameNames(shown.names, names)) return

    this.showing = { root, folder: at, names: [...names] }
  }

  /** The drag ended without a drop, or Escape took it back. */
  unshow() {
    this.showing = null
  }

  /** The drop landed: what the drag was showing is what the folder keeps. */
  drop() {
    const shown = this.showing
    this.showing = null
    if (!shown) return

    this.write(shown.root, shown.folder, shown.names)
  }

  /** The order a folder keeps, set outright. For the keys, which move a row
   *  without a drag; see `moveInOrder` in workspace.svelte.ts. */
  set(folder: string, names: readonly string[]) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, folder)
    if (!isFolderKey(at)) return

    this.write(root, at, [...names])
  }

  private write(root: string, at: string, names: string[]) {
    const held = this.of(root)
    const kept = namesIn(names)
    const there = held[at] ?? []

    if (sameNames(there, kept)) return
    if (kept.length && !(at in held) && Object.keys(held).length >= MOST_ARRANGED) return

    // An empty list is no order at all, which is what no entry already means: a
    // folder dragged back into name order stops being a folder anybody arranged.
    this.put(root, kept.length ? { ...held, [at]: kept } : without(held, at))
  }

  /** A note or folder that has been renamed or moved, with everything under it.
   *
   *  Two things to put right, and a rename is both at once: the folder it sits in
   *  knows it by name, and a folder that moved is the key of its own list and of
   *  every list under it. Called from the same three places `folderIcons.moved` is
   *  - a rename, a move, and the undo of either. */
  moved(from: string, to: string) {
    const root = this.root()
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    const held = this.of(root)
    let next = held

    // The keys, for a folder that moved. Everything under it comes along, which is
    // the one thing a dotfile inside the folder would have got for free.
    const rekeyed: Record<string, string[]> = {}
    let touched = false
    for (const [folder, names] of Object.entries(held)) {
      const under = folder === was || folder.startsWith(`${was}/`)
      rekeyed[under ? now + folder.slice(was.length) : folder] = names
      touched ||= under
    }
    if (touched) next = rekeyed

    // And the name, in the list of the folder it sits in. A row renamed keeps the
    // place it was arranged into; a row that moved to another folder leaves the list
    // it was in and falls to the end of its new one, in name order, which is where a
    // row nobody arranged goes.
    const owner = folderKeyOf(was)
    const listed = next[owner]
    if (listed) {
      const under =
        folderKeyOf(now) === owner
          ? renamedIn(listed, nameOf(was), nameOf(now))
          : withoutName(listed, nameOf(was))
      if (under) next = withList(next, owner, under)
    }

    if (next !== held) this.put(root, next)
  }

  /** A note or folder that has gone, with everything under it. */
  gone(path: string) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    const held = this.of(root)
    let next: Record<string, string[]> = {}
    let touched = false

    for (const [folder, names] of Object.entries(held)) {
      if (folder === at || folder.startsWith(`${at}/`)) {
        touched = true
        continue
      }
      next[folder] = names
    }

    const owner = folderKeyOf(at)
    const name = nameOf(at)
    const listed = next[owner]
    if (listed?.includes(name)) {
      next = withList(
        next,
        owner,
        listed.filter((one) => one !== name),
      )
      touched = true
    }

    if (touched) this.put(root, next)
  }

  /** A space folder that has been renamed, which re-keys the whole map at once:
   *  the map is kept under the root, and the root is what moved. */
  spaceMoved(from: string, to: string) {
    const held = this.spaces[from]
    if (!held || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: held }
    this.writeAll()
  }

  /** Forgets a space's map, for a space that is no longer here. */
  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.writeAll()
  }

  /** Takes over what the account holds for one space.
   *
   *  The fold itself, and the push that answers it, are next door in arranging.ts and
   *  are fetched when there is an account to talk to: a window that is not signed in,
   *  or one nobody has arranged anything in, never asks for them, and the file list is
   *  the first paint. See lib/ai/ask.ts, which is the same seam.
   *
   *  Answers a promise so a caller who wants to know when the fold has happened can
   *  wait for it; App.svelte does not, and the tests do. */
  adopt(root: string, theirs: unknown, accountId: string): Promise<void> {
    return this.reaching().then(({ fold }) => fold(this, root, theirs, accountId))
  }

  /** What one space's map is, and what the account has been told of it: the orders,
   *  which account they were folded into, and whether that account has heard them.
   *
   *  These three are public for arranging.ts and for nothing else. The alternative was
   *  a second interface saying the same three things, which is a shape that drifts. */
  kept(root: string): { folders: Record<string, string[]>; account: string | null; sent: boolean } {
    const held = this.spaces[root]
    return {
      folders: held?.folders ?? {},
      account: held?.account ?? null,
      sent: held?.sent !== false,
    }
  }

  /** The account's copy taken on, whole, and marked as heard. */
  took(root: string, folders: Record<string, string[]>, account: string) {
    this.spaces = { ...this.spaces, [root]: { folders, account, sent: true } }
    this.writeAll()
  }

  /** Whether the account has heard the space's map as it now stands. What the next
   *  pass reads before it hands this machine the account's copy; see `fold`. */
  said(root: string, landed: boolean) {
    const held = this.spaces[root]
    if (!held || held.sent === landed) return

    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.writeAll()
  }

  private put(root: string, folders: Record<string, string[]>) {
    this.spaces = {
      ...this.spaces,
      [root]: { folders, account: this.spaces[root]?.account ?? null, sent: false },
    }
    this.writeAll()
    this.soon(root)
  }

  /** The account hears about it once the dragging stops. */
  private soon(root: string) {
    const held = this.pushing[root]
    if (held !== undefined) clearTimeout(held)

    const waiting = setTimeout(() => {
      this.pushing = without(this.pushing, root)
      void this.reaching().then(({ send }) => send(this, root))
    }, SETTLING)

    this.pushing = { ...this.pushing, [root]: waiting }
  }

  /** The account's half, once. */
  private reaching(): Promise<typeof import('./arranging')> {
    return (this.talking ??= import('./arranging'))
  }

  private writeAll() {
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}

/** The key of the folder a relative path sits in. The top of the space is the
 *  empty key, which is what a path with no separator in it is already in. */
function folderKeyOf(at: string): string {
  const cut = at.lastIndexOf('/')
  return cut < 0 ? '' : at.slice(0, cut)
}

/** The map with one folder's list set, or with the folder dropped where the list
 *  no longer says anything. */
function withList(
  held: Record<string, string[]>,
  folder: string,
  names: string[],
): Record<string, string[]> {
  return names.length ? { ...held, [folder]: names } : without(held, folder)
}
