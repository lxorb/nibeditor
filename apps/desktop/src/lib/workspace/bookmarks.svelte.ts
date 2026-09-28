/** The bookmarks of a space: the notes, folders, headings and searches kept in
 *  the row above the file list.
 *
 *  A bookmark says where it points the way a link does, relative to the space,
 *  never as a path on this disk, because the list travels: signed in it lives
 *  on the account and every machine reads the same one. Signed out it stays
 *  here, the way the pins it grew out of did.
 *
 *  Kept per space, so two spaces cannot crowd each other out of one list and a
 *  space that goes takes its bookmarks with it. */

import { isMarkdownPath, relativeTo } from '../space-paths'
import { without } from '../records'
import { forget, isRecord, isString, keep, stored, stringList } from '../stored'

const STORAGE_KEY = 'nib:bookmarks'

/** What pins were kept under. Read once and dropped; see `migrate`. */
const PINNED_KEY = 'nib:pinned'

/** More than anyone keeps above a file list. The service holds an account to
 *  the same number, so a list that fits here fits there. */
export const MOST_BOOKMARKS = 60

export const BOOKMARK_KINDS = [
  'note',
  'folder',
  'heading',
  'search',
  'block',
  'group',
  'graph',
] as const
type BookmarkKind = (typeof BOOKMARK_KINDS)[number]

/** The kinds whose path names a file or a folder in the space, and so the kinds a
 *  rename or a move has to carry along. A search and a graph view point at no file,
 *  and a group's path is a name of its own. */
const POINTS_AT_A_FILE: ReadonlySet<BookmarkKind> = new Set(['note', 'folder', 'heading', 'block'])

export interface Bookmark {
  kind: BookmarkKind
  /** The note or folder it points at, relative to the space. Empty for a
   *  search, which points at no file; a name of its own for a group, which
   *  points at nothing and is pointed at instead. */
  path: string
  /** The heading a heading bookmark names, the block name a block bookmark
   *  carries, the words a search looks for, or what a group is called. Empty for
   *  a note or a folder. Always a string rather than an optional field, so one
   *  shape serves the storage, the wire and the comparison below. */
  text: string
  /** The group this sits in, by that group's own name, or absent at the top of
   *  the list. One field rather than a list of children, because the order of
   *  the whole list is the order it is drawn in and a tree of lists would have
   *  two orders to keep in step. */
  parent?: string
  /** What a graph bookmark is a bookmark of: one whole set of graph settings, as
   *  the JSON they are stored in everywhere else. Absent on every other kind.
   *
   *  A field of its own rather than crammed into `text`, which is the name the
   *  reader gave the view: the row has to say what it is called, and a row named
   *  after its own filter would be a row called `tag:work path:Notes`. See
   *  workspace/graph-settings.svelte.ts, which is what reads it. */
  view?: string
}

/** How long the settings of a bookmarked view may be, as JSON. A filter, six
 *  colour groups and a handful of numbers; the service holds a space to the same
 *  number. */
const LONGEST_VIEW = 400

export function isBookmark(value: unknown): value is Bookmark {
  return (
    isRecord(value) &&
    BOOKMARK_KINDS.some((kind) => kind === value.kind) &&
    isString(value.path) &&
    isString(value.text) &&
    (value.parent === undefined || isString(value.parent)) &&
    (value.view === undefined || (isString(value.view) && value.view.length <= LONGEST_VIEW))
  )
}

/** A name no group in this space has: what a group is filed under, and what its
 *  rows point back at. Short, because it travels with every row in the group. */
function freeGroupId(taken: readonly Bookmark[]): string {
  for (;;) {
    const id = `g${Math.random().toString(36).slice(2, 8)}`
    if (!taken.some((one) => one.kind === 'group' && one.path === id)) return id
  }
}

/** The bookmarks in an unknown, with whatever is not one left out. A list
 *  written by a newer build may hold a kind this one has never heard of, and
 *  that is a row it cannot draw. */
export function bookmarkList(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isBookmark)
    .map((one) => ({
      kind: one.kind,
      path: one.path,
      text: one.text,
      ...(one.parent ? { parent: one.parent } : {}),
      ...(one.view ? { view: one.view } : {}),
    }))
    .slice(0, MOST_BOOKMARKS)
}

/** Two bookmarks are the same one when they point at the same thing.
 *
 *  Which group it is in is not part of that: a note is bookmarked or it is not,
 *  and moving it into a group is moving the bookmark it already is rather than
 *  making a second one. */
