/** What Zen's own session file says: its spaces, its folders and its tabs, in the
 *  order its sidebar draws them.
 *
 *  Zen is Firefox underneath, and keeps the sidebar - every space, pinned tab,
 *  Essential and folder - in `zen-sessions.jsonlz4` in the profile, one object
 *  `{ spaces, tabs, folders, groups }` shared by every window. Before that file
 *  existed, and in Firefox's own `recovery.jsonlz4` still, the same four lists sit
 *  on each window, `{ windows: [{ spaces, tabs, folders }] }`; both are read here,
 *  so a profile that has not yet written the newer file still imports. See Zen's
 *  ZenSessionManager.sys.mjs, TabState.sys.mjs and ZenFolders.mjs.
 *
 *  - **A space** is `{ uuid, name, icon, position, containerTabId, theme }`. The
 *    icon is an emoji or one of Zen's own drawings, a `chrome://` address.
 *  - **A tab** is Firefox's tab state with Zen's fields on it: `zenWorkspace` (its
 *    space), `zenEssential`, `pinned`, `groupId` (the folder it is in),
 *    `zenStaticLabel` (a name somebody gave it), `zenIsEmpty` (the stand-in an
 *    empty folder holds), `zenIsGlance` (a page peeked at over another), and
 *    `_zenPinnedInitialState`, the address a pinned tab goes back to.
 *  - **A folder** is a tab group with `{ id, name, parentId, userIcon, workspaceId }`;
 *    a split view inside a folder is listed among them as `splitViewGroup`.
 *
 *  Pure: the crate hands over the bytes, mozlz4.ts unpacks them, and this reads
 *  what came out. Anything it does not recognise is stepped over rather than
 *  refused, because the file is another program's and it changes with its releases. */

export interface ZenSpace {
  id: string
  name: string
  /** An emoji, a `chrome://` address of one of Zen's drawings, or null. */
  icon: string | null
  /** The theme's main colour, where it has one. */
  colour: [number, number, number] | null
  /** The container new tabs in the space open in, or nought for none. */
  container: number
}

export interface ZenFolder {
  id: string
  name: string
  icon: string | null
  parent: string | null
  space: string | null
  /** A split view, which is a group of tabs side by side rather than a folder. */
  split: boolean
}

export interface ZenTab {
  title: string
  /** Where the tab is now. */
  url: string
  /** Where a pinned tab goes back to, when that is somewhere else. */
  home: string | null
  /** The site's mark as the session kept it: an address or a `data:` picture. */
  icon: string | null
  pinned: boolean
  essential: boolean
  space: string | null
  folder: string | null
  /** The container the tab is open in, or nought for none. */
  container: number
}

export interface ZenSession {
  /** In the order Zen's space switcher shows them. */
  spaces: ZenSpace[]
  /** In the order they sit in the sidebar. */
  folders: ZenFolder[]
  /** In the order they sit in the sidebar, each once. */
  tabs: ZenTab[]
}

type Said = Record<string, unknown>

