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
import { dragged, isTreeDrag } from '../drag-paths'
import { i18n, key, plural, t } from '../i18n.svelte'
import { identifier } from '../identifier'
import { showCombination } from '../keys'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { Channel } from '../native'
import { tabAsk } from '../new-tab'
import { owes } from '../parting'
import { SHORTCUTS, shortcuts } from '../shortcuts.svelte'
import { isNumber, isRecord } from '../stored'
import { invoke, platform } from '../tauri'
import { type Tab, workspace } from '../workspace.svelte'
import {
  dropHistory,
  fitted,
  type History,
  historyOf,
  keepHistory,
  moveLegacy,
  type Place,
  restoredAbove,
  restoredLine,
} from './history'
import { type Route, routeKey } from './keys'
import { findColours, monospace, terminalTheme } from './look'
import { type Left, pastesItself, promptEnd, reporting, tidied } from './modes'
import { asksFirst, linesIn, pasted, spokenPath } from './paste'
import { setPty } from './running'
import { shellName, shells, SIZES } from './shells.svelte'
import { readSpec, reportedFolder, type Spec, writeSpec } from './spec'

/** How many lines a terminal remembers above its screen: Windows Terminal keeps about
 *  nine thousand, VS Code a thousand. Five thousand is a long build log, at a few
 *  megabytes a terminal. */
const SCROLLBACK = 5000

/** How long the output has to rest before the last lines are written down; see
 *  history.ts. */
const QUIET = 2000

/** And how long they wait at most while it never rests - a server printing a line a
 *  second - so a crash in the middle of one loses no more than this. */
const FLOOD = 10_000

/** How long the output rests before a shell that marks no prompts is asked whether it is
 *  in front again, where a program left the mouse reported; see `idle`. */
const RESTING = 300

/** The systems whose kernel says where a shell is, asked after Enter; see `pty_folder`. */
const KERNEL_SAYS = ['linux', 'macos']