export function sameBookmark(one: Bookmark, other: Bookmark): boolean {
  return one.kind === other.kind && one.path === other.path && one.text === other.text
}

function sameList(one: readonly Bookmark[], other: readonly Bookmark[]): boolean {
  if (one.length !== other.length) return false

  return one.every((mark, at) => {
    const theirs = other[at]
    return !!theirs && sameBookmark(mark, theirs)
  })
}

/** The account's list, with anything this machine had and it has not added
 *  after it.
 *
 *  Run once per space and account: afterwards the account holds the one copy,
 *  because a union run on every pass would hand back a bookmark that another
 *  machine had deliberately removed. */
export function mergeBookmarks(theirs: Bookmark[], mine: Bookmark[]): Bookmark[] {
  const extra = mine.filter((one) => !theirs.some((held) => sameBookmark(held, one)))
  return [...theirs, ...extra].slice(0, MOST_BOOKMARKS)
}

/** True when `path` names something inside `root` rather than merely starting
 *  with the same letters: `Nib/Work` does not hold `Nib/Working`. */
function startsInside(root: string, path: string): boolean {
  return path.length > root.length && path.startsWith(root) && /[\\/]/.test(path[root.length] ?? '')
}

/** The pins an older build kept, as the bookmarks of the space each one is in.
 *
 *  A pin was a path on this disk and a bookmark is a path a space speaks, so a
 *  pin that belongs to none of the spaces at hand has nowhere to go and is
 *  dropped. Whether it named a note or a folder is read off its extension,
 *  which is what the file list would have gone by anyway. */
export function bookmarksFromPins(
  pins: readonly string[],
  roots: readonly string[],
): Record<string, Bookmark[]> {
  const out: Record<string, Bookmark[]> = {}
  // Longest first, so a space that sits inside another one claims its own pins.
  const deepest = [...roots].sort((one, other) => other.length - one.length)

  for (const pin of pins) {
    const root = deepest.find((one) => startsInside(one, pin))
    if (!root) continue

    const path = relativeTo(root, pin)
    const mark: Bookmark = { kind: isMarkdownPath(path) ? 'note' : 'folder', path, text: '' }
    out[root] = [...(out[root] ?? []), mark]
  }

  return out
}

/** One space's list, and which account it has already been reconciled with. */
interface Kept {
  list: Bookmark[]
  /** The account this list has been folded into, or null while there was none.
   *  A different account signing in on this machine merges again; the same one
   *  signing in twice does not, or a bookmark it dropped on another machine
   *  would be handed straight back to it. */
  account: string | null
}

function read(): Record<string, Kept> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, Kept> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = {
      list: bookmarkList(one.list),
      account: isString(one.account) ? one.account : null,
    }
  }

  return out
}

export class Bookmarks {
  private spaces = $state<Record<string, Kept>>(read())

  /** What the last change is still offering to the account; see `put`. The offer
   *  outlives the call that caused it - the row answers in the frame the click
   *  happened in and the account hears after - so this is how anything that has to
   *  know the offer was made waits for the offer itself rather than for a moment
   *  to pass. Not state: nothing on screen reads it. */
  offered: Promise<unknown> = Promise.resolve()

  /** Which space the rows on screen belong to. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** The open space's bookmarks, in the order they were put in. */
  get list(): Bookmark[] {
    const root = this.root()
    return root === null ? [] : this.of(root)
  }

  of(root: string): Bookmark[] {
    return this.spaces[root]?.list ?? []
  }

  has(mark: Bookmark | null): boolean {
    return !!mark && this.list.some((held) => sameBookmark(held, mark))
  }

  /** In or out, whichever it is not. Bookmarking is one gesture, so it is one
   *  call, and the row answers in the frame the click happened in. */
  toggle(mark: Bookmark | null) {
    const root = this.root()
    if (!mark || root === null) return

    const held = this.of(root)
    const next = this.has(mark)
      ? held.filter((one) => !sameBookmark(one, mark))
      : [...held, mark].slice(0, MOST_BOOKMARKS)

    this.put(root, next)
  }

  /** A selection in, or out once all of it is in: one press, one write. */
  toggleAll(marks: readonly Bookmark[]) {
    const root = this.root()
    if (!marks.length || root === null) return

    const held = this.of(root)
    const holds = (mark: Bookmark) => held.some((one) => sameBookmark(one, mark))
    const next = marks.every(holds)
      ? held.filter((one) => !marks.some((mark) => sameBookmark(one, mark)))
      : [...held, ...marks.filter((mark) => !holds(mark))].slice(0, MOST_BOOKMARKS)

    this.put(root, next)
  }

