/** The Mac's menu bar, put up and kept true.
 *
 *  native-menu.ts says what the strip is; this makes Tauri menu items of it, sets it
 *  as the application's menu, and keeps it describing the moment. Only ever loaded
 *  on a Mac, from App.svelte, and not before the first paint.
 *
 *  **Keeping it true.** The in-window menu is built as it opens, so its ticks and
 *  greys are always the moment's. A native menu cannot be asked to do that - Tauri
 *  says nothing when one opens - so this watches what the rows are made of and
 *  catches up when any of it changes, and again whenever the window comes to the
 *  front. What is watched is a short list of cheap values (`signature`) rather than
 *  the whole menu, because building the rows reads the note: Export asks what the
 *  document is, which flushes it and reads every character of it, and doing that on
 *  every keystroke would be the app getting slower as the note gets longer. Almost
 *  everything that does change is a tick or a grey, and that is told to the one row
 *  in place; the strip is built again only when a row comes or goes. See
 *  `changesBetween`.
 *
 *  **Which window.** There is one menu bar and there may be several windows, each
 *  with a page of its own and its own idea of what is open. The window in front
 *  owns the bar: each builds its own strip, with ids of its own so each row's
 *  action comes back to the page that made it, and sets it as the app's menu as it
 *  comes to the front. */

import type { EditorView } from '@nib/editor'
import type {
  CheckMenuItem,
  Menu,
  MenuItem as TauriMenuItem,
  PredefinedMenuItem,
  Submenu,
} from '@tauri-apps/api/menu'
import { account } from './account.svelte'
import { fullscreen } from './fullscreen.svelte'
import { t } from './i18n.svelte'
import type { MenuItem } from './menu-item'
import { modes } from './modes.svelte'
import {
  type Change,
  changesBetween,
  describeMenuBar,
  documentWindows,
  flatten,
  type KeyboardAt,
  keyRuns,
  leftFullscreen,
  letPass,
  type MenuBarWords,
  type NativeEntry,
  type NativeItem,
  type SeenKey,
} from './native-menu'
import { shownName } from './note-name'
import { shortcuts } from './shortcuts.svelte'
import { type AppContext, BY_ID, runEntry } from './shortcuts/registry'
import { present } from './slides/present.svelte'
import { nameOf } from './space-paths'
import { appMenuRows } from './surfaces.svelte'
import { currentWindow } from './tauri'
import { afterQuiet } from './timing'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

/** What the rows need that only App.svelte has. */
export interface MenuBarContext {
  view?: EditorView | undefined
  onpalette(): void
  onhistory(): void
  app: AppContext
}

/** The app's name, which the Mac writes into its own rows: About Nib, Quit Nib. */
const NAME = 'Nib'

/** How long a burst of changes is let settle before the strip catches up with it.
 *  Switching tabs changes four of the values watched at once, and that is one pass
 *  rather than four. Short enough that nobody reaches the menu bar inside it. */
const SETTLE = 60

type Native = TauriMenuItem | CheckMenuItem | PredefinedMenuItem | Submenu

/** The objects one strip is made of, gathered while it is built. */
interface Built {
  made: Native[]
  byId: Map<string, Native>
  windows: Submenu | null
}

/** Whether another document window is open, whose strip may be the one up. */
async function othersOpen(): Promise<boolean> {
  const { getAllWindows } = await import('@tauri-apps/api/window')
  return documentWindows((await getAllWindows()).map((one) => one.label)) > 1
}

/** Lets the crate drop the objects of a strip nobody shows any more. */
async function close(objects: { close(): Promise<void> }[]): Promise<void> {
  await Promise.all(objects.map((one) => one.close().catch(() => undefined)))
}

function words(): MenuBarWords {
  return {
    app: NAME,
    about: t('About {name}', { name: NAME }),
    services: t('Services'),
    hide: t('Hide {name}', { name: NAME }),
    hideOthers: t('Hide others'),
    showAll: t('Show all'),
    quit: t('Quit {name}', { name: NAME }),
    window: t('Window'),
    minimize: t('Minimize'),
    zoom: t('Zoom'),
    bringAllToFront: t('Bring all to front'),
    openRecent: t('Open recent'),
    clearMenu: t('Clear menu'),
  }
}

/** Everything the rows are made of that can change while the app is open, read so
 *  that the effect below hears when any of it does. Cheap on purpose; see the top
 *  of this file. A value missing from here is caught up with the next time the
 *  window comes to the front. */
