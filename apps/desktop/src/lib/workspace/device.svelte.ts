/** What this machine remembers about the file list, as opposed to what the
 *  notes themselves say.
 *
 *  Which folders are open, which notes were opened lately, and the icon each
 *  space wears: all of it describes a view rather than a note, so it stays on
 *  the device and never travels with the account - with one exception, the
 *  icons, which the account does carry so a space looks the same on every
 *  machine. The rest is keyed by path, and a path is only meaningful on the
 *  machine that holds the folder.
 *
 *  The bookmarks above the file list started out here as pins and are next
 *  door now, in bookmarks.svelte.ts: they say what someone chose to keep, not
 *  how this machine happens to be looking at it, so they follow the account.
 *
 *  Kept out of the tree component because that one is rebuilt from scratch
 *  every time the folder is read again - on every save, rename and sync - and
 *  took the open folders with it each time. */

import {
  forget,
  isBoolean,
  isNumber,
  isString,
  keep,
  recordOf,
  stored,
  stringList,
} from '../stored'
import { without, withOrWithout } from '../records'
import { FIRST_MODE, isSortMode, type SortMode } from '../tree-order'

export const RECENT_KEY = 'nib:recent'
export const ICONS_KEY = 'nib:icons'
/** The colour each of those icons is drawn in. Its own key rather than a second
 *  field in the one above, because that map is a map of strings that older builds
 *  read and write back, and a value that is not a string is a value they drop. */
export const ICON_TINTS_KEY = 'nib:icon-tints'
export const EXPANDED_KEY = 'nib:expanded'
/** How far down the file list each space was left. Not exported, unlike the keys
 *  around it: nothing outside this file names it. */
const LIST_AT_KEY = 'nib:list-at'
/** Which order each space's file list is read in. Not exported for the same reason
 *  the one above is not. */
const LIST_ORDER_KEY = 'nib:list-order'
export const TAGS_KEY = 'nib:expanded-tags'
/** Which groups of bookmarks are open. Not exported, unlike the two above it:
 *  nothing outside this file names it, and the one place that lists these keys
 *  is the glasses plugin's own, which this is small enough to travel to. */
const GROUPS_KEY = 'nib:expanded-groups'

/** Enough that a note opened this morning is still there, short enough that
 *  the list is worth reading. */
const RECENT_LIMIT = 15

/** How long a scroll has to have stopped before where it stopped is written down.
 *  Long enough that a flick costs one write rather than sixty. */
const SETTLING = 400

export class DeviceView {
  /** Most recent first, no duplicates. */
  recent = $state<string[]>([])

  /** Which folders are open, by path. */
  expanded = $state<Record<string, boolean>>({})

  /** How far down the file list each space was left, in pixels, by the space's
   *  own folder. The same kind of fact as which notes are open: where somebody is
   *  looking this afternoon, on this machine, and no business of the account's.
   *
   *  Kept so a space of three thousand notes comes back to the row it was left on.
   *  It always could have been - the list is one column and a number of pixels - and
   *  it matters more now that the rows in view are the only rows there are: the
   *  window is arithmetic off this number, so restoring it costs one assignment
   *  rather than a wait for three thousand rows to exist. */
  listScroll = $state<Record<string, number>>({})

  /** Which order each space's file list is read in, by the space's own folder.
   *
   *  On the machine rather than on the account, and per space rather than for the
   *  app: the same two decisions the scroll above already embodies. Whether a space
   *  reads by name or by age is how somebody is looking at it this afternoon - a
   *  space of meeting notes wants the newest first and a space of chapters wants
   *  them in the order somebody arranged - and a phone and a desktop can honestly
   *  disagree about it, the way they disagree about which folders are open.
   *
   *  What the arranged order itself is, on the other hand, is a fact about the
   *  notes and follows the account; see workspace/arranged.svelte.ts. */
  listOrder = $state<Record<string, SortMode>>({})

