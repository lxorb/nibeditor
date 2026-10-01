/** Everything the palette can find, as candidates for rank.ts: the open tabs, the
 *  files of the space, the bookmarks, the commands, the pages of this device's
 *  history and the settings.
 *
 *  **One row per place to go**, which is Chrome's rule for its omnibox: a note that is
 *  open is its tab, switched to rather than opened a second time; a page that is open
 *  is its tab too; a bookmark of a note is that note, a little higher, rather than a
 *  second row saying the same thing. So the list never offers two ways to the same
 *  place and asks somebody to guess which is which.
 *
 *  Built once each time the palette opens, not per keystroke: every name is folded
 *  here, and everything the ranking weighs besides the words - how much a thing is
 *  used, and where the reader is - is worked out here too. Pure: the palette hands in
 *  what the stores hold. */

import { foldName } from '@nib/markdown/links'
import type { Command } from '../commands'
import { fileMark } from '../file-mark'
import { shownName, rowName } from '../note-name'
import { folderOf, insideSpace, relativeTo, withinSpace } from '../space-paths'
import { frecency as visitWeight, shownAddress } from '../web-tab/omnibox'
import type { Visit } from '../web-tab/visits'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import type { TabKind } from '../workspace/documents.svelte'
import type { Entry } from '../workspace.svelte'
import type { Candidate, Kind } from './rank'
import type { OpenTab, Row } from './rows'
import type { Setting } from './settings'

/** What the stores hold, handed in. */
export interface World {
  root: string
  files: readonly Entry[]
  tabs: readonly OpenTab[]
  /** The tab in front, and what kind of thing it holds. */
  active: string | null
  focused: TabKind | null
  /** The notes opened lately, newest first. */
  recent: readonly string[]
  bookmarks: readonly Bookmark[]
  commands: readonly Command[]
  pages: readonly Visit[]
  settings: readonly Setting[]
  /** How much a key has been used; see frecency.ts. */
  worth: (key: string) => number
  now: number
}

/** Part 5 of rank.ts, as points. */
const LIFT = {
  /** A note somebody bookmarked is one they meant to come back to. */
  bookmarked: 6,
  /** The notes opened lately, the latest most: frecency's own curve is only as old
   *  as this version, and the list of recent notes is older. */
  recent: 8,
  /** The tab already in front is the one place nobody is looking to go. */
  here: -24,
  /** A command that cannot run right now is still listed, faded, below the rest. */
  unavailable: -30,
  /** A command about the kind of tab in front: the page's own when a page is. */
  about: 12,
}

const noteKey = (path: string) => `note:${path}`
const pageKey = (url: string) => `page:${url}`

/** An address as the history shows it, or as it came where it is not one. */
function addressOf(url: string): string {
  try {
    return shownAddress(url)
  } catch {
    // Not an address `URL` can read - a page still arriving - so it is shown as it is.
    return url
  }
}

/** The key a tab is used under: its file's where it has one, so a note is the same
 *  thing open or not, else its page's, else the tab itself. */
function tabKey(tab: OpenTab): string {
  return tab.path ? noteKey(tab.path) : tab.url ? pageKey(tab.url) : `tab:${tab.id}`
}

/** What frecency.ts counts a row's uses under, or null for a row that is not a
 *  thing to come back to: a place in the note in front, a note not made yet, an
 *  address typed (which the history counts once it is a page). */
export function rowKey(row: Row): string | null {
  switch (row.kind) {
    case 'note':
      return noteKey(row.entry.path)
    case 'tab':
      return tabKey(row.tab)
    case 'command':
      return `command:${row.command.id}`
    case 'page':
      return pageKey(row.url)
    case 'setting':
      return `setting:${row.setting.section}/${row.setting.label}`
    case 'bookmark':
      return `bookmark:${row.mark.kind}:${row.mark.path}#${row.mark.text}`
    case 'place':
    case 'make':
    case 'address':
      return null
  }
}

/** What a candidate is made of besides its name: its other names and what else it
 *  is found by (see part 1 of rank.ts), where the reader is (part 5), and any use it
 *  has had that frecency.ts does not count (part 4). */
interface Readings {
  names?: readonly string[]
  also?: readonly string[]
  lift?: number
  more?: number
}

function candidate(
  kind: Kind,
  name: string,
  item: Row,
  world: World,
  { names = [], also = [], lift = 0, more = 0 }: Readings = {},
): Candidate<Row> {
  const key = rowKey(item)
  const fold = (list: readonly string[]) => list.filter(Boolean).map(foldName)

  return {
    key,
    kind,
    name: foldName(name),
    names: fold(names),
    also: fold(also),
    lift,
    use: (key ? world.worth(key) : 0) + more,
    item,
  }
}

/** A site's host, which it is known by as much as by its title. */
const hostOf = (address: string) => address.split('/')[0] ?? address

