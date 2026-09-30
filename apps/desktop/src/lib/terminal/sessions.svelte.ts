/** Every terminal tab's screen and shell, which outlive the pane that shows them.
 *
 *  A pane is keyed by its tab and is taken apart the moment another tab is in front, as
 *  every surface is; a shell cannot be. So the screen - xterm.js, in an element of its
 *  own - lives here, one per tab, and the pane hands it a place to be drawn while the tab
 *  is showing and takes it back after. Switching back to a terminal finds it exactly as
 *  it was, still running, with everything it printed in between.
 *
 *  The shell starts the first time its tab is on screen, never before: a window put back
 *  after a restart with ten terminals in it starts none of them until one is looked at.
 *  And it goes when its tab does, whichever way the tab went - closed, closed with
 *  others, carried off by a space switch - because this watches the tabs rather than
 *  being told; see `watch` below. The crate ends whatever a window left behind as it
 *  reloads or closes, so nothing ever runs with nothing to show it. See docs/terminal.md.
 *
 *  Fetched with the first terminal, and with xterm.js, which is what makes it a
 *  surface's worth: nothing of it is in front of the first paint. */

import { FitAddon } from '@xterm/addon-fit'
import { type ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { type ITheme, Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { untrack } from 'svelte'
import { copyText } from '../clipboard'
import { key, plural, t } from '../i18n.svelte'
import { showCombination } from '../keys'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { Channel } from '../native'
import { tabAsk } from '../new-tab'
import { SHORTCUTS, shortcuts } from '../shortcuts.svelte'
import { isNumber, isRecord } from '../stored'
import { invoke, platform } from '../tauri'
import { type Tab, workspace } from '../workspace.svelte'
import { type Route, routeKey } from './keys'
import { keepLines, LINES, linesOf } from './lines'
import { findColours, monospace, terminalTheme } from './look'
import { asksFirst, linesIn, pasted } from './paste'
import { setPty } from './running'
import { shellName, shells, SIZES } from './shells.svelte'
import { readSpec, reportedFolder, type Spec, writeSpec } from './spec'

/** How many lines a terminal remembers above its screen: Windows Terminal keeps about
 *  nine thousand, VS Code a thousand. Five thousand is a long build log, at a few
 *  megabytes a terminal. */
const SCROLLBACK = 5000

/** How long the output has to rest before the last lines are written down; see
 *  lines.ts. */
const QUIET = 2000

/** How long after Enter a Linux shell is asked where it is: long enough for a `cd` to
 *  have happened. See `pty_folder`. */
const AFTER_ENTER = 500

/** Which Windows this is, for xterm.js's ConPTY allowances: the os plugin writes the
 *  version beside the platform, and the build is its third number. */
function windowsPty(): { backend: 'conpty'; buildNumber: number } | undefined {
  if (platform() !== 'windows') return undefined

  const os = (window as { __TAURI_OS_PLUGIN_INTERNALS__?: { version?: string } })
    .__TAURI_OS_PLUGIN_INTERNALS__
  const build = Number(os?.version?.split('.')[2])
  return { backend: 'conpty', buildNumber: Number.isFinite(build) ? build : 22000 }
}

/** The app command a keystroke is bound to, if any. Only asked of a chord or a
 *  function key: a letter typed is never one, and most of what reaches a terminal is
 *  letters typed. */
function commandOf(event: KeyboardEvent): string | null {
  const chord = event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.key)
  if (!chord) return null

  const found = SHORTCUTS.find(
    (entry) => entry.scope === 'app' && entry.run && shortcuts.pressed(entry.id, event),
  )
  return found?.id ?? null
}

/** The type a terminal's first measure waits for: xterm.js measures a cell once, as it
 *  opens, and a font that arrives after that is drawn on the wrong grid. A second at
 *  most, since a missing face is one the stack falls back from anyway. */
async function typeReady(): Promise<void> {
  await Promise.race([
    document.fonts.load(`${shells.size}px ${monospace()}`).catch(() => undefined),
    new Promise((settle) => setTimeout(settle, 1000)),
  ])
}

/** One tab's terminal: the screen, and the shell behind it. */
class Session {
  /** What the screen is drawn in. Moved from pane to pane, never made twice. */
  readonly host = document.createElement('div')
  readonly term: Terminal
  private readonly fitting = new FitAddon()
  private readonly searching = new SearchAddon()
  private readonly serializing = new SerializeAddon()

  /** The session the shell runs under, or null between shells. */
  private pty: string | null = null
  /** How many shells this tab has started, which names each one. */
  private started = 0
  private opened = false
  /** The exit code of a shell that ended with one, which Enter starts again. */
  private exited: number | null = null
  /** Whether the shell this tab was made with has been swapped for the default once. */
  private fellBack = false
  /** Keystrokes on their way, in order; see `send`. */
  private outgoing: { data: string; binary: boolean }[] = []
  private sending = false
  /** The shell being started, which keystrokes and a new size wait for: typed in the
   *  first moment, they would reach a session the crate has not made yet. */
  private spawning: Promise<unknown> = Promise.resolve()
  private resting: ReturnType<typeof setTimeout> | undefined
  private readonly watching = new ResizeObserver(() => requestAnimationFrame(() => this.fit()))

  /** The find bar, when it is up; see TerminalTab.svelte. */
  finding = $state(false)
  query = $state('')
  found = $state({ count: 0, at: -1 })

  constructor(readonly tab: Tab) {
    this.host.className = 'nib-terminal'
    const conpty = windowsPty()
    this.term = new Terminal({
      allowProposedApi: true,
      scrollback: SCROLLBACK,
      fontFamily: monospace(),
      fontSize: shells.size,
      lineHeight: 1.15,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      minimumContrastRatio: 4.5,
      rightClickSelectsWord: false,
      theme: terminalTheme(),
      ...(conpty ? { windowsPty: conpty } : {}),
    })

    this.term.loadAddon(this.fitting)
    this.term.loadAddon(this.searching)
    this.term.loadAddon(this.serializing)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(new WebLinksAddon((event, uri) => this.follow(event, uri)))

    this.term.onData((data) => this.typed(data, false))
    this.term.onBinary((data) => this.typed(data, true))
    this.term.onResize(({ cols, rows }) => this.sized(cols, rows))
    this.term.attachCustomKeyEventHandler((event) => this.pressed(event))
    this.term.parser.registerOscHandler(7, (data) => this.reported(7, data))
    this.term.parser.registerOscHandler(9, (data) => this.reported(9, data))
    this.searching.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.found = { count: resultCount, at: resultIndex }
    })

    // Before xterm.js's own, so every paste - a key, the menu, the middle button - is one
    // paste with one set of rules; see paste.ts.
    this.host.addEventListener('paste', (event) => this.pasting(event), true)
    // Copy on select, which is what a terminal does: iTerm2 out of the box, and every
    // X terminal since before there was a clipboard to copy to.
    this.host.addEventListener('mouseup', () => this.copyChosen())
    // The terminal's own menu, and not the one xterm.js sets up for the browser's: it
    // moves its hidden field under the pointer on a right press, which would make the
    // press a text field's and bring up the field's menu instead.
    this.host.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 2) event.stopPropagation()
      },
      true,
    )
    this.host.addEventListener(
      'contextmenu',
      (event) => {
        event.stopPropagation()
        this.showMenu(event)
      },
      true,
    )
    this.watching.observe(this.host)
  }

  /** Where the tab says it is and which shell it runs; the default for words that are
   *  not a terminal's. */
  private spec(): Spec {
    return readSpec(this.tab.doc) ?? { shell: shells.chosen?.id ?? '', folder: null, key: '' }
  }

  /** The tab's words changed to say so, and written down with the rest of the session. */
  private respec(spec: Spec) {
    this.tab.note.replace(writeSpec(spec), false)
    workspace.scheduleSession()
  }

  /** Drawn inside `place`: opened the first time, with the last lines it had and a
   *  shell started; moved there every time after. */
  async attach(place: HTMLElement, focus: boolean): Promise<void> {
    place.append(this.host)

    if (!this.opened) {
      this.opened = true
      await typeReady()
      if (!this.host.isConnected) {
        this.opened = false
        return
      }

      this.term.open(this.host)
      this.putBack()
      this.fit()
      void this.start()
    } else {
      this.fit()
    }

    if (focus) this.focus()
  }

  /** Out of the pane, and still running. */
  detach() {
    this.remember()
    this.host.remove()
  }

  focus() {
    if (this.opened) this.term.focus()
  }

  /** The screen, sized to its place, and the shell told. */
  fit() {
    if (!this.opened || !this.host.isConnected) return
    this.fitting.fit()
  }

  /** The type at a size; see `setSize` in shells.svelte.ts. */
  size(pixels: number) {
    this.term.options.fontSize = pixels
    this.fit()
  }

  /** The colours and the type, again, for a theme that has changed. */
  repaint(theme: ITheme, family: string) {
    this.term.options.theme = theme
    if (this.term.options.fontFamily !== family) {
      this.term.options.fontFamily = family
      this.fit()
    }
  }

  /** The tab has gone: the shell with it, and the screen. Its last lines stay, for the
   *  tab coming back through Reopen closed tab. */
  end() {
    this.remember()
    if (this.pty !== null) void invoke('pty_kill', { id: this.pty }).catch(() => undefined)
    this.pty = null
    setPty(this.tab.id, null)
    clearTimeout(this.resting)
    this.watching.disconnect()
    this.term.dispose()
    this.host.remove()
  }

  /** What was on the screen last time, above the new prompt - unless another terminal
   *  running now has the same key, which is a tab duplicated from it, not one coming
   *  back. */
  private putBack() {
    const key = this.spec().key
    const twin = [...sessions.values()].some(
      (other) => other !== this && other.opened && other.spec().key === key,
    )
    const lines = twin ? null : linesOf(key)
    if (lines) this.term.write(`${lines}\x1b[0m\r\n`)
  }

  /** The screen, written down; see lines.ts. */
  remember() {
    clearTimeout(this.resting)
    if (!this.opened) return
    keepLines(this.spec().key, this.serializing.serialize({ scrollback: LINES }))
  }

  /** A shell, in the tab's shell and folder, at the screen's size. */
  private async start(): Promise<void> {
    const spec = this.spec()
    this.started += 1
    const id = `${this.tab.id}-${this.started}`
    this.pty = id
    this.exited = null
    setPty(this.tab.id, id)

    const output = new Channel<unknown>()
    output.onmessage = (message) => this.heard(id, message)

    const { cols, rows } = this.term
    this.spawning = invoke('pty_spawn', {
      id,
      shell: spec.shell,
      folder: spec.folder,
      cols,
      rows,
      output,
    })

    try {
      await this.spawning
    } catch {
      if (this.pty === id) await this.failed(spec)
      return
    }

    // The screen may have been sized again while the shell was starting.
    if (this.term.cols !== cols || this.term.rows !== rows)
      this.sized(this.term.cols, this.term.rows)
  }

  /** A shell that would not start. Most often one that is not on this machine any
   *  more - a WSL distribution removed, a terminal restored on another computer - and
   *  then the shell Settings chose is started instead, once, and the tab renamed for
   *  it. Otherwise a line saying so, and Enter tries again. */
  private async failed(spec: Spec) {
    this.pty = null
    setPty(this.tab.id, null)

    await shells.ask()
    const instead = shells.chosen
    if (!this.fellBack && instead && instead.id !== spec.shell) {
      this.fellBack = true
      this.respec({ ...spec, shell: instead.id })
      this.tab.name = shellName(instead)
      void this.start()
      return
    }

    this.exited = -1
    this.say(t('Could not start {shell}', { shell: this.tab.shown }))
  }

  /** What the shell sent: bytes to draw, or the code it exited with. */
  private heard(id: string, message: unknown) {
    if (id !== this.pty) return

    if (message instanceof ArrayBuffer) {
      const bytes = new Uint8Array(message)
      // Said once drawn, which is what lets the crate send more; see MOST_UNSEEN.
      this.term.write(
        bytes,
        () => void invoke('pty_seen', { id, bytes: bytes.length }).catch(() => undefined),
      )
      clearTimeout(this.resting)
      this.resting = setTimeout(() => this.remember(), QUIET)
      return
    }

    if (isRecord(message) && isNumber(message.exit)) this.exitedWith(message.exit)
  }

  /** The shell exited by itself. Windows Terminal's rule: cleanly, and the tab goes
   *  with it - `exit`, Ctrl+D; with an error, and it stays to be read, with a line
   *  saying how it ended, and Enter starts it again. */
  private exitedWith(code: number) {
    this.pty = null
    setPty(this.tab.id, null)

    if (code === 0 && workspace.tabs.some((one) => one.id === this.tab.id)) {
      this.remember()
      workspace.close(this.tab.id)
      return
    }

    this.exited = code
    this.say(t('Exited with code {code}', { code }))
  }

  /** A line of the app's own on the screen, quietly: dim, and on a line of its own. */
  private say(words: string) {
    this.term.write(`\r\n\x1b[2m${words}\x1b[22m\r\n`)
  }

  /** What was typed, on its way to the shell - or, after a shell that ended badly,
   *  Enter to start another. */
  private typed(data: string, binary: boolean) {
    if (this.pty === null) {
      if (this.exited !== null && data === '\r') {
        this.term.write('\r\n')
        void this.start()
      }
      return
    }

    this.outgoing.push({ data, binary })
    void this.send()

    if (!binary && data.includes('\r') && platform() === 'linux') {
      setTimeout(() => void this.lookWhere(), AFTER_ENTER)
    }
  }

  /** Keystrokes go one call at a time and in order, whatever arrives while a call is in
   *  the air going with the next: a paste of a page is one call, not a thousand, and no
   *  two can overtake each other on the way. */
  private async send() {
    if (this.sending) return
    this.sending = true

    await this.spawning.catch(() => undefined)

    while (this.outgoing.length && this.pty !== null) {
      const binary = this.outgoing[0]?.binary ?? false
      let data = ''
      while (this.outgoing[0]?.binary === binary) data += this.outgoing.shift()?.data ?? ''

      await invoke('pty_write', { id: this.pty, data, binary }).catch(() => undefined)
    }

    this.outgoing = []
    this.sending = false
  }

  private sized(cols: number, rows: number) {
    if (this.pty !== null)
      void invoke('pty_resize', { id: this.pty, cols, rows }).catch(() => undefined)
  }

  /** Where the shell is, asked of Linux's /proc for a shell that does not say. */
  private async lookWhere() {
    if (this.pty === null) return

    const folder = await invoke<unknown>('pty_folder', { id: this.pty }).catch(() => null)
    const spec = this.spec()
    if (typeof folder === 'string' && folder && folder !== spec.folder) {
      this.respec({ ...spec, folder })
    }
  }

  /** A shell saying where it is; see `reportedFolder`. Taken, so nothing else reads it. */
  private reported(code: 7 | 9, data: string): boolean {
    if (code === 9 && !data.startsWith('9;')) return false

    const spec = this.spec()
    const folder = reportedFolder(
      code,
      data,
      platform() === 'windows',
      spec.shell.startsWith('wsl:'),
    )
    if (folder && folder !== spec.folder) this.respec({ ...spec, folder })
    return true
  }

  /** A link: followed with the modifier a browser follows one with, into a tab of its
   *  own beside this one. A plain click is the terminal's own - it is how a line is
   *  selected. See new-tab.ts. */
  private follow(event: MouseEvent, uri: string) {
    const ask = tabAsk(event)
    if (ask !== 'plain') workspace.openPage(uri, ask, this.tab.id)
  }

  /** Where a key goes; see keys.ts. */
  private pressed(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true

    const route = routeKey(
      event,
      shortcuts.platform,
      commandOf(event),
      shortcuts.pressed('edit.find', event),
    )

    // The shell's, and nobody else's: a key xterm.js has no sequence for is still not
    // the window's to act on, or a Ctrl+W it let by would close the tab.
    if (route === 'shell') {
      event.stopPropagation()
      return true
    }
    // Left alone, so the window's own handler has it, and the browser pastes into the
    // handler above.
    if (route === 'app' || route === 'paste') return false

    event.preventDefault()
    this.act(route)
    return false
  }

  private act(route: Exclude<Route, 'shell' | 'app' | 'paste'>) {
    switch (route) {
      case 'copy':
        this.copyChosen()
        return
      case 'find':
        this.finding = true
        return
      case 'select-all':
        this.term.selectAll()
        return
      case 'clear':
        this.term.clear()
        return
      case 'zoom-in':
        shells.setSize(shells.size + 1)
        return
      case 'zoom-out':
        shells.setSize(shells.size - 1)
        return
      case 'zoom-reset':
        shells.setSize(SIZES.initial)
        return
    }
  }

  private copyChosen() {
    const chosen = this.term.getSelection()
    if (chosen) void copyText(chosen)
  }

  private pasting(event: ClipboardEvent) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void this.paste(event.clipboardData?.getData('text/plain') ?? '')
  }

  /** Text into the shell, asking first where the lines would run as they land. */
  async paste(text: string) {
    if (!text || this.pty === null) return

    if (asksFirst(text, this.term.modes.bracketedPasteMode)) {
      const { prompt } = await import('../prompt.svelte')
      const lines = linesIn(text)
      const sure = await prompt.confirm({
        title: plural(lines, { one: 'Paste {count} line?', other: 'Paste {count} lines?' }),
        confirmLabel: key('Paste'),
      })
      this.focus()
      if (!sure) return
    }

    this.term.paste(pasted(text))
  }

  /** The terminal's own menu, at the pointer. */
  private showMenu(event: MouseEvent) {
    const mac = shortcuts.platform === 'mac'
    const hint = (win: string, macKey: string) =>
      showCombination(mac ? macKey : win, shortcuts.platform)

    const rows: MenuEntry[] = [
      {
        label: t('Copy'),
        hint: hint('Ctrl-Shift-c', 'Mod-c'),
        disabled: !this.term.hasSelection(),
        run: () => this.copyChosen(),
      },
      {
        label: t('Paste'),
        hint: hint('Ctrl-Shift-v', 'Mod-v'),
        run: () =>
          void navigator.clipboard
            .readText()
            .then((text) => this.paste(text))
            .catch(() => undefined),
      },
      DIVIDER,
      { label: t('Select all'), run: () => this.term.selectAll() },
      { label: t('Find'), hint: shortcuts.hint('edit.find'), run: () => (this.finding = true) },
      { label: t('Clear'), run: () => this.term.clear() },
    ]

    menu.show(event, rows)
  }

  /** Looks for `query`, from where the last look stood; `back` the other way. */
  look(query: string, back = false) {
    this.query = query
    if (!query) {
      this.searching.clearDecorations()
      this.found = { count: 0, at: -1 }
      return
    }

    if (back) this.searching.findPrevious(query, searchOptions(false))
    else this.searching.findNext(query, searchOptions(true))
  }

  /** The next match, or the one before. */
  step(by: number) {
    if (!this.query) return
    if (by < 0) this.searching.findPrevious(this.query, searchOptions(false))
    else this.searching.findNext(this.query, searchOptions(false))
  }

  closeFind() {
    this.finding = false
    this.searching.clearDecorations()
    this.term.clearSelection()
    this.focus()
  }
}