/** How long after Enter a shell is asked where it is: long enough for a `cd` to have
 *  happened. See `pty_folder`. */
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
  /** Whether the screen has changed since it was last written down, and since when. */
  private changed = false
  private since = 0
  /** Whether xterm.js has its element: before that there is no screen to fit, focus or
   *  write down. */
  private drawn = false
  /** What the tab had on its screen last time, asked for once, as it is first drawn. */
  private coming: Promise<History | null> | null = null
  /** Whether that screen is being written back, which a fit waits for: it is written at
   *  the width it was written at, and the fit after it reflows it. */
  private replaying = false
  /** Output waiting behind a prompt mark while what was left on is switched off; see
   *  `through`. Null while nothing waits. */
  private behind: [Uint8Array, () => void][] | null = null
  /** Whether this tab's shell has marked a prompt, which makes the fallback in `idle`
   *  unnecessary. */
  private marks = false
  private waitingIdle: ReturnType<typeof setTimeout> | undefined
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
    // A row of the file list dropped here is its path, typed at the prompt. The pane
    // leaves the middle of itself to the terminal for that; see `keepsMiddle` in
    // Pane.svelte.
    this.host.addEventListener('dragover', (event) => {
      if (!isTreeDrag(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    })
    this.host.addEventListener('drop', (event) => this.dropped(event))
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

  /** Where this tab's history is kept; see history.ts. */
  private place(): Place {
    return placeOf(this.tab)
  }

  /** Drawn inside `place`: opened the first time, with the screen it had last time put
   *  back and a shell started under it; moved there every time after. */
  async attach(place: HTMLElement, focus: boolean): Promise<void> {
    place.append(this.host)

    if (!this.opened) {
      this.opened = true
      this.coming ??= this.lastScreen()
      const [history] = await Promise.all([this.coming, typeReady()])
      if (!this.host.isConnected) {
        this.opened = false
        return
      }

      this.coming = null
      this.term.open(this.host)
      this.drawn = true
      this.replay(history)
    } else {
      this.fit()
    }

    if (focus) this.focus()
  }

  /** What this tab had on its screen last time - unless Restore history is off, or this
   *  is a tab duplicated from one running now and so carrying its key. That one is given
   *  a key of its own instead, so two tabs never write one file, and so is a tab from
   *  before there were keys. */
  private async lastScreen(): Promise<History | null> {
    const spec = this.spec()
    const twin = [...sessions.values()].some(
      (other) => other !== this && other.opened && other.spec().key === spec.key,
    )
    if (twin || !spec.key) {
      this.respec({ ...spec, key: identifier() })
      return null
    }

    return shells.restoring ? historyOf(this.place()) : null
  }

  /** The last screen, written back at the size it was written at and fitted to the pane
   *  after, which reflows it the way a resize would; the line saying when under it; and
   *  only then the shell, so its prompt lands under that line. On Windows the replayed
   *  lines go above the screen first, at the pane's own height; see `restoredAbove`. */
  private replay(history: History | null) {
    const fitted = () => {
      this.replaying = false
      this.fit()
    }
    if (!history) {
      fitted()
      void this.start()
      return
    }

    this.replaying = true
    const { cols, rows } = history
    if (cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 500) this.term.resize(cols, rows)
    const when = i18n.when(history.at, { dateStyle: 'medium', timeStyle: 'short' })
    const words = t('Restored {time}', { time: when })

    this.term.write(history.text, () => {
      // Every mode off before the new shell, whatever the lines switched on: a screen is
      // written down without its modes, but one a build before that wrote down may still
      // turn the mouse on. See modes.ts.
      const off = tidied(this.left(), false)
      fitted()
      const under =
        platform() === 'windows' ? restoredAbove(words, this.term.rows) : restoredLine(words)
      this.term.write(off + under, () => void this.start())
    })
  }

  /** What is switched on in the terminal as it stands. */
  private left(): Left {
    return { modes: this.term.modes, alternate: this.term.buffer.active.type === 'alternate' }
  }

  /** Out of the pane, and still running. */
  detach() {
    this.remember()
    this.host.remove()
  }

  focus() {
    if (this.drawn) this.term.focus()
  }

  /** The screen, sized to its place, and the shell told. */
  fit() {
    if (!this.drawn || this.replaying || !this.host.isConnected) return
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

  /** The tab has gone: the shell with it, and the screen. Its file goes too - a closed tab
   *  leaves nothing of itself on the disk - and its last screen stays in memory, for the
   *  tab coming back through Reopen closed tab. */
  end() {
    clearTimeout(this.resting)
    clearTimeout(this.waitingIdle)
    const place = this.place()
    if (this.drawn || !shells.restoring) {
      dropHistory(place, shells.restoring ? this.snapshot() : null)
    } else {
      // Never drawn: what it had is the file's, which goes into memory on its way out.
      void (this.coming ?? historyOf(place)).then((last) => dropHistory(place, last))
    }

    if (this.pty !== null) void invoke('pty_kill', { id: this.pty }).catch(() => undefined)
    this.pty = null
    setPty(this.tab.id, null)
    clearTimeout(this.resting)
    this.watching.disconnect()
    this.term.dispose()
    this.host.remove()
  }

  /** The screen, written down if it has changed since it last was; see history.ts. */
  remember() {
    clearTimeout(this.resting)
    this.resting = undefined
    if (!this.changed || !shells.restoring) return

    const history = this.snapshot()
    if (!history) return
    this.changed = false
    this.since = 0
    keepHistory(this.place(), history)
  }

  /** The screen as it stands, as much of it as one history may hold. */
  private snapshot(): History | null {
    if (!this.drawn) return null
    // The lines and their colours, never a mode: a screen put back never reports the
    // mouse or stays on a program's second screen. See modes.ts.
    const text = fitted((lines) =>
      this.serializing.serialize({ scrollback: lines, excludeModes: true, excludeAltBuffer: true }),
    )
    return text ? { cols: this.term.cols, rows: this.term.rows, at: Date.now(), text } : null
  }

  /** Something was printed: written down once the output rests, and at least every
   *  `FLOOD` while it does not. */
  private printed() {
    this.changed = true
    const now = Date.now()
    this.since ||= now
    clearTimeout(this.resting)
    this.resting = setTimeout(() => this.remember(), Math.min(QUIET, this.since + FLOOD - now))
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
      this.through(
        bytes,
        () => void invoke('pty_seen', { id, bytes: bytes.length }).catch(() => undefined),
      )
      this.printed()
      clearTimeout(this.waitingIdle)
      this.waitingIdle = setTimeout(() => void this.idle(), RESTING)
      return
    }

    if (isRecord(message) && isNumber(message.exit)) this.exitedWith(message.exit)
  }

  /** Output onto the screen, in order, cut at each prompt mark: where the shell begins a
   *  prompt, what a program left on is switched off - read off the screen as the mark is
   *  reached, so nothing the prompt or its line editor sets after it is touched. What
   *  arrives while that is decided waits behind it. See modes.ts. */
  private through(bytes: Uint8Array, drawn: () => void) {
    if (this.behind) {
      this.behind.push([bytes, drawn])
      return
    }

    const end = promptEnd(bytes)
    if (end < 0) {
      this.term.write(bytes, drawn)
      return
    }

    this.marks = true
    this.behind = []
    this.term.write(bytes.subarray(0, end), () => {
      const off = tidied(this.left(), pastesItself(this.spec().shell))
      if (off) this.term.write(off)

      const waiting = this.behind ?? []
      this.behind = null
      const rest = bytes.subarray(end)
      if (rest.length) this.through(rest, drawn)
      else drawn()
      for (const [one, done] of waiting) this.through(one, done)
    })
  }

  /** The output has rested, in a shell that marks no prompts - zsh, a reader's own bash
   *  prompt - with the mouse still reported: the kernel is asked whether the shell is in
   *  front again, and the reporting goes if it is. Never for WSL, whose programs Windows
   *  cannot see, so a program there would read as the shell. Only the mouse and focus:
   *  the prompt is on the screen by now, and the keys are its line editor's. */
  private async idle() {
    const pty = this.pty
    if (this.marks || pty === null || this.spec().shell.startsWith('wsl:')) return
    if (!reporting(this.left())) return

    const busy = await invoke<unknown>('pty_busy', { id: pty }).catch(() => true)
    if (busy !== false || pty !== this.pty || !reporting(this.left())) return
    this.term.write(tidied(this.left(), true, false))
  }

  /** The shell exited by itself. Windows Terminal's rule: cleanly, and the tab goes
   *  with it - `exit`, Ctrl+D; with an error, and it stays to be read, with a line
   *  saying how it ended, and Enter starts it again. */
  private exitedWith(code: number) {
    this.pty = null
    setPty(this.tab.id, null)

    if (code === 0 && workspace.tabs.some((one) => one.id === this.tab.id)) {
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

    if (!binary && data.includes('\r') && KERNEL_SAYS.includes(platform())) {
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

  /** Where the shell is, asked of the kernel for a shell that does not say: Linux's
   *  /proc, a Mac's `proc_pidinfo` - zsh, a Mac's own, says nothing. */
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

  /** Rows of the file list, as their paths at the prompt, one space apart. */
  private dropped(event: DragEvent) {
    const paths = isTreeDrag(event.dataTransfer) ? dragged(event.dataTransfer) : []
    if (!paths.length || this.pty === null) return

    event.preventDefault()
    const shell = this.spec().shell
    this.term.paste(paths.map((path) => spokenPath(path, shell)).join(' '))
    this.focus()
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

/** Where a terminal tab's history is kept: the space its document was opened in, once
 *  documents with no file say which (unsaved tabs' `home`, documents.svelte.ts), and the
 *  key its words carry. */
function placeOf(tab: Tab): Place {
  const home = (tab.note as { home?: string | null }).home ?? null
  return { space: home, key: readSpec(tab.doc)?.key ?? '' }
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
 *  store that asked for it. And the last lines are written as the window goes, which
 *  waits for them. */
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

  owes(() => {
    for (const one of sessions.values()) one.remember()
  })

  // The lines this page's own storage held, before they were the crate's.
  moveLegacy(workspace.tabs.filter((tab) => tab.kind === 'terminal').map(placeOf))
}

watch()