/** What a note's row is made of that its entry alone decides: the name it shows, its
 *  folder, and both folded the way the ranking reads them.
 *
 *  Kept per entry, because the palette builds its rows again whenever anything it
 *  lists changes while it is open - a pass of sync, a file another program wrote, a
 *  note saved - and on five thousand notes that was fourteen milliseconds of folding
 *  names that had not changed. The tree is replaced rather than edited (see
 *  `$state.raw` in workspace.svelte.ts), so an entry that is the same object is the
 *  same file under the same name, and only what changed is read again. Weak, so a
 *  space closed takes its readings with it. */
interface Reading {
  /** The space the folder was read against. */
  root: string
  key: string
  /** The shown name in lower case, which is what two notes share. */
  alike: string
  folder: string | null
  name: string
  also: string[]
}

const readings = new WeakMap<Entry, Reading>()

function readingOf(entry: Entry, root: string): Reading {
  const kept = readings.get(entry)
  if (kept?.root === root) return kept

  const shown = shownName(entry.name)
  const relative = relativeTo(root, entry.path)
  const reading: Reading = {
    root,
    key: noteKey(entry.path),
    alike: shown.toLowerCase(),
    folder: folderOf(relative) || null,
    name: foldName(shown),
    also: [shownName(relative)].filter(Boolean).map(foldName),
  }
  readings.set(entry, reading)
  return reading
}

/** How many notes share each name, so a row says its folder only where the name
 *  alone would not do. Asked with the name as a reading has it: shown, in lower case. */
function sharing(files: readonly Entry[], root: string): (alike: string) => boolean {
  const named = new Map<string, number>()
  for (const one of files) {
    const { alike } = readingOf(one, root)
    named.set(alike, (named.get(alike) ?? 0) + 1)
  }

  return (alike) => (named.get(alike) ?? 0) > 1
}

/** The files with the ones opened lately first, newest first, and the rest in the
 *  order the space lists them: what a stable sort by recency gives, without sorting
 *  every file of the space to move a handful to the front. */
function recentFirst(files: readonly Entry[], place: ReadonlyMap<string, number>): Entry[] {
  const lately: Entry[] = []
  const rest: Entry[] = []
  for (const entry of files) (place.has(entry.path) ? lately : rest).push(entry)

  lately.sort((a, b) => (place.get(a.path) ?? 0) - (place.get(b.path) ?? 0))
  return [...lately, ...rest]
}

export function candidates(world: World): Candidate<Row>[] {
  const out: Candidate<Row>[] = []
  const shared = sharing(world.files, world.root)
  const place = new Map(world.recent.map((path, index) => [path, index]))
  const recency = (path: string) => {
    const at = place.get(path)
    return at === undefined ? 0 : LIFT.recent * (1 - at / Math.max(world.recent.length, 1))
  }

  const marked = new Set(
    world.bookmarks
      .filter((one) => one.kind === 'note')
      .map((one) => insideSpace(world.root, one.path)),
  )
  const lifted = (path: string) => recency(path) + (marked.has(path) ? LIFT.bookmarked : 0)

  // The open tabs, one per file or page. Every tab is in the list, the one in front
  // too, sunk: typing the name of the note one is in finds it, and it is not the
  // row Enter should take anybody to.
  const open = new Set<string>()
  const openPages = new Set<string>()
  for (const tab of world.tabs) {
    const key = tabKey(tab)
    if (open.has(key)) continue
    open.add(key)
    if (tab.url) openPages.add(tab.url)

    const relative = tab.path ? withinSpace(world.root, tab.path) : null
    const folder = relative ? folderOf(relative) || null : null
    out.push(
      candidate(
        'tab',
        tab.shown,
        { kind: 'tab', tab, folder, shared: shared(shownName(tab.shown).toLowerCase()) },
        world,
        {
          names: tab.url ? [hostOf(addressOf(tab.url))] : [],
          also: [relative ? shownName(relative) : '', tab.url ? addressOf(tab.url) : ''],
          lift: (tab.id === world.active ? LIFT.here : 0) + (tab.path ? lifted(tab.path) : 0),
        },
      ),
    )
  }

  // The files, the ones opened lately first so they win every tie. Built out of each
  // entry's reading rather than through `candidate`, which would fold every name again.
  for (const entry of recentFirst(world.files, place)) {
    const reading = readingOf(entry, world.root)
    if (open.has(reading.key)) continue

    out.push({
      key: reading.key,
      kind: 'note',
      name: reading.name,
      names: [],
      also: reading.also,
      lift: lifted(entry.path),
      use: world.worth(reading.key),
      item: { kind: 'note', entry, folder: reading.folder, shared: shared(reading.alike) },
    })
  }

  out.push(...bookmarkCandidates(world))

  for (const command of world.commands) {
    const lift =
      (command.disabled ? LIFT.unavailable : 0) +
      (world.focused && command.id.startsWith(`${world.focused}-`) ? LIFT.about : 0)
    out.push(candidate('command', command.label, { kind: 'command', command }, world, { lift }))
  }

  // A page counts its visits as well as the times it was chosen here: the history is
  // how often somebody went there, whichever way they went.
  for (const visit of world.pages) {
    if (openPages.has(visit.url)) continue

    const address = addressOf(visit.url)
    out.push(
      candidate(
        'page',
        visit.title || address,
        { kind: 'page', url: visit.url, title: visit.title || address, address },
        world,
        { names: [hostOf(address)], also: [address], more: visitWeight(visit, world.now) / 4 },
      ),
    )
  }

  // A setting whose name is a command's is reached by the command: Shortcuts is both.
  const commanded = new Set(world.commands.map((one) => foldName(one.label)))
  for (const setting of world.settings) {
    if (commanded.has(foldName(setting.label))) continue

    out.push(
      candidate('setting', setting.label, { kind: 'setting', setting }, world, {
        names: setting.names,
        also: [setting.where, ...setting.words],
      }),
    )
  }

  return out
}