function signature(context: MenuBarContext): unknown[] {
  const active = workspace.active

  return [
    context.view,
    // A translated word, which is how the language is read.
    t('File'),
    shortcuts.overrides,
    workspace.activeTabId,
    active?.kind,
    active?.path,
    active?.reading,
    workspace.closed.any,
    workspace.panel,
    workspace.panes.count,
    workspace.recent,
    modes.readOnly,
    modes.source,
    modes.typewriter,
    modes.focus,
    modes.alwaysOnTop,
    modes.highlightTone,
    fullscreen.on,
    present.on,
    present.available,
    account.user,
    viewport.touch,
  ]
}

/** A row that runs a registry entry, labelled the way the registry labels it. */
function entryRow(id: string, context: MenuBarContext, label?: string): MenuItem {
  return {
    label: label ?? BY_ID.get(id)?.label() ?? id,
    command: id,
    run: () => void runEntry(id, context.app),
  }
}

class MenuBar {
  private context: MenuBarContext | null = null
  private label = ''
  private menu: Menu | null = null
  /** This strip's Window menu, which AppKit is told about as the strip goes up. */
  private windows: Submenu | null = null
  /** The Window menu this page last told AppKit about. AppKit adds a line of its own
   *  to a menu each time it is told that menu is the Window menu, told before or not,
   *  so a strip's is told once; see `raise`. */
  private told: Submenu | null = null
  private made: Native[] = []
  private byId = new Map<string, Native>()
  private shown: NativeEntry[] = []
  private live = new Map<string, NativeItem>()
  private runs = new Map<string, () => void>()
  private front = false
  /** One pass at a time: a strip half built when the next change arrives is
   *  finished before that change is looked at. */
  private passing: Promise<void> = Promise.resolve()
  private seen: SeenKey | null = null

  private readonly soon = afterQuiet(() => this.pass(), SETTLE)

  /** Starts it, for the page's whole life. */
  async follow(context: () => MenuBarContext): Promise<void> {
    const frame = await currentWindow()
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const own = getCurrentWindow()
    this.label = own.label
    this.front = await own.isFocused()

    // What the page did with each key it saw, read when a row's action arrives:
    // by then every handler has run. Capture, so nothing can stop it being seen.
    window.addEventListener(
      'keydown',
      (event) => (this.seen = { event, at: performance.now() }),
      true,
    )

    await own.onFocusChanged(({ payload }) => {
      this.front = payload
      if (payload) this.pass(true)
    })

    this.followFullscreen(frame)

    $effect.root(() => {
      $effect(() => {
        const now = context()
        signature(now)
        this.context = now
        this.soon()
      })
    })
  }

  /** Catches the strip up. `raise` sets it as the app's menu even where nothing
   *  about it changed, which is what coming to the front needs. */
  private pass(raise = false): void {
    this.passing = this.passing.then(() => this.catchUp(raise)).catch(() => undefined)
  }

  private async catchUp(raise: boolean): Promise<void> {
    const context = this.context
    if (!context) return

    const appMenu = await appMenuRows()
    const described = describeMenuBar({
      groups: appMenu(context),
      newTab: entryRow('app.new-kind', context, t('New tab')),
      recent: workspace.recent.map((path) => ({
        label: shownName(nameOf(path)),
        run: () => void workspace.openEntry(path),
      })),
      clearRecent: () => workspace.forgetRecent(),
      windowRows: [entryRow('app.next-note', context), entryRow('app.previous-note', context)],
      helpRows: [entryRow('app.keys', context)],
      keyFor: (command) => shortcuts.keyFor(command),
      isWindowCommand: (command) => BY_ID.get(command)?.scope === 'app',
      words: words(),
    })
    const entries = this.owned(described.entries)

    this.runs = new Map([...described.runs].map(([id, run]) => [this.idOf(id), run]))
    this.live = new Map(
      flatten(entries).flatMap((one) => (one.kind === 'item' ? [[one.id, one]] : [])),
    )

    // Another window's strip may have been told it holds the Window menu since this
    // one was, and telling this one again would add AppKit's line to it again. A
    // strip built afresh has a Window menu nobody has told anything yet.
    const fresh = raise && this.told !== null && (await othersOpen())
    const changes = this.menu && !fresh ? changesBetween(this.shown, entries) : null
    if (changes) await this.patch(changes)
    else await this.build(entries)

    this.shown = entries
    if (this.front && (raise || !changes)) await this.raise()
  }

  /** Makes this window's strip the one across the top of the screen. The Window
   *  menu is said again with it: there is one of those for the whole app too, and
   *  another window's may have been the last one said. */
  private async raise(): Promise<void> {
    await this.menu?.setAsAppMenu()
    if (this.windows && this.windows !== this.told) {
      await this.windows.setAsWindowsMenuForNSApp()
      this.told = this.windows
    }
  }

  /** Ids of this window's own, so an action finds its way back to this page. */
  private idOf(id: string): string {
    return `${this.label}/${id}`
  }

