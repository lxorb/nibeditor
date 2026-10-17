/** The document, and nothing else.
 *
 *  Full screen takes the app away and leaves what is being read or drawn: the
 *  tab in front of the pane worked in, alone, as Full window fills it, and the window
 *  full screen: Chrome's F11 for any tab (docs/keyboard.md, "Full screen"). Nothing
 *  about it is remembered, and there are five ways back: the button (never over a web
 *  page), Escape, back on Android, the menu row, and F11. */

import { currentWindow } from './tauri'
import { afterQuiet } from './timing'

/** `workspace.panes`, as far as full screen reads and writes it. */
export interface Panes {
  fills: string | null
  readonly focusedId: string
  readonly focused: { readonly activeTabId: string | null }
}

/** How long the way out stays lit after the last thing moved. Long enough to
 *  find, short enough that a page being read is not sharing it with a button. */
export const IDLE = 2600

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Escape gives the screen back unless it was `spent` or a field or shell has it. */
export function escapeLeaves(
  spent: boolean,
  holder: { readonly tagName?: string } | null,
): boolean {
  return !spent && !FIELDS.has(holder?.tagName ?? '')
}

/** How often a moving pointer is allowed to re-arm that: a pointer crossing the
 *  screen says the same thing sixty times a second. */
const STIR = 400

class FullScreen {
  /** Whether the app is out of the way. */
  on = $state(false)
  /** Whether the way out has faded back: still there, still reachable by a key,
   *  no longer part of what is being read. */
  idle = $state(false)

  /** The way out fades once nothing has moved for a while; see `wake`. */
  private readonly fading = afterQuiet(() => (this.idle = true), IDLE)
  private stirred = 0
  private panes: Panes | null = null
  private filledBefore: string | null = null

  async toggle(panes: Panes) {
    if (this.on) await this.leave()
    else await this.enter(panes)
  }

  async enter(panes: Panes) {
    if (this.on || panes.focused.activeTabId === null) return

    this.on = true
    this.panes = panes
    this.filledBefore = panes.fills
    panes.fills = panes.focusedId
    this.wake()
    await this.window(true)
  }

  async leave() {
    if (!this.on) return

    this.on = false
    this.idle = false
    this.fading.cancel()
    const panes = this.panes
    if (panes) panes.fills = this.filledBefore === panes.focusedId ? this.filledBefore : null
    this.panes = null
    this.filledBefore = null
    if (typeof document !== 'undefined')
      document.removeEventListener('fullscreenchange', this.given)
    await this.window(false)
  }

  /** The browser's own full screen, ended by the browser. A browser that granted it
   *  keeps Escape for itself - the key never reaches the page, and the page is told only
   *  that the document left full screen - so the app was left out of the way in a
   *  window that was not full screen any more, until a second Escape. The window going
   *  is the reader asking for the screen back, the way the key would have. */
  private readonly given = () => {
    if (document.fullscreenElement !== null) return
    document.removeEventListener('fullscreenchange', this.given)
    void this.leave()
  }

  /** Something moved, so the way out is lit again and fades once nothing has
   *  moved for a while. Called from every pointer that crosses the screen, so it
   *  answers a moving hand once every `STIR` rather than on every event. */
  stir(now: number = Date.now()) {
    if (!this.on || (!this.idle && now - this.stirred < STIR)) return

    this.stirred = now
    this.wake()
  }

  /** The screen follows the pane worked in, and is given back once it shows nothing. */
  follow() {
    const panes = this.panes
    if (!this.on || !panes) return

    if (panes.focused.activeTabId === null) void this.leave()
    else if (panes.fills !== panes.focusedId) panes.fills = panes.focusedId
  }

  private wake() {
    this.idle = false
    this.fading()
  }

  /** The window itself, where there is one to ask: the desktop's frame, or the
   *  browser's own chrome. A platform that will not do it - a webview on a phone,
   *  a browser that refuses outside a gesture - changes nothing here: the app is
   *  already out of the way, which is what was asked for. */
  private async window(on: boolean) {
    try {
      const window = await currentWindow()
      await window.setFullscreen(on)
      // Only a browser's document is ever full screen; the desktop's frame is the
      // window's, and a webview on a phone has none to give.
      if (on && this.on && typeof document !== 'undefined' && document.fullscreenElement) {
        document.addEventListener('fullscreenchange', this.given)
      }
    } catch {
      // Nothing to say to the reader: the document is full screen either way.
    }
  }
}

export const fullscreen = new FullScreen()
