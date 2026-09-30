/** The icons the folders of a space wear, where those folders have no note.
 *
 *  A note keeps its icon in its own front matter and a canvas under its `nib`
 *  key, which is what makes those icons the file's: they travel with it, into
 *  another vault and into Obsidian. A folder that holds a note of its own name is
 *  drawn as that note and keeps its icon there like any other note; what is left
 *  for this map is a folder that has no such note - one out of somebody's vault -
 *  which has no file anywhere to keep an icon in. See folder-notes.ts,
 *  chosen-icon.ts and docs/tree.md.
 *
 *  A dotfile in the folder would sync for free and survive a move without being
 *  told - but it puts a file in every folder somebody gave an icon to, and every
 *  other tool that walks the vault sees it. So the icon is kept beside the space
 *  instead.
 *
 *  So: one map per space, from the folder's path as the space speaks it to the
 *  icon's name, and a second map under the same keys for the colour each of those
 *  icons is drawn in. Nothing is added to anybody's folders, the maps are the size
 *  of what was chosen rather than of the space, and they go where the space's other
 *  settings already go - the account for a space the account knows, this machine
 *  for one it does not. A rename or a move rewrites the key, which is the one
 *  thing the dotfile would have got for free; see `moved`.
 *
 *  Paths are relative and `/`-separated, never a path on this disk, for the same
 *  reason a bookmark is: the map travels between machines, and one of them is
 *  Windows. `nib:bookmarks` is this store's twin in every respect, down to
 *  remembering which account a space's map has been folded into. */

import { insideItsSpace, relativeTo } from '../space-paths'
import { isRecord, isString, keep } from '../stored'
import {
  filledIn,
  type Folded,
  type Folding,
  meet,
  readSpaces,
  without,
  withOrWithout,
} from '../records'

export const STORAGE_KEY = 'nib:folder-icons'

/** How many folders of one space may wear an icon.
 *
 *  Higher than the bookmark limit by a lot, because these are not a list somebody
 *  reads: a big vault has hundreds of folders and no reason not to mark them all.
 *  The service holds an account to the same number, so a map that fits here fits
 *  there. */
export const MOST_FOLDER_ICONS = 400

/** How long an icon's name may be. The service's limit, so nothing is kept here
 *  that would be refused there; the path's own limit is `insideItsSpace`. */
const LONGEST_NAME = 64

/** How long after the last choice the account is told, in milliseconds. The number
 *  the graph settings wait, and for the reason they wait at all: the colours are
 *  picked off a row of dots, and somebody trying four of them is four requests
 *  otherwise, every one of them out of date before it lands. The tree and this
 *  machine's storage are written on the spot either way; it is only the account that
 *  catches up. Short enough that closing the window straight after does not lose
 *  it. */
const SETTLING = 700

/** The map in an unknown, with whatever is not a folder and an icon left out.
 *  Written by a newer build, by an older one, or by hand: what reads as a pair is
 *  kept and the rest is dropped, the way every other store here reads itself. */
export function folderIconMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [path, name] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_FOLDER_ICONS) break
    if (!insideItsSpace(path) || !isString(name)) continue

    const said = name.trim()
    if (said && said.length <= LONGEST_NAME) out[path] = said
  }

  return out
}

/** One space's map, and which account it has already been reconciled with. */
interface Kept extends Folded {
  icons: Record<string, string>
  /** The colour each stroked icon is drawn in, where one was chosen. A second map
   *  rather than a second field on each entry, because the first is a map of strings
   *  that builds older than this one read and write back whole, and a value that is
   *  not a string is a value they drop. The account holds both, under the same keys;
   *  see spaces/icons.ts in the service. */
  colors: Record<string, string>
  /** Whether the account has heard what is here. False for a push that did not
   *  land - offline, a token that had expired, a Worker that was being deployed -
   *  and then the next pass keeps this machine's maps and sends them again instead
   *  of taking the account's word for a choice the account never heard. Written
   *  down rather than held in memory, because the laptop somebody chose a colour on
   *  is the laptop they then shut. */
  sent: boolean
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({
    icons: folderIconMap(one.icons),
    colors: folderIconMap(one.colors),
    // Anything but a false written by this build reads as said: a record an older
    // one wrote back has no such field, and what it holds did reach the account.
    sent: one.sent !== false,
  }))
}