  private owned(entries: NativeEntry[]): NativeEntry[] {
    return entries.map((one): NativeEntry => {
      const id = this.idOf(one.id)
      return one.kind === 'submenu' ? { ...one, id, items: this.owned(one.items) } : { ...one, id }
    })
  }

  private async patch(changes: Change[]): Promise<void> {
    await Promise.all(
      changes.map(async (change) => {
        const native = this.byId.get(change.id)
        if (!native) return

        if (change.text !== undefined) await native.setText(change.text)
        if ('setEnabled' in native && change.enabled !== undefined) {
          await native.setEnabled(change.enabled)
        }
        if ('setChecked' in native && change.checked !== undefined) {
          await native.setChecked(change.checked)
        }
        if ('setAccelerator' in native && change.accelerator !== undefined) {
          await native.setAccelerator(change.accelerator)
        }
      }),
    )
  }

  /** A whole new strip. What is up stays up, and stays the one patched, until the
   *  new one is complete: a strip that failed halfway is thrown away, not shown. */
  private async build(entries: NativeEntry[]): Promise<void> {
    const { Menu } = await import('@tauri-apps/api/menu')
    const built: Built = { made: [], byId: new Map(), windows: null }

    try {
      const items = await Promise.all(entries.map((one) => this.make(one, built)))
      const menu = await Menu.new({ items })
      const before = [...this.made, ...(this.menu ? [this.menu] : [])]

      this.menu = menu
      this.made = built.made
      this.byId = built.byId
      this.windows = built.windows
      await close(before)
    } catch (error) {
      await close(built.made)
      throw error
    }
  }

  private async make(entry: NativeEntry, built: Built): Promise<Native> {
    const api = await import('@tauri-apps/api/menu')
    let made: Native

    if (entry.kind === 'rule') {
      made = await api.PredefinedMenuItem.new({ item: 'Separator' })
    } else if (entry.kind === 'system') {
      // About with nothing said, so AppKit fills the panel from the bundle: the
      // name, the icon, the version the release was built as.
      const item = entry.item === 'About' ? { About: null } : entry.item
      made = await api.PredefinedMenuItem.new({ item, text: entry.text })
    } else if (entry.kind === 'submenu') {
      const items = await Promise.all(entry.items.map((one) => this.make(one, built)))
      const submenu = await api.Submenu.new({
        id: entry.id,
        text: entry.text,
        enabled: entry.enabled,
        items,
      })
      if (entry.role === 'window') built.windows = submenu
      made = submenu
    } else {
      const options = {
        id: entry.id,
        text: entry.text,
        enabled: entry.enabled,
        ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
        action: (id: string) => this.dispatch(id),
      }
      made =
        entry.checked === undefined
          ? await api.MenuItem.new(options)
          : await api.CheckMenuItem.new({ ...options, checked: entry.checked })
    }

    built.made.push(made)
    built.byId.set(entry.id, made)
    return made
  }

  /** A row was chosen, by a click or by its key. See the top of native-menu.ts for
   *  why each of the three questions is asked. */
  private dispatch(id: string): void {
    const entry = this.live.get(id)
    const run = this.runs.get(id)
    if (!entry || !run) return

    // The page had this key and let it pass: the app declined it.
    if (entry.key && letPass(entry.key, this.seen, performance.now())) return

    // A row of the note's acts on the note only while the note has the keyboard; see
    // `keyRuns`. With the keyboard in a web tab a row of the window's runs, and
    // brings the keyboard back with it, the way the same key does on Windows: see
    // web_keys.rs.
    const away = !document.hasFocus()
    const at: KeyboardAt = away ? 'away' : this.context?.view?.hasFocus ? 'note' : 'page'
    if (entry.key && !keyRuns(entry.anywhere, at)) return
    if (away) void this.takeKeyboard()

    run()
  }

  private async takeKeyboard(): Promise<void> {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview()
      .setFocus()
      .catch(() => undefined)
  }

  /** The window's full screen and the app's, kept saying the same thing. The app's
   *  own already asks for the Mac's native full screen, its own Space; this is the
   *  other direction, for a window taken out of it by the green button or by the
   *  system's own row. See `leftFullscreen`. */
  private followFullscreen(frame: Awaited<ReturnType<typeof currentWindow>>): void {
    let was = false
    void frame.isFullscreen().then((now) => (was = now))
    void frame.onResized(() => {
      void frame.isFullscreen().then((now) => {
        if (leftFullscreen(was, now, fullscreen.on)) void fullscreen.leave()
        was = now
      })
    })
  }
}

/** Puts the Mac's menu bar up and keeps it true for as long as the page lives.
 *  `context` is read inside an effect, so what it reads is watched too. */
export function followMenuBar(context: () => MenuBarContext): void {
  void new MenuBar().follow(context)
}
