/** The Mac's menu bar, described.
 *
 *  On a Mac the app's menu is not a button in the window but the strip across the
 *  top of the screen, the way Obsidian, VS Code and every other Mac app keep theirs.
 *  It is made of the same groups the in-window menu draws - `appMenu` in app-menu.ts -
 *  arranged the way a Mac arranges them: the app's own menu first, then File, Edit,
 *  Paragraph, Format and View as the app has them (Typora's order), then Window and
 *  Help. This module turns those groups into a plain description of that strip, and
 *  native-menu-bar.svelte.ts is the thin half that makes Tauri menu items of it.
 *
 *  Pure, so what the strip says is testable without a Mac: labels, key equivalents,
 *  what is greyed out and ticked, the rules between groups and what nests in what.
 *
 *  **Who answers a key.** A key equivalent on a menu row and a keydown handler in the
 *  page are two ways in to one command, and the design has to run it exactly once.
 *  How AppKit and WebKit route a keystroke decides it:
 *
 *  - With the app's own page in front, AppKit offers a key equivalent to the window
 *    before the menu bar, and `WKWebView` hands it to the page first. Only when the
 *    page lets it pass - its handlers ran and none of them called `preventDefault` -
 *    does WebKit send it on, and only then does the menu bar see it. Every command the
 *    app's own handler runs is prevented (`handle` in shortcuts.svelte.ts, the
 *    editor's keymap, the held Cmd+T), so the menu never runs it a second time.
 *  - With a web tab in front, the page is a child webview, and wry's child webview
 *    declines every key equivalent (`performKeyEquivalent` answers NO; see
 *    tauri-apps/tauri#9426), so the menu bar is asked before the site and the page
 *    never sees the key at all. This is what makes Cmd+T, Cmd+W and Ctrl+Tab work
 *    from a web tab: they are rows here, and Cmd+W is Close note rather than the
 *    Close Window of Tauri's default menu, which closed the whole window.
 *  - A key the page let pass arrives at the menu after the page has seen it. That is
 *    a key the app chose not to act on - Cmd+B typed into the search field, any key
 *    while a deck is being presented - and running the row then would be the app
 *    doing what it had just declined to. So a row's action first asks whether the
 *    page saw this very key a moment ago and let it pass (`letPass`), and does
 *    nothing if it did.
 *
 *  The system's own rows - Undo, Redo, Cut, Copy, Paste, Select All - are AppKit's
 *  rather than the app's, and go to whatever has the keyboard: the note, a field, a
 *  site in a web tab. That is the only way Cmd+C reaches a web tab at all, and inside
 *  a note the editor answers the keys itself before the menu sees them.
 *
 *  A row that acts on the note - Bold, a heading, a fold - is guarded one step more:
 *  with a web tab holding the keyboard it does nothing, because the note is not what
 *  is being worked on. A row of the window's - New note, Close note, a panel - runs
 *  from anywhere, and hands the keyboard back to the app as it does. */

import { matchesCombination, parseCombination } from './keys'
import { DIVIDER, isSubmenu, type MenuGroup, type MenuItem, type MenuRow } from './menu-item'

/** The rows AppKit draws and answers itself. */
type SystemItem =
  | 'About'
  | 'Services'
  | 'Hide'
  | 'HideOthers'
  | 'ShowAll'
  | 'Quit'
  | 'Undo'
  | 'Redo'
  | 'Cut'
  | 'Copy'
  | 'Paste'
  | 'SelectAll'
  | 'Minimize'
  | 'Maximize'
  | 'BringAllToFront'

/** A row of the app's own. */
export interface NativeItem {
  kind: 'item'
  id: string
  text: string
  /** Tauri's spelling of the key equivalent, or null for a row only a click runs. */
  accelerator: string | null
  enabled: boolean
  /** Present on a row that can be ticked, ticked or not; such a row is a check item
   *  for as long as it exists. */
  checked?: boolean
  /** The combination behind the accelerator, as the registry writes it, for asking
   *  whether the page has just let this key pass. Null exactly where `accelerator`
   *  is. */
  key: string | null
  /** Whether it acts on the window rather than on the note, so it runs whichever
   *  webview has the keyboard. */
  anywhere: boolean
}

export interface NativeSubmenu {
  kind: 'submenu'
  id: string
  text: string
  enabled: boolean
  items: NativeEntry[]
  /** The menu AppKit is told is Window, which it adds the list of open windows to.
   *
   *  Help is not told it is Help. AppKit would put its search field there, and that
   *  field answers Shift+Cmd+/, which is this app's own key for the list of keys; the
   *  row for that list opens Help instead. */
  role?: 'window'
}

interface NativeSystem {
  kind: 'system'
  id: string
  item: SystemItem
  text: string
}

