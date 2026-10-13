/** Zen's sidebar as nib's: what each space becomes before anything is written.
 *
 *  Zen and nib draw the same picture. A space is a space; its sidebar is the file
 *  list; a tab is a web note, the `.url` file a page kept in nib already is; a
 *  folder is a note that holds notes, which on the disk is a folder the file list
 *  draws as a note (folder-notes.ts). So each Zen space becomes a nib space of the
 *  same name, wearing its icon and its colour, with every tab in it as a web note in
 *  the place Zen's sidebar has it - Essentials, then the pinned tabs and folders,
 *  then the tabs of the day - and that order kept as the list's own arranged order.
 *
 *  - **Essentials** are Zen's tiles above every space, which is what nib's
 *    bookmarks are above the file list: each is a web note at the top of its space
 *    and a bookmark of it. Zen shows one row of them for every space (or one per
 *    container); nib keeps bookmarks per space, so they go to the first space, or
 *    to the first one of their container, rather than a copy into every space.
 *  - **A pinned tab** goes back to where it was pinned; the web note's home is that
 *    address and its `URL` the page it is on now, which is the same two things a web
 *    note in nib keeps (shortcut.ts).
 *  - **An empty folder** is an empty note of its name, since a folder with nothing
 *    in it is not on a disk.
 *  - **A split view** is two tabs side by side; they come over as two tabs, in
 *    the folder the split was in.
 *  - **Containers** have nothing to become: nib browses in one profile, with
 *    private tabs for the rest (docs/browser.md). Said once, where any tab had one.
 *
 *  Nothing but web pages: a tab on `about:`, a file or an extension's page is not
 *  somewhere a web note can point. A site's mark comes along where the session kept
 *  it as a picture; an address of one would be a request to the site at every
 *  launch, so it waits for the page to be opened.
 *
 *  Pure: the session in, the plans out. See migrating.svelte.ts for the writing. */

import { key } from '../i18n.svelte'
import { Names, safeName } from './names'
import type { Lost, Planned } from './plan'
import type { ZenFolder, ZenSession, ZenSpace, ZenTab } from './zen'
import { zenIcon, zenTint } from './zen-icons'
import { isWebAddress } from '../web-tab/address'
import { writeShortcut } from '../web-tab/shortcut'
import { readIcon } from '../icons'

/** One Zen space as a nib space. */
export interface ZenSpacePlan {
  name: string
  icon: string | null
  /** Only with a stroked icon: an emoji has its own colours. */
  tint: string | null
  /** Every web note and empty note, as paths inside the space, in Zen's order. */
  files: Planned[]
  /** Each folder's rows in Zen's order, by the folder's path ('' for the top). */
  order: Record<string, string[]>
  /** The Essentials, as paths of their web notes. */
  bookmarks: string[]
  /** The icons Zen's folders wore, by the folder's path. */
  folderIcons: Record<string, string>
}

interface ZenImport {
  spaces: ZenSpacePlan[]
  lost: Lost[]
}

/** The largest site mark kept in a web note: a favicon is a few kilobytes, and a
 *  picture past this is a page's screenshot somebody's session kept by accident. */
const LONGEST_MARK = 64 * 1024

/** What nib makes of a session. `now` is when the web notes say they were kept. */
export function zenImport(session: ZenSession, now: Date): ZenImport {
  const first = session.spaces[0]
  // A tab whose space is not in the list is in the first one, which is where Zen
  // shows a tab it has lost the space of.
  const homeOf = (tab: ZenTab): string | undefined => {
    const own = session.spaces.find((space) => space.id === tab.space)
    // Essentials are shown in every space, or in every space of their container.
    const contained =
      tab.essential && tab.container
        ? session.spaces.find((space) => space.container === tab.container)
        : undefined
    return (own ?? contained ?? first)?.id
  }

  const container = session.tabs.some((tab) => tab.container > 0)
  return {
    spaces: session.spaces.map((space) =>
      spacePlan(
        space,
        session.folders,
        session.tabs.filter((tab) => homeOf(tab) === space.id && isWebAddress(tab.url)),
        now,
      ),
    ),
    lost: container || session.spaces.some((space) => space.container > 0) ? [CONTAINERS] : [],
  }
}