/** Two maps as one. */
function same(one: Record<string, string>, other: Record<string, string>): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}

/** The two maps travel together and are adopted together: they are written by one
 *  gesture and sent in one request, so a pass that took one and left the other would
 *  draw an icon in last week's colour. Folded folder by folder, this machine's
 *  choice winning where both made one. */
const MAPS: Folding<Pick<Kept, 'icons' | 'colors'>> = {
  fold: (theirs, mine) => ({
    icons: { ...theirs.icons, ...mine.icons },
    colors: { ...theirs.colors, ...mine.colors },
  }),
  same: (one, other) => same(one.icons, other.icons) && same(one.colors, other.colors),
}

export class FolderIcons {
  private spaces = $state<Record<string, Kept>>(read())
  /** A push waiting for the choosing to stop, per space. Bookkeeping rather than
   *  state: nothing on screen is drawn from it. */
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}

  /** Which space the rows on screen belong to. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** Reads the map again, once the storage that holds it has answered.
   *
   *  For the plugin. This map is one entry per folder somebody gave an icon to, so it
   *  grows with the vault rather than with the settings, and a packed plugin keeps
   *  anything that shape in the phone app's own store - which answers seconds after
   *  this store was built and read an empty one. See lib/even/local.ts, and `reread`
   *  in device.svelte.ts, which is the same fact about the same storage. Filled in
   *  per space, never replaced; see `filledIn` in records.ts. */
  reread(): void {
    const grown = filledIn(this.spaces, read())
    if (grown) this.spaces = grown
  }

  of(root: string): Record<string, string> {
    return this.spaces[root]?.icons ?? {}
  }

  private colorsOf(root: string): Record<string, string> {
    return this.spaces[root]?.colors ?? {}
  }

  /** What the folder at this path wears, as written, or null where it wears
   *  nothing.
   *
   *  Takes a path as the app holds one or as the space speaks it, because the
   *  surfaces that show a folder disagree: a row in the tree knows where the
   *  folder is on the disk, and a bookmark or a Move sheet knows it relative to
   *  the space. The same two readings `links.iconOf` takes. */
  iconOf(path: string): string | null {
    const root = this.root()
    if (root === null) return null

    return this.of(root)[relativeTo(root, path)] ?? null
  }

  /** The colour that folder's icon is drawn in, or null for the plain foreground. */
  tintOf(path: string): string | null {
    const root = this.root()
    if (root === null) return null

    return this.colorsOf(root)[relativeTo(root, path)] ?? null
  }

  /** Writes the icon a folder wears and the colour it is drawn in, or takes both
   *  away when `name` is null. */
  set(path: string, name: string | null, tint: string | null = null) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    if (!insideItsSpace(at)) return

    const held = this.of(root)
    const colour = name === null ? null : tint
    if ((held[at] ?? null) === name && (this.colorsOf(root)[at] ?? null) === colour) return
    if (name !== null && Object.keys(held).length >= MOST_FOLDER_ICONS && !(at in held)) return

    this.put(root, withOrWithout(held, at, name), withOrWithout(this.colorsOf(root), at, colour))
  }

  /** A folder that has been renamed or moved, with everything under it.
   *
   *  The one thing a dotfile inside the folder would have got for free, and the
   *  reason every path that changes has to say so: a key nobody rewrote is an
   *  icon that quietly stops being drawn. Called from the same three places
   *  `positions.move` is - a rename, a move, and the undo of either. */
  moved(from: string, to: string, root = this.root()) {
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)

    const rekeyed = (held: Record<string, string>) => {
      const next: Record<string, string> = {}
      let touched = false

      for (const [path, name] of Object.entries(held)) {
        const under = path === was || path.startsWith(`${was}/`)
        next[under ? now + path.slice(was.length) : path] = name
        touched ||= under
      }

      return touched ? next : null
    }

    const icons = rekeyed(this.of(root))
    if (icons) this.put(root, icons, rekeyed(this.colorsOf(root)) ?? this.colorsOf(root))
  }

  /** A folder that has gone, with everything under it. */
  gone(path: string, root = this.root()) {
    if (root === null) return

    const at = relativeTo(root, path)
    const held = this.of(root)
    const kept = (map: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(map).filter(([one]) => one !== at && !one.startsWith(`${at}/`)),
      )

    const next = kept(held)
    if (Object.keys(next).length !== Object.keys(held).length) {
      this.put(root, next, kept(this.colorsOf(root)))
    }
  }

  /** A space folder that has been renamed, which re-keys the whole map at once:
   *  the map is kept under the root, and the root is what moved. */
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

  /** Takes over what the account holds for one space: this machine's own icons
   *  folded in the first time an account sees the space, and the account's map
   *  outright on every pass after that.
   *
   *  After the first contact the account holds the one copy, because a union run
   *  on every pass would hand back an icon another machine had deliberately taken
   *  away. Exactly what `bookmarks.adopt` does, and for the same reason. What the
   *  fold added is sent straight back up, so the account has it before the machine
   *  that had it is closed. */
  adopt(root: string, theirs: unknown, theirTints: unknown, accountId: string) {
    // Read rather than trusted: the service is deployed on its own, so a build of
    // it older than this app answers with no folder icons at all - and one older
    // than this route with the icons and no colours.
    const icons = folderIconMap(theirs)
    const held = this.spaces[root]
    const mine = { icons: held?.icons ?? {}, colors: held?.colors ?? {} }
    // A service with no column for the colours at all is not the same answer as a
    // space with no colours in it: the first leaves what is here alone, the second
    // takes it away.
    const colors = theirTints === undefined ? mine.colors : folderIconMap(theirTints)
    const met = meet(held, accountId, mine, { icons, colors }, MAPS)
    if (!met) return

    this.spaces = { ...this.spaces, [root]: { ...met.value, account: accountId, sent: true } }
    this.write()

    if (met.tell) void this.push(root)
  }

  private put(root: string, icons: Record<string, string>, colors: Record<string, string>) {
    this.spaces = {
      ...this.spaces,
      [root]: { icons, colors, account: this.spaces[root]?.account ?? null, sent: false },
    }
    this.write()
    this.soon(root)
  }

  /** The account hears about it once the choosing stops.
   *
   *  One gesture in the picker writes an icon and a colour, and the colour is picked
   *  off a row of dots that answers on the press: four dots tried is four writes
   *  here and one request there. See `SETTLING`. */
  private soon(root: string) {
    const held = this.pushing[root]
    if (held !== undefined) clearTimeout(held)

    const waiting = setTimeout(() => {
      this.pushing = without(this.pushing, root)
      void this.push(root)
    }, SETTLING)

    this.pushing = { ...this.pushing, [root]: waiting }
  }

  /** The space's maps as they now stand, sent up so every other machine draws the
   *  same rows in the same colours. The space's own icon is sent by the syncing
   *  loop; these are written by a gesture in the file list, and a pass is minutes
   *  away. See pushing.ts. */
  private async push(root: string) {
    const { push } = await import('./pushing')
    await push(
      root,
      (api, token, spaceId) =>
        api.saveFolderIcons(token, spaceId, this.of(root), this.colorsOf(root)),
      (landed) => this.said(root, landed),
    )
  }

  /** Whether the account has heard the space's maps as they now stand. What the next
   *  pass reads before it hands this machine the account's copy; see `adopt`. */
  private said(root: string, landed: boolean) {
    const held = this.spaces[root]
    if (!held || held.sent === landed) return

    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.write()
  }

  private write() {
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