interface NativeRule {
  kind: 'rule'
  id: string
}

export type NativeEntry = NativeItem | NativeSubmenu | NativeSystem | NativeRule

/** The words the Mac's own rows are written with, translated by the caller. */
export interface MenuBarWords {
  /** The app's own menu, whose title AppKit replaces with the bundle's name. */
  app: string
  about: string
  services: string
  hide: string
  hideOthers: string
  showAll: string
  quit: string
  window: string
  minimize: string
  zoom: string
  bringAllToFront: string
  openRecent: string
  clearMenu: string
}

export interface MenuBarSources {
  /** The in-window menu's groups, as `appMenu` builds them. */
  groups: MenuGroup[]
  /** File's row for a new tab of any kind, which the in-window menu has no row for:
   *  Cmd+T there is a key, and here it has to be a row to be a key at all. */
  newTab: MenuItem | null
  /** The notes opened lately, newest first. */
  recent: MenuItem[]
  clearRecent: () => void
  /** The rows of Window between Zoom and Bring All to Front: walking the tabs. */
  windowRows: MenuItem[]
  /** Rows Help opens with, ahead of the in-window menu's own. */
  helpRows: MenuItem[]
  /** The key a registry entry answers to right now, in the registry's notation. */
  keyFor(command: string): string | null
  /** Whether a registry entry acts on the window (`app` scope) rather than on
   *  whatever has the keyboard. */
  isWindowCommand(command: string): boolean
  words: MenuBarWords
}

/** The strip, and what each of its own rows runs, by id. */
export interface MenuBar {
  entries: NativeEntry[]
  runs: Map<string, () => void>
}

/** The rows whose command is one of AppKit's own. They are drawn as the system's
 *  rows so that they reach whatever has the keyboard, which the app's own versions
 *  cannot: those act on the note. */
const SYSTEM_COMMANDS: Record<string, SystemItem> = {
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'fixed.cut': 'Cut',
  'fixed.copy': 'Copy',
  'fixed.paste': 'Paste',
  'edit.select-all': 'SelectAll',
}

/** The row that moves to the app's own menu, which is where a Mac keeps it. */
const SETTINGS = 'app.settings'

/** The key equivalents the system rows hold. Muda fixes them, so no row of the
 *  app's may be given one of them as well: two rows on one key is a key that does
 *  whichever AppKit finds first. */
const SYSTEM_ACCELERATORS = [
  'Cmd+Q',
  'Cmd+H',
  'Cmd+Alt+H',
  'Cmd+M',
  'Cmd+Z',
  'Cmd+Shift+Z',
  'Cmd+X',
  'Cmd+C',
  'Cmd+V',
  'Cmd+A',
]

/** Keys Tauri's accelerator reader knows by a name. */
const NAMED_KEYS: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  ' ': 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