const CONTAINERS: Lost = { text: key('Containers stay in Zen') }

/** A row of the sidebar: a tab, or a folder of rows. */
type Row = { tab: ZenTab } | { folder: ZenFolder; rows: Row[] }

function spacePlan(
  space: ZenSpace,
  folders: readonly ZenFolder[],
  tabs: readonly ZenTab[],
  now: Date,
): ZenSpacePlan {
  const icon = zenIcon(space.icon)
  const plan: ZenSpacePlan = {
    name: space.name,
    icon,
    tint: icon && readIcon(icon)?.kind === 'lucide' ? zenTint(space.colour) : null,
    files: [],
    order: {},
    bookmarks: [],
    folderIcons: {},
  }

  const rows = rowsOf(space, folders, tabs)
  write(rows, '', plan, new Names(), now)
  return plan
}

/** The space's rows as Zen's sidebar nests them. Essentials first, which is where
 *  they are drawn, then everything else in the session's order: a folder sits where
 *  its first tab does, and a folder of nothing at the end of the folder it is in,
 *  in the order the folders are listed. */
function rowsOf(space: ZenSpace, folders: readonly ZenFolder[], tabs: readonly ZenTab[]): Row[] {
  const byId = new Map(folders.filter((one) => one.id).map((one) => [one.id, one]))
  const top: Row[] = []
  const made = new Map<string, Row[]>()

  /** The rows of a folder, made in its parent's rows the first time it is asked. A
   *  split view is not a folder: its rows are its folder's. A chain that loops, or
   *  a folder of another space, ends at the top. */
  const rowsIn = (id: string | null, seen = new Set<string>()): Row[] => {
    const folder = id ? byId.get(id) : undefined
    if (!folder || seen.has(folder.id) || (folder.space && folder.space !== space.id)) return top
    seen.add(folder.id)
    if (folder.split) return rowsIn(folder.parent, seen)

    const held = made.get(folder.id)
    if (held) return held
    const rows: Row[] = []
    made.set(folder.id, rows)
    rowsIn(folder.parent, seen).push({ folder, rows })
    return rows
  }

  const essentials = tabs.filter((tab) => tab.essential)
  for (const tab of essentials) top.push({ tab })
  for (const tab of tabs) if (!tab.essential) rowsIn(tab.folder).push({ tab })
  for (const folder of folders) if (folder.space === space.id) rowsIn(folder.id)

  return top
}

/** The rows as files, each folder's order written down as they go. */
function write(rows: readonly Row[], folder: string, plan: ZenSpacePlan, names: Names, now: Date) {
  const order: string[] = []
  const inside = (name: string) => (folder ? `${folder}/${name}` : name)

  for (const row of rows) {
    if ('tab' in row) {
      const path = names.free(inside(`${safeName(row.tab.title)}.url`))
      plan.files.push({ kind: 'note', path, text: shortcutOf(row.tab, now) })
      if (row.tab.essential) plan.bookmarks.push(path)
      order.push(nameIn(path))
      continue
    }

    const name = safeName(row.folder.name)
    if (!row.rows.length) {
      const path = names.free(inside(`${name}.md`))
      plan.files.push({ kind: 'note', path, text: '' })
      order.push(nameIn(path))
      continue
    }

    const path = names.free(inside(name))
    const icon = zenIcon(row.folder.icon)
    if (icon) plan.folderIcons[path] = icon
    order.push(nameIn(path))
    write(row.rows, path, plan, names, now)
  }

  plan.order[folder] = order
}

function nameIn(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A tab as a web note: its page now, the address it was pinned on, and its mark
 *  where the session kept it as a picture. */
function shortcutOf(tab: ZenTab, now: Date): string {
  const home = tab.home && isWebAddress(tab.home) ? tab.home : null
  const mark =
    tab.icon?.startsWith('data:image/') && tab.icon.length <= LONGEST_MARK ? tab.icon : null
  return writeShortcut(tab.url, tab.title, now, home, mark)
}