  /** Drags a row to another place in the list. Out-of-range indexes are what a
   *  drop that landed on nothing looks like, so they leave the order alone. */
  move(from: number, to: number) {
    const root = this.root()
    if (root === null) return

    const held = this.of(root)
    const mark = held[from]
    if (!mark || to < 0 || to >= held.length || from === to) return

    const rest = held.filter((_, at) => at !== from)
    this.put(root, [...rest.slice(0, to), mark, ...rest.slice(to)])
  }

  /** A note or folder in the open space, as a bookmark. Null for a row outside
   *  it, which is nothing this space can keep. */
  /** A new group, at the end of the list, under a name of its own. */
  addGroup(name: string): Bookmark | null {
    const root = this.root()
    const words = name.trim()
    if (root === null || !words) return null

    const held = this.of(root)
    if (held.length >= MOST_BOOKMARKS) return null

    const group: Bookmark = { kind: 'group', path: freeGroupId(held), text: words }
    this.put(root, [...held, group])
    return group
  }

  /** What a group is called. Only a group has a name of its own: everything else
   *  is called after what it points at. */
  rename(mark: Bookmark, name: string) {
    const root = this.root()
    const words = name.trim()
    if (root === null || mark.kind !== 'group' || !words) return

    this.put(
      root,
      this.of(root).map((one) => (sameBookmark(one, mark) ? { ...one, text: words } : one)),
    )
  }

  /** Takes one out. A group takes nothing with it: what was in it comes up to
   *  where the group was, which is what somebody who empties a folder of
   *  bookmarks means - the bookmarks were the point, the group was the shelf. */
  remove(mark: Bookmark) {
    const root = this.root()
    if (root === null) return

    const held = this.of(root)
    // Where the group itself sits now, rather than where the caller last saw it:
    // what was in it comes up to that, so a group inside a group leaves its rows
    // in the group it was in.
    const freed = held.find((one) => sameBookmark(one, mark))?.parent

    this.put(
      root,
      held
        .filter((one) => !sameBookmark(one, mark))
        .map((one) =>
          mark.kind === 'group' && one.parent === mark.path
            ? { ...one, ...(freed ? { parent: freed } : { parent: undefined }) }
            : one,
        )
        .map(({ kind, path, text, parent }) => ({
          kind,
          path,
          text,
          ...(parent ? { parent } : {}),
        })),
    )
  }

  /** Puts a bookmark in a group, or back at the top of the list.
   *
   *  A group cannot be put inside itself or inside anything it holds, which is
   *  the one arrangement that would be a list with no top. */
  moveInto(mark: Bookmark, parent: string | null) {
    const root = this.root()
    if (root === null) return
    if (parent !== null && mark.kind === 'group' && this.holds(mark.path, parent)) return

    this.put(
      root,
      this.of(root).map((one) =>
        sameBookmark(one, mark)
          ? { kind: one.kind, path: one.path, text: one.text, ...(parent ? { parent } : {}) }
          : one,
      ),
    )
  }

  /** A file or a folder that has been renamed or moved, with everything under it:
   *  every bookmark of it, of a heading or a block in it, or of anything inside a
   *  folder that moved goes with it. A bookmark keeps the path it was made with, so
   *  without this one pointed at a name nothing answered to and its row was gone.
   *
   *  A bookmark that lands on one already held is the same bookmark twice, so only
   *  the first of the two stays. */
  moved(from: string, to: string) {
    const root = this.root()
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    const held = this.of(root)
    const next = held.map((one) => {
      if (!POINTS_AT_A_FILE.has(one.kind)) return one

      // A block bookmark names its note and the block together; the note is the
      // part in front of the `#`. See forBlock.
      const cut = one.kind === 'block' ? one.path.indexOf('#') : -1
      const file = cut === -1 ? one.path : one.path.slice(0, cut)
      if (file !== was && !file.startsWith(`${was}/`)) return one

      return { ...one, path: now + one.path.slice(was.length) }
    })

    if (sameList(held, next)) return
    this.put(
      root,
      next.filter((one, at) => next.findIndex((other) => sameBookmark(one, other)) === at),
    )
  }