/** The punctuation Tauri's reader takes as itself. */
const PUNCTUATION = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`'])

const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/

/** The key part of an accelerator, or null for a key Tauri cannot put on a row. */
function acceleratorKey(key: string): string | null {
  if (/^[a-z]$/.test(key)) return key.toUpperCase()
  if (/^\d$/.test(key) || PUNCTUATION.has(key) || FUNCTION_KEY.test(key)) return key

  return NAMED_KEYS[key] ?? null
}

/** A combination in the registry's notation, as the accelerator Tauri reads, for a
 *  Mac: `Mod-Shift-k` is `Cmd+Shift+K`.
 *
 *  Null for a combination that cannot be a key equivalent: one Tauri has no name
 *  for, and a bare key other than a function key. A menu row on Enter or on a
 *  letter would take that key from every field and every site in the app; F5 on its
 *  own is a key nobody types with. */
export function toAccelerator(key: string): string | null {
  const combination = parseCombination(key, 'mac')
  if (!combination) return null

  const named = acceleratorKey(combination.key)
  if (!named) return null

  const chord = combination.meta || combination.ctrl || combination.alt
  if (!chord && !FUNCTION_KEY.test(named)) return null

  const parts: string[] = []
  if (combination.meta) parts.push('Cmd')
  if (combination.ctrl) parts.push('Ctrl')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')
  parts.push(named)

  return parts.join('+')
}

/** How long after the page saw a key the menu may still be hearing that same
 *  press. WebKit sends a key the page let pass on to the menu at once, and a hand
 *  cannot press a key and then reach the menu bar with the pointer inside a
 *  second, so a second tells the two apart with room on both sides. */
const LET_PASS_WITHIN = 1000

/** A keydown the page saw, and when. */
export interface SeenKey {
  event: {
    key: string
    code?: string | undefined
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
    defaultPrevented: boolean
  }
  at: number
}

/** How many of these windows are document windows, each with a strip of its own: the
 *  first, `main`, and the ones opened after it, `nib-2` and on. The presenter's and a
 *  print's are not. The same two shapes as `is_document_window` in launch.rs. */
export function documentWindows(labels: string[]): number {
  return labels.filter((label) => label === 'main' || /^nib-\d+$/.test(label)).length
}

/** Whether the page saw this very key a moment ago and let it pass, which is the
 *  one case where a row's action must not run: the app had the key and declined
 *  it. A key the page never saw - one pressed in a web tab - and a click on the
 *  row are both not that. */
export function letPass(key: string, seen: SeenKey | null, now: number): boolean {
  if (!seen || now - seen.at > LET_PASS_WITHIN) return false
  if (seen.event.defaultPrevented) return false

  return matchesCombination(key, seen.event, 'mac')
}

/** Whether the window has just come out of full screen by a way the app did not
 *  ask for - the green button, the system's own menu row - while the app's own full
 *  screen was on. The document alone in an ordinary window is not a state anyone
 *  chose, so the app's half follows the window's out. The other way round is left
 *  alone: the green button makes the window bigger and nothing more, which is what
 *  it does in Obsidian. */
export function leftFullscreen(was: boolean, now: boolean, appOn: boolean): boolean {
  return was && !now && appOn
}

/** Drops the rules a removed row left behind: at either end, and two in a row. */
function tidy(rows: MenuRow[]): MenuRow[] {
  const out: MenuRow[] = []
  for (const row of rows) {
    if (row === DIVIDER && (out.length === 0 || out.at(-1) === DIVIDER)) continue
    out.push(row)
  }
  while (out.at(-1) === DIVIDER) out.pop()

  return out
}

/** Hands out key equivalents, each once. */
function claimer(): (accelerator: string | null) => string | null {
  const taken = new Set(SYSTEM_ACCELERATORS)

  return (accelerator) => {
    if (!accelerator || taken.has(accelerator)) return null

    taken.add(accelerator)
    return accelerator
  }
}

/** The strip. */
export function describeMenuBar(sources: MenuBarSources): MenuBar {
  const { groups, words } = sources
  const runs = new Map<string, () => void>()
  const claim = claimer()

  const item = (row: MenuItem, id: string): NativeItem => {
    const key = row.command ? sources.keyFor(row.command) : null
    const accelerator = claim(key ? toAccelerator(key) : null)
    runs.set(id, row.run)

    return {
      kind: 'item',
      id,
      text: row.label,
      accelerator,
      enabled: !row.disabled,
      ...(row.checked === undefined ? {} : { checked: row.checked }),
      key: accelerator ? key : null,
      anywhere: !row.command || sources.isWindowCommand(row.command),
    }
  }

  const entries = (rows: MenuRow[], parent: string): NativeEntry[] =>
    tidy(rows).map((row, index): NativeEntry => {
      const id = `${parent}.${index}`
      if (row === DIVIDER) return { kind: 'rule', id }
      if (isSubmenu(row)) {
        return {
          kind: 'submenu',
          id,
          text: row.label,
          enabled: !row.disabled,
          items: entries(row.rows, id),
        }
      }

      const system = row.command ? SYSTEM_COMMANDS[row.command] : undefined
      if (system) return { kind: 'system', id, item: system, text: row.label }

      return item(row, id)
    })

  const settings = groups
    .flatMap((group) => group.rows)
    .find((row): row is MenuItem => row !== DIVIDER && !isSubmenu(row) && row.command === SETTINGS)

  // The app's own menu. Settings is here and not under File, with the ellipsis a
  // Mac writes on a row that opens a window; the rest is AppKit's.
  const app: NativeSubmenu = {
    kind: 'submenu',
    id: 'nib',
    text: words.app,
    enabled: true,
    items: [
      { kind: 'system', id: 'nib.about', item: 'About', text: words.about },
      { kind: 'rule', id: 'nib.rule-1' },
      ...(settings ? [item({ ...settings, label: `${settings.label}…` }, 'nib.settings')] : []),
      { kind: 'rule', id: 'nib.rule-2' },
      { kind: 'system', id: 'nib.services', item: 'Services', text: words.services },
      { kind: 'rule', id: 'nib.rule-3' },
      { kind: 'system', id: 'nib.hide', item: 'Hide', text: words.hide },
      { kind: 'system', id: 'nib.hide-others', item: 'HideOthers', text: words.hideOthers },
      { kind: 'system', id: 'nib.show-all', item: 'ShowAll', text: words.showAll },
      { kind: 'rule', id: 'nib.rule-4' },
      { kind: 'system', id: 'nib.quit', item: 'Quit', text: words.quit },
    ],
  }

  const recent: MenuRow[] = [
    ...sources.recent,
    ...(sources.recent.length ? [DIVIDER] : []),
    { label: words.clearMenu, disabled: !sources.recent.length, run: sources.clearRecent },
  ]

  /** File, with a new tab beside the other new things and Open Recent under Open,
   *  where every Mac app keeps it. Settings has gone to the app's own menu. */
  const fileRows = (rows: MenuRow[]): MenuRow[] =>
    rows.flatMap((row) => {
      if (row === DIVIDER || isSubmenu(row)) return [row]
      if (row.command === SETTINGS) return []
      if (row.command !== 'app.open') return [row]

      return [
        ...(sources.newTab ? [sources.newTab] : []),
        row,
        { label: words.openRecent, rows: recent },
      ]
    })

  const rowsOf = (group: MenuGroup): MenuRow[] => {
    if (group.id === 'file') return fileRows(group.rows)
    if (group.id === 'help' && sources.helpRows.length) {
      return [...sources.helpRows, DIVIDER, ...group.rows]
    }

    return group.rows
  }

  const own = groups.map((group): NativeSubmenu => ({
    kind: 'submenu',
    id: group.id,
    text: group.label,
    enabled: true,
    items: entries(rowsOf(group), group.id),
  }))

  const window: NativeSubmenu = {
    kind: 'submenu',
    id: 'window',
    text: words.window,
    enabled: true,
    role: 'window',
    items: [
      { kind: 'system', id: 'window.minimize', item: 'Minimize', text: words.minimize },
      { kind: 'system', id: 'window.zoom', item: 'Maximize', text: words.zoom },
      ...(sources.windowRows.length ? [{ kind: 'rule' as const, id: 'window.rule-1' }] : []),
      ...sources.windowRows.map((row, index) => item(row, `window.tab-${index}`)),
      { kind: 'rule', id: 'window.rule-2' },
      {
        kind: 'system',
        id: 'window.front',
        item: 'BringAllToFront',
        text: words.bringAllToFront,
      },
    ],
  }

  // Window goes where a Mac puts it, just before Help.
  const help = own.findIndex((one) => one.id === 'help')
  const at = help < 0 ? own.length : help

  return { entries: [app, ...own.slice(0, at), window, ...own.slice(at)], runs }
}

/** What one existing row has to be told, to become what it now is. */
export interface Change {
  id: string
  text?: string
  enabled?: boolean
  checked?: boolean
  accelerator?: string | null
}

/** Every entry, depth first. */
export function flatten(entries: NativeEntry[]): NativeEntry[] {
  return entries.flatMap((one) => (one.kind === 'submenu' ? [one, ...flatten(one.items)] : [one]))
}

/** What makes two entries the same object in the strip: the place it is in and the
 *  kind of thing it is. Anything else about it can be changed in place. */
function shapeOf(entry: NativeEntry): string {
  if (entry.kind === 'system') return `${entry.id} system ${entry.item}`
  if (entry.kind === 'item') return `${entry.id} ${entry.checked === undefined ? 'item' : 'check'}`
  if (entry.kind === 'submenu') return `${entry.id} submenu ${entry.items.length}`

  return `${entry.id} rule`
}

/** The changes that turn the strip that is up into the one that should be, or null
 *  where its shape changed and it has to be built again.
 *
 *  Building one is a round trip to the crate for every row, a hundred and more of
 *  them, and it leaves behind the channel each row's action came in on; telling one
 *  row its new tick is one round trip and leaves nothing. Most of what changes while
 *  the app is used - a mode switched, a tab closed, a note that can now be saved - is
 *  a tick or a grey, so most of the time this is a handful of calls. */
export function changesBetween(before: NativeEntry[], after: NativeEntry[]): Change[] | null {
  const was = flatten(before)
  const now = flatten(after)
  if (was.length !== now.length) return null

  const changes: Change[] = []
  for (const [index, next] of now.entries()) {
    const previous = was[index]
    if (!previous || shapeOf(previous) !== shapeOf(next)) return null

    const change: Change = { id: next.id }
    if (previous.kind !== 'rule' && next.kind !== 'rule' && previous.text !== next.text) {
      change.text = next.text
    }
    if (previous.kind === 'item' && next.kind === 'item') {
      if (previous.enabled !== next.enabled) change.enabled = next.enabled
      if (previous.checked !== next.checked && next.checked !== undefined) {
        change.checked = next.checked
      }
      if (previous.accelerator !== next.accelerator) change.accelerator = next.accelerator
    }
    if (
      previous.kind === 'submenu' &&
      next.kind === 'submenu' &&
      previous.enabled !== next.enabled
    ) {
      change.enabled = next.enabled
    }

    if (Object.keys(change).length > 1) changes.push(change)
  }

  return changes
}
