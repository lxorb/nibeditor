/** The order the file list is read in, and the arithmetic of the one order that
 *  is nobody's rule but the reader's own.
 *
 *  Seven orders, one of them arranged by hand. Six are a key and a direction - a
 *  name, the last time a note was written in, the moment it was made, each either
 *  way round - and the seventh is a list of names somebody dragged into the order
 *  they wanted. Folders come first in the six, because that is what every file
 *  manager and Obsidian itself do and a reader looking for a folder looks at the
 *  top; in the seventh the list is the answer and nothing comes first but what
 *  somebody put there. See `ordered`.
 *
 *  It is decided here rather than where the tree is read, which used to be the
 *  case: the listing off the disk is sorted in the Rust crate and the browser
 *  build sorts its own, so a third order - one the reader arranged, which no
 *  listing can know about - would have been the same rule written a third and a
 *  fourth time, in another language, shipped behind a three-platform build. So the
 *  listing simply arrives, in whatever order it arrives in, and one pass here says
 *  how it reads. Which also makes changing the order instant: it is no longer a
 *  question anybody has to ask the disk.
 *
 *  Everything here is pure and knows nothing about a space: where the arranged
 *  names are kept is workspace/arranged.svelte.ts, which holds them per space and
 *  syncs them with the account the way a folder's icon does.
 *
 *  The comparator and nothing else. Working out where a row lands when somebody drops
 *  it, and what a folder then keeps, is tree-arranging.ts, which is fetched by the
 *  first drag: every window pays for this file before it draws a row, and only a
 *  window somebody rearranges pays for that one. See tree-lift.ts and lib/ai/ask.ts,
 *  which is the same seam. */

import type { Entry } from './workspace.svelte'

/** Which order the list is in. The value is written down, so these words are the
 *  ones an older and a newer build have to agree on; see `sortMode`. */
export type SortMode =
  | 'name'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc'
  | 'manual'

/** The seven, in the order the menu offers them. */
export const SORT_MODES: readonly SortMode[] = [
  'name',
  'name-desc',
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'manual',
]

/** The one a space is read in until somebody says otherwise. Emil: *"by name
 *  should be the default"*, which is also what the list has always done. */
export const FIRST_MODE: SortMode = 'name'

/** Whether this is a chosen order as it was written down. A build older than this
 *  one wrote `name` with a separate flag for the direction, and a newer one may
 *  write a word this build has never heard of; either way an unreadable value is
 *  one the reader falls back from. */
export function isSortMode(value: unknown): value is SortMode {
  return SORT_MODES.some((one) => one === value)
}

/** Names the way a reader reads them: `Note 2` before `Note 10`, and the case of
 *  the first letter no reason for one name to come before another.
 *
 *  The host's collation rather than the app's own language, because this is an
 *  order over file names on a disk and the file manager beside the app sorts them
 *  the same way. `numeric` is the whole point of asking ICU rather than comparing
 *  strings: a space of numbered notes read as text puts the tenth between the
 *  first and the second, which is wrong in every language.
 *
 *  Built once. A collator is expensive to make and a sort asks for thousands of
 *  comparisons. */
const READING = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** And the same again, with the case and the accents back, for the one thing the
 *  first cannot answer: `a.md` and `A.md` are one name to it, and two rows that
 *  compare equal sort in whatever order the engine happened to have them in. A
 *  file list that reorders itself between two reads of the same folder is worse
 *  than one with an opinion about capitals. */
const EXACTLY = new Intl.Collator(undefined, { numeric: true })

export function byName(one: string, other: string): number {
  const said = READING.compare(one, other)
  if (said !== 0) return said

  const exact = EXACTLY.compare(one, other)
  if (exact !== 0) return exact

  // Two names ICU calls identical and that are not the same string: the code
  // points settle it, so the answer is the same on every machine.
  return one < other ? -1 : one > other ? 1 : 0
}

/** What an order asks of a row when it is not asking for a time: the name, and
 *  whether the row holds notes. */
export interface Row {
  readonly name: string
  readonly is_dir: boolean
}

/** Where a row sits when nobody has said: folders first, then by name.
 *
 *  Which is the order every other mode reads, and so the one a hand-arranged folder
 *  falls back to for the rows its list says nothing about. Choosing Manual therefore
 *  changes nothing on the screen until somebody moves a row, and a note made this
 *  afternoon in a folder arranged last week lands where the reader would look for
 *  it rather than above the folders. */
export function byDefault(one: Row, other: Row): number {
  if (one.is_dir !== other.is_dir) return one.is_dir ? -1 : 1

  return byName(one.name, other.name)
}

/** The time an order reads, and which way round, for the four that read one.
 *  Null for the two name orders and for `manual`, which is a list rather than a
 *  key. */