  /** A space folder that has been renamed, which re-keys its list at once: it is
   *  kept under the root, and the root is what moved. */
  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  /** Whether a group holds another, however far down. */
  private holds(group: string, other: string): boolean {
    const held = this.list
    let at: string | undefined = other

    for (let steps = 0; at !== undefined && steps <= MOST_BOOKMARKS; steps++) {
      if (at === group) return true
      at = held.find((one) => one.kind === 'group' && one.path === at)?.parent
    }

    return false
  }

  forEntry(entry: { path: string; is_dir: boolean }): Bookmark | null {
    const root = this.root()
    if (root === null || !startsInside(root, entry.path)) return null

    return { kind: entry.is_dir ? 'folder' : 'note', path: relativeTo(root, entry.path), text: '' }
  }

  /** One heading of a note, as a bookmark. `note` is already relative to the
   *  space, which is how the workspace names the note on screen. */
  forHeading(note: string | null, text: string): Bookmark | null {
    const words = text.trim()
    if (!note || !words) return null

    return { kind: 'heading', path: note, text: words }
  }

  /** A bookmark of one block of a note.
   *
   *  The path is the whole of what a link into it would say - `Plan.md#^a1b2c3` -
   *  because that is what opening it needs, and the text is the block's own first
   *  words, because `^a1b2c3` is not something anybody can read in a list. The
   *  editor makes both: it is what knows how to name a block; see blockTarget. */
  forBlock(note: string | null, target: string, words: string): Bookmark | null {
    const said = target.trim()
    const label = words.trim()
    if (!note || !said.startsWith('#')) return null

    return { kind: 'block', path: `${note}${said}`, text: label || said }
  }

  forSearch(query: string): Bookmark | null {
    const words = query.trim()
    return words ? { kind: 'search', path: '', text: words } : null
  }

  /** The graph as it is set right now, under a name: a view to come back to.
   *
   *  The space already remembers how its graph is drawn, which is what makes the
   *  graph a command rather than something to open. This is the other half of
   *  that: more than one way to look at the same space - the whole of it, one
   *  project, what nothing links to - without setting the card up again each
   *  time. Null for a name with nothing in it or a view too long to keep, which
   *  is a view nobody wrote by hand. */
  forGraph(name: string, settings: unknown): Bookmark | null {
    const words = name.trim()
    if (!words) return null

    const view = JSON.stringify(settings)
    if (view.length > LONGEST_VIEW) return null

    return { kind: 'graph', path: '', text: words, view }
  }

  /** Takes over what the account holds for one space, and answers with the list
   *  the account should be told about: this machine's own bookmarks the first
   *  time an account sees the space, nothing on the passes after that. */
  adopt(root: string, theirs: Bookmark[], accountId: string): Bookmark[] | null {
    // Read rather than trusted: the service is deployed on its own, so a build
    // of it older than this app answers with no bookmarks at all.
    const account = bookmarkList(theirs)
    const held = this.spaces[root]
    const first = held?.account !== accountId
    const list = first ? mergeBookmarks(account, held?.list ?? []) : account

    if (held && !first && sameList(held.list, list)) return null

    this.spaces = { ...this.spaces, [root]: { list, account: accountId } }
    this.write()

    return first && list.length > account.length ? list : null
  }

  /** Turns the pins an older build kept into bookmarks. Silent, and once: a
   *  pinned note simply is a bookmarked one now. */
  migrate(roots: readonly string[]) {
    const pins = stringList(stored(PINNED_KEY))
    if (!pins) return

    // Dropped whatever comes of it, so a pin that belonged to no space still
    // here does not have this run again on every launch.
    forget(PINNED_KEY)

    const next = { ...this.spaces }
    for (const [root, pinned] of Object.entries(bookmarksFromPins(pins, roots))) {
      const kept = next[root]
      next[root] = {
        list: mergeBookmarks(kept?.list ?? [], pinned),
        account: kept?.account ?? null,
      }
    }

    this.spaces = next
    this.write()
  }

  private put(root: string, list: Bookmark[]) {
    this.spaces = { ...this.spaces, [root]: { list, account: this.spaces[root]?.account ?? null } }
    this.write()

    // Imported here rather than at the top: syncing reads the workspace this
    // store belongs to, and the two would import each other. Kept rather than
    // dropped, so the offer is something that can be waited for; nothing has to.
    this.offered = import('../sync.svelte').then(({ sync }) => sync.pushBookmarks(root))
  }

  private write() {
    // Through `keep`, which cannot throw: this is reached from inside a syncing
    // pass, and a storage that is full would otherwise end the pass rather than
    // cost this machine one remembered list; see stored.ts.
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