  /** Which tags are open, by tag path. Its own record rather than a share of the
   *  one above: a tag `work/nib` and a folder called `work/nib` are two
   *  different things to open, and one would otherwise open the other. */
  expandedTags = $state<Record<string, boolean>>({})
  /** Which groups of bookmarks are open, by the group's own name. */
  expandedGroups = $state<Record<string, boolean>>({})

  /** The icon a space wears, keyed by folder rather than by id so it survives
   *  the ids being handed out again on the next launch. */
  icons = $state<Record<string, string>>({})

  /** And the colour it is drawn in, where somebody chose one: the same keys, and
   *  empty for every space that wears its icon in the plain foreground. */
  iconTints = $state<Record<string, string>>({})

  /** The timer waiting to write the scroll positions down, or null while none is. */
  private writing: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.reread()
  }

  /** Reads all four out of storage.
   *
   *  Called again by the plugin, which is why it is a method at all. Emil, on his
   *  phone: *"I don't see the icons of the spaces on the Even Realities plugin right
   *  now."* The storage a packed plugin reads is not the page's own - a fresh port
   *  every launch, so the page's own is always empty - and the one that replaces it
   *  is seeded in two goes: a cookie, at once, with what decides the first paint,
   *  and the phone app's own store, seconds later, with everything. A field
   *  initialiser reads once and reads early, and what it read was the empty one.
   *
   *  Reading again rather than the store telling this: what the second seeding does
   *  is fill in keys nothing has written this launch, so what storage says and what
   *  this holds cannot disagree - see `fillFrom` in lib/even/local.ts. */
  reread(): void {
    this.recent = stringList(stored(RECENT_KEY)) ?? []
    this.expanded = recordOf(stored(EXPANDED_KEY), isBoolean)
    this.listScroll = recordOf(stored(LIST_AT_KEY), isNumber)
    this.listOrder = recordOf(stored(LIST_ORDER_KEY), isSortMode)
    this.expandedTags = recordOf(stored(TAGS_KEY), isBoolean)
    this.expandedGroups = recordOf(stored(GROUPS_KEY), isBoolean)
    this.icons = recordOf(stored(ICONS_KEY), isString)
    this.iconTints = recordOf(stored(ICON_TINTS_KEY), isString)
  }

  remember(path: string) {
    this.recent = [path, ...this.recent.filter((entry) => entry !== path)].slice(0, RECENT_LIMIT)
    keep(RECENT_KEY, JSON.stringify(this.recent))
  }

  forgetRecent() {
    this.recent = []
    forget(RECENT_KEY)
  }

  isExpanded(path: string): boolean {
    return this.expanded[path] === true
  }

  toggleFolder(path: string) {
    this.expanded = this.isExpanded(path)
      ? without(this.expanded, path)
      : { ...this.expanded, [path]: true }

    keep(EXPANDED_KEY, JSON.stringify(this.expanded))
  }

  /** Which groups of bookmarks are open, by the group's own name. Its own record
   *  rather than a share of the folders', for the reason the tags have one: a
   *  group and a folder can be called the same thing and mean nothing to each
   *  other. */
  isGroupOpen(id: string): boolean {
    return this.expandedGroups[id] === true
  }

  toggleGroup(id: string) {
    this.expandedGroups = this.isGroupOpen(id)
      ? without(this.expandedGroups, id)
      : { ...this.expandedGroups, [id]: true }
    keep(GROUPS_KEY, JSON.stringify(this.expandedGroups))
  }

  /** How far down the list this space was left, or zero for one never scrolled. */
  listAt(root: string): number {
    return this.listScroll[root] ?? 0
  }

  /** Where the list is now. Written to storage on a trailing timer rather than on
   *  every scroll event: the number changes sixty times a second under a finger,
   *  and what has to survive is where the scrolling stopped. */
  setListAt(root: string, at: number) {
    const round = Math.max(0, Math.round(at))
    if (this.listScroll[root] === round) return

    this.listScroll = { ...this.listScroll, [root]: round }
    if (this.writing !== null) return

    this.writing = setTimeout(() => {
      this.writing = null
      keep(LIST_AT_KEY, JSON.stringify(this.listScroll))
    }, SETTLING)
  }

  /** Which order this space's list is read in. By name until somebody says
   *  otherwise, which is what the list has always done. */
  orderOf(root: string): SortMode {
    return this.listOrder[root] ?? FIRST_MODE
  }

  /** The order chosen for one space. Written on the spot: it is one press in a
   *  menu, and the list is redrawn from what is already in memory rather than read
   *  off the disk again. */
  setOrder(root: string, mode: SortMode) {
    if (this.orderOf(root) === mode) return

    // The default is what no entry already means, so choosing it again takes the
    // entry away rather than freezing today's default into this machine.
    this.listOrder =
      mode === FIRST_MODE ? without(this.listOrder, root) : { ...this.listOrder, [root]: mode }
    keep(LIST_ORDER_KEY, JSON.stringify(this.listOrder))
  }

  /** Carries a chosen order over to a renamed space folder, the way the icon is
   *  carried: the record is keyed by the folder, and the folder is what moved. */
  moveOrder(from: string, to: string) {
    const mode = this.listOrder[from]
    if (!mode || from === to) return

    this.listOrder = { ...without(this.listOrder, from), [to]: mode }
    keep(LIST_ORDER_KEY, JSON.stringify(this.listOrder))
  }

  isTagOpen(path: string): boolean {
    return this.expandedTags[path] === true
  }

  toggleTag(path: string) {
    this.expandedTags = this.isTagOpen(path)
      ? without(this.expandedTags, path)
      : { ...this.expandedTags, [path]: true }

    keep(TAGS_KEY, JSON.stringify(this.expandedTags))
  }

  /** Opens a folder without closing one that is already open: making a note
   *  inside a closed folder should show it. */
  expand(path: string) {
    if (this.isExpanded(path)) return
    this.toggleFolder(path)
  }

  iconOf(root: string): string | null {
    return this.icons[root] ?? null
  }

  /** The colour that icon is drawn in, or null for the plain foreground. */
  tintOf(root: string): string | null {
    return this.iconTints[root] ?? null
  }

  setIcon(root: string, name: string | null, tint: string | null = null) {
    this.writeIcons(withOrWithout(this.icons, root, name))
    this.writeTints(withOrWithout(this.iconTints, root, name === null ? null : tint))
  }

  /** An icon and its colour as the account holds them. Answers with the colour this
   *  machine holds and the account does not, which is what asks for it to be sent
   *  up, or null when there is nothing to say.
   *
   *  The account is the one copy of both: it is what makes a space look like itself
   *  on a second machine, so a colour changed or taken off elsewhere lands here. The
   *  one thing that is not the account's to say is a colour it has no column for -
   *  `undefined` rather than null, which is what a build of the service older than
   *  the colours answers with. Then what is here stays and is handed back to be sent
   *  up; reading that silence as "no colour" would undress every space that had been
   *  dressed on this machine. */
  applyIcon(root: string, name: string | null, tint?: string | null): string | null {
    const mine = this.tintOf(root)
    const said = tint !== undefined
    const colour = said ? tint : mine
    const unsaid = said || name === null ? null : mine

    if (this.iconOf(root) !== name || mine !== colour) this.setIcon(root, name, colour)

    return unsaid
  }

  /** Carries a chosen icon over to a renamed folder. Without this a rename
   *  looks like a space that never had an icon, and it falls back to a letter. */
  moveIcon(from: string, to: string) {
    const icon = this.icons[from]
    if (!icon || from === to) return

    this.writeIcons({ ...without(this.icons, from), [to]: icon })

    const tint = this.iconTints[from]
    if (tint) this.writeTints({ ...without(this.iconTints, from), [to]: tint })
  }

  private writeIcons(next: Record<string, string>) {
    this.icons = next
    keep(ICONS_KEY, JSON.stringify(next))
  }

  private writeTints(next: Record<string, string>) {
    this.iconTints = next
    keep(ICON_TINTS_KEY, JSON.stringify(next))
  }
}