const TIMES: Partial<Record<SortMode, { of: (entry: Entry) => number; back: boolean }>> = {
  'modified-desc': { of: (entry) => entry.modified, back: true },
  'modified-asc': { of: (entry) => entry.modified, back: false },
  'created-desc': { of: (entry) => entry.created, back: true },
  'created-asc': { of: (entry) => entry.created, back: false },
}

/** Where each arranged name sits, by name. A map read within one call: nothing
 *  renders from it. */
function placesIn(listed: readonly string[]): Map<string, number> {
  const at = new Map<string, number>()
  for (const [index, name] of listed.entries()) if (!at.has(name)) at.set(name, index)
  return at
}

/** One group of a folder's children, in the order they are drawn.
 *
 *  A group is what `ordered` hands it: the folders and the files apart for the six
 *  read off a key, which is what makes "folders first" true of them rather than a
 *  rule the name order happens to obey, and the whole folder at once for the one
 *  somebody arranged. */
function group(entries: readonly Entry[], mode: SortMode, listed: readonly string[]): Entry[] {
  const out = [...entries]

  if (mode === 'manual') {
    const at = placesIn(listed)
    // A name the list has not heard of - a note written since, or one nobody ever
    // dragged - falls to the end in the order the list would have read in anyway,
    // which is why a folder nobody arranged keeps no list at all; see `trimmed`.
    const place = (entry: Entry) => at.get(entry.name) ?? Infinity
    out.sort((one, other) => place(one) - place(other) || byDefault(one, other))
    return out
  }

  const key = TIMES[mode]
  if (!key) {
    out.sort((one, other) => byName(one.name, other.name))
    return mode === 'name-desc' ? out.reverse() : out
  }

  // Ties by name, so two notes saved in the same second read the same way twice.
  // The names are not reversed with the times: a reader asking for the newest
  // first is asking about the times.
  const way = key.back ? -1 : 1
  out.sort((one, other) => way * (key.of(one) - key.of(other)) || byName(one.name, other.name))
  return out
}

/** One folder's children, in the order the list draws them.
 *
 *  Folders above files in every order but one. The exception is the order somebody
 *  arranged by hand: there the list is the answer, and a rule that quietly lifted
 *  every folder over it would be the app overruling the person who dragged the
 *  rows. Emil: *"for the manual ordering mode in explorer, it should not be
 *  enforced that directories display above files."*
 *
 *  So a hand-arranged folder is one group and the other six are two. Folders still
 *  come first where nobody has said otherwise - that is `byDefault`, the order the
 *  rows were already in - so choosing Manual moves nothing and only a drag does. */
export function ordered(
  children: readonly Entry[],
  mode: SortMode,
  listed: readonly string[],
): Entry[] {
  if (mode === 'manual') return group(children, mode, listed)

  const folders = children.filter((one) => one.is_dir)
  const files = children.filter((one) => !one.is_dir)

  return [...group(folders, mode, listed), ...group(files, mode, listed)]
}

/** The names of one folder's children, in the order the list draws them. What the
 *  drag counts its gaps in. */
export function shownNames(
  children: readonly Entry[],
  mode: SortMode,
  listed: readonly string[],
): string[] {
  return ordered(children, mode, listed).map((one) => one.name)
}

/** The whole tree in that order, folder by folder, however deep.
 *
 *  `listOf` is asked for a folder's arranged names by the folder's own path, so
 *  the store that holds them is the one thing that has to know what a path means.
 *  Answered with a new tree only where a folder's children actually moved, so an
 *  order nothing changed costs no reactive churn downstream. */
export function orderedTree(
  tree: Entry,
  mode: SortMode,
  listOf: (folder: string) => readonly string[],
): Entry {
  const here = ordered(tree.children, mode, listOf(tree.path))
  const children = here.map((child) => (child.is_dir ? orderedTree(child, mode, listOf) : child))

  const same =
    children.length === tree.children.length &&
    children.every((child, at) => child === tree.children[at])

  return same ? tree : { ...tree, children }
}

/** The list with one name written the way it is now called, or null where the
 *  list had nothing to say about it.
 *
 *  Null rather than the list back, so a rename in a folder nobody arranged costs
 *  no write and no sync: almost every rename is one of those. */
export function renamedIn(listed: readonly string[], from: string, to: string): string[] | null {
  if (!listed.includes(from)) return null

  const out: string[] = []
  for (const name of listed) {
    const now = name === from ? to : name
    // A rename onto a name the list already arranged leaves one row, and the
    // renamed row's place is the one that stands: it is the one somebody just
    // acted on.
    if (!out.includes(now)) out.push(now)
  }

  return out
}

/** The list without one name, or null where it never held it. */
export function withoutName(listed: readonly string[], name: string): string[] | null {
  if (!listed.includes(name)) return null

  return listed.filter((one) => one !== name)
}