/** How a look paints: every match in the accent, softly, and the one that stands in the
 *  accent itself - what the find bar paints in a note. `incremental` keeps the match
 *  that stands while the word is still being typed. */
function searchOptions(incremental: boolean): ISearchOptions {
  const colours = findColours()
  return {
    incremental,
    decorations: {
      matchBackground: colours.match,
      activeMatchBackground: colours.here,
      matchOverviewRuler: colours.match,
      activeMatchColorOverviewRuler: colours.here,
    },
  }
}

/** Every terminal, by its tab's id. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry of screens; nothing renders from it
const sessions = new Map<string, Session>()

/** The terminal a tab has, made the first time it is asked for. */
export function sessionOf(tab: Tab): Session {
  let one = sessions.get(tab.id)
  if (!one) {
    one = new Session(tab)
    sessions.set(tab.id, one)
  }
  return one
}

export type { Session }

/** What keeps the terminals in step with the rest of the app, set going once, with the
 *  first terminal: a tab that has gone takes its shell with it, the type follows the
 *  setting, and the colours follow the theme - including a theme file that arrives a
 *  moment after it was chosen, which is why the page itself is watched rather than the
 *  store that asked for it. And the last lines are written as the window goes. */
function watch() {
  $effect.root(() => {
    $effect(() => {
      const open = new Set(workspace.tabs.map((tab) => tab.id))
      untrack(() => {
        for (const [id, one] of sessions) {
          if (open.has(id)) continue
          sessions.delete(id)
          one.end()
        }
      })
    })

    $effect(() => {
      const pixels = shells.size
      untrack(() => {
        for (const one of sessions.values()) one.size(pixels)
      })
    })
  })

  let frame = 0
  let painted = ''
  const repaint = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const theme = terminalTheme()
      const family = monospace()
      // The page's style moves for other reasons too - the zoom, the keyboard on a
      // tablet - and a terminal repainted for nothing is a frame spent for nothing.
      const now = JSON.stringify([theme, family])
      if (now === painted) return
      painted = now
      for (const one of sessions.values()) one.repaint(theme, family)
    })
  }
  const page = new MutationObserver(repaint)
  page.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  })
  page.observe(document.head, { childList: true, subtree: true, characterData: true })

  window.addEventListener('pagehide', () => {
    for (const one of sessions.values()) one.remember()
  })
}

watch()