/** The bookmarks that are more than a note: a heading, a block, a folder, a search, a
 *  view of the graph. A note's is the note's own row; a group is a shelf, not a place. */
function bookmarkCandidates(world: World): Candidate<Row>[] {
  const out: Candidate<Row>[] = []
  const files = new Map(world.files.map((one) => [one.path, one]))

  for (const mark of world.bookmarks) {
    if (mark.kind === 'note' || mark.kind === 'group') continue

    if (mark.kind === 'search' || mark.kind === 'graph') {
      out.push(
        candidate(
          'bookmark',
          mark.text,
          { kind: 'bookmark', mark, label: mark.text, note: null, path: null, file: null },
          world,
        ),
      )
      continue
    }

    // A block bookmark carries the whole of what a link into it would say, so the
    // note is the part in front of the `#`; see forBlock in bookmarks.svelte.ts.
    const inside = mark.kind === 'block' ? (mark.path.split('#')[0] ?? '') : mark.path
    const path = insideSpace(world.root, inside)
    const folder = mark.kind === 'folder'
    const entry = files.get(path)
    if (!entry && !folder) continue

    const name = entry ? shownName(entry.name) : rowName(inside.split('/').at(-1) ?? inside, true)
    const label = folder ? name : mark.text
    out.push(
      candidate(
        'bookmark',
        label,
        {
          kind: 'bookmark',
          mark,
          label,
          note: folder ? null : name,
          path,
          file: folder ? 'file' : fileMark(entry?.name ?? ''),
        },
        world,
        { also: [folder ? inside : name] },
      ),
    )
  }

  return out
}

/** The headings of the note in front, for the list of everything: there only when
 *  the words find one closely (see `STRONG` in rank.ts), since they are a place in
 *  this note rather than somewhere to go. `#` lists them alone. */
export function headingCandidates(
  headings: readonly { line: number; text: string; level: number }[],
  nested: boolean,
): Candidate<Row>[] {
  // Under `#` a heading sits under the one it belongs to, as in the outline; among
  // everything else it is a row like the rest.
  const top = Math.min(...headings.map((one) => one.level))

  return headings.map((one) => ({
    key: null,
    kind: 'heading',
    name: foldName(one.text),
    names: [],
    also: [],
    lift: 0,
    use: 0,
    item: {
      kind: 'place',
      line: one.line,
      text: one.text,
      depth: nested ? one.level - top : 0,
      hint: null,
    },
  }))
}

/** The rows of a field with nothing typed in it: whatever was reached for lately -
 *  the notes and the commands, and a setting or a page chosen here - newest first,
 *  then the notes opened lately that the curve has no time for yet, then the rest of
 *  the notes in the file list's order, so a new space's palette is not empty. The tab
 *  in front is left out: with nothing typed, Enter is the thing before it, the way
 *  Alt+Tab is the window before this one. */
export function resting(
  all: readonly Candidate<Row>[],
  world: Pick<World, 'recent' | 'active'>,
  last: (key: string) => number | null,
  most: number,
): Row[] {
  const here = (one: Candidate<Row>) => one.item.kind === 'tab' && one.item.tab.id === world.active

  const byKey = new Map<string, Candidate<Row>>()
  for (const one of all) {
    if (one.key && !here(one) && !byKey.has(one.key)) byKey.set(one.key, one)
  }

  const timed: { one: Candidate<Row>; at: number }[] = []
  for (const [key, one] of byKey) {
    const at = last(key)
    if (at !== null) timed.push({ one, at })
  }

  const out = new Set(timed.sort((a, b) => b.at - a.at).map(({ one }) => one))
  for (const path of world.recent) {
    const one = byKey.get(noteKey(path))
    if (one) out.add(one)
  }
  for (const one of all) {
    if (out.size >= most) break
    if (one.item.kind === 'note') out.add(one)
  }

  return [...out].slice(0, most).map((one) => one.item)
}
