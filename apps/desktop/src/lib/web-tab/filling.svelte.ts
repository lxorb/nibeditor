/** A page holding the whole screen: a video's own full screen button, or YouTube's `f`.
 *
 *  The engine can only give a page the whole of its webview, and the webview was the
 *  pane, so a video "in full screen" filled a rectangle in the middle of the app. Chrome
 *  gives it the screen. So when the engine says a page holds a full screen element (see
 *  web_page.rs), the window goes full screen and the tab places its page over all of it;
 *  when the page lets go - Escape, F11, the video's own button - the window goes back to
 *  what it was. A window that was already full screen, because the reader had put the app
 *  there, stays full screen.
 *
 *  One page at a time, and every other page steps out of the way while one holds the
 *  screen: a second pane's page is a webview too, and would otherwise be drawn over the
 *  video. See `coverOf` in WebTab.svelte. */

import { currentWindow } from '../tauri'

class Filling {
  /** The tab whose page holds the screen, or null. */
  by = $state<string | null>(null)
  /** The same, as a plain field: what `give` decides from, so an effect that calls it
   *  never reads what it writes. */
  private holder: string | null = null
  /** Whether the window was full screen before a page took it. */
  private before = false

  /** A page has taken the screen. */
  async take(tabId: string): Promise<void> {
    if (this.holder === tabId) return

    const window = await currentWindow()
    if (this.holder === null) this.before = await window.isFullscreen().catch(() => false)
    this.holder = tabId
    this.by = tabId
    await window.setFullscreen(true).catch(() => undefined)
  }

  /** A page has let go of the screen, or its tab went out of sight while it held it. */
  async give(tabId: string): Promise<void> {
    if (this.holder !== tabId) return

    this.holder = null
    this.by = null
    if (this.before) return
    const window = await currentWindow()
    await window.setFullscreen(false).catch(() => undefined)
  }
}

export const filling = new Filling()