function isObject(value: unknown): value is Said {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function list(value: unknown): Said[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The sidebar out of what was in the file, or null when it holds no spaces: a
 *  session from a Firefox, or a file Zen had not finished writing. */
export function readZenSession(said: unknown): ZenSession | null {
  if (!isObject(said)) return null

  const sidebar = Array.isArray(said.spaces) ? said : fromWindows(list(said.windows))
  if (!sidebar) return null

  const spaces = list(sidebar.spaces)
    .map((one, at) => ({ one, at, position: Number(one.position) }))
    .sort(
      (a, b) =>
        (Number.isFinite(a.position) ? a.position : a.at) -
          (Number.isFinite(b.position) ? b.position : b.at) || a.at - b.at,
    )
    .map(({ one }) => spaceOf(one))
    .filter((one): one is ZenSpace => one !== null)
  if (!spaces.length) return null

  return {
    spaces,
    folders: list(sidebar.folders)
      .map(folderOf)
      .filter((one): one is ZenFolder => one !== null),
    tabs: tabsOf(list(sidebar.tabs)),
  }
}

/** The same four lists off the windows of a Firefox session: the spaces and the
 *  folders of the first window that has any, which every window shares, and the
 *  tabs of all of them, since a window may hold tabs another does not. Never a
 *  private window's: nothing of one is anybody's to keep. */
function fromWindows(windows: Said[]): Said | null {
  const normal = windows.filter((one) => !one.isPrivate && !one.isPopup && !one.isTaskbarTab)
  const first = normal.find((one) => list(one.spaces).length)
  if (!first) return null

  return {
    spaces: first.spaces,
    folders: first.folders,
    tabs: normal.flatMap((one) => list(one.tabs)),
  }
}

function spaceOf(one: Said): ZenSpace | null {
  const id = text(one.uuid)
  if (!id) return null

  return {
    id,
    name: text(one.name) ?? 'Zen',
    icon: text(one.icon),
    colour: colourOf(one.theme),
    container: containerOf(one.containerTabId),
  }
}

/** The theme's main colour: the dot marked primary, or the first one. Each is
 *  `{ c: [r, g, b] }`; a colour somebody typed is a CSS string, which says nothing
 *  a tint could use. */
function colourOf(theme: unknown): [number, number, number] | null {
  if (!isObject(theme)) return null

  const dots = list(theme.gradientColors)
  const dot = dots.find((one) => one.isPrimary === true) ?? dots[0]
  const c = dot?.c
  if (!Array.isArray(c) || c.length < 3) return null

  const rgb = c.slice(0, 3).map(Number)
  return rgb.every((one) => Number.isFinite(one)) ? (rgb as [number, number, number]) : null
}

function folderOf(one: Said): ZenFolder | null {
  const id = text(one.id)
  if (!id) return null

  return {
    id,
    name: text(one.name) ?? 'Folder',
    icon: text(one.userIcon),
    parent: text(one.parentId),
    space: text(one.workspaceId),
    split: one.splitViewGroup === true,
  }
}

/** Every tab worth a row, each once. A tab is in the file once per window that
 *  holds it, under one `zenSyncId`, and the copy that has a page wins over a blank
 *  one, which is how Zen chooses too. The stand-in an empty folder keeps and a page
 *  peeked at over another are not tabs anybody opened. */
function tabsOf(tabs: Said[]): ZenTab[] {
  const kept = new Map<string, ZenTab | null>()

  tabs.forEach((one, at) => {
    if (one.zenIsEmpty === true || one.zenIsGlance === true) return
    // A tab with no id of its own is a tab of its own.
    const key = text(one.zenSyncId) ?? `#${at}`
    if (!kept.get(key)) kept.set(key, tabOf(one))
  })

  return [...kept.values()].filter((one): one is ZenTab => one !== null)
}

/** One tab, or null for one with no page: Firefox's `entries` are the tab's
 *  history and `index` counts from one to the page it is on. */
function tabOf(one: Said): ZenTab | null {
  const entries = list(one.entries)
  const index = Math.min(Math.max(Number(one.index) || entries.length, 1), entries.length)
  const entry = entries[index - 1]
  const initial = isObject(one._zenPinnedInitialState) ? one._zenPinnedInitialState : null
  const first = initial && isObject(initial.entry) ? initial.entry : null

  const url = text(entry?.url) ?? text(one.userTypedValue) ?? text(first?.url)
  if (!url || url === 'about:blank') return null

  const essential = one.zenEssential === true
  const home = text(first?.url)

  return {
    title: text(one.zenStaticLabel) ?? text(entry?.title) ?? text(first?.title) ?? url,
    url,
    home: home && home !== url ? home : null,
    icon: text(one.image) ?? text(initial?.image),
    pinned: essential || one.pinned === true,
    essential,
    space: text(one.zenWorkspace),
    folder: text(one.groupId),
    container: containerOf(one.userContextId),
  }
}

/** A container's number, which Firefox calls a user context: nought is none. */
function containerOf(value: unknown): number {
  const said = Number(value)
  return Number.isInteger(said) && said > 0 ? said : 0
}
