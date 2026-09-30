/** Which note is being presented.
 *
 *  Only that, so the keyboard, the palette and the View menu all mean the same
 *  thing by Present and none of them has to know how a stage is built. The deck
 *  itself, where in it the presenter is and everything that moves lives in
 *  Slides.svelte, which is on the page only while this says a note is up.
 *
 *  Presenting is not a mode a note is left in: it belongs to the ten minutes
 *  somebody is talking, so nothing here is written down or shared. */

import { isDeck } from '@nib/markdown/slide-breaks'
import { currentWindow } from '../tauri'
import { workspace } from '../workspace.svelte'

class Present {
  /** The tab whose note is on the stage, or null. A tab rather than a document,
   *  because presenting starts from the slide the caret is on and the caret
   *  belongs to a tab. */
  tabId = $state<string | null>(null)

  readonly on = $derived(this.tabId !== null)

  /** Whether the window was already full screen when presenting began, so
   *  leaving puts it back the way it was found rather than always shrinking it. */
  private wasFullscreen = false

  /** Starts on `tabId`, or on the tab being written in. A note with no rule in
   *  it is not a deck and there is nothing to present. */
  start(tabId: string | null = workspace.activeTabId) {
    const tab = workspace.tabs.find((one) => one.id === tabId)
    if (tab?.kind !== 'note') return

    workspace.flush()
    if (!isDeck(tab.doc)) return

    this.tabId = tab.id
    void this.fill()
  }

  stop() {
    if (this.tabId === null) return

    this.tabId = null
    void this.shrink()
  }

  toggle(tabId: string | null = workspace.activeTabId) {
    if (this.on) this.stop()
    else this.start(tabId)
  }

  /** Whether there is a deck to present at all, which is what greys the row out
   *  in the menu and in the palette. */
  get available(): boolean {
    const tab = workspace.active
    if (tab?.kind !== 'note') return false

    return isDeck(tab.doc)
  }

  /** The whole screen, where the platform gives it. The browser shim answers
   *  the same two calls with the page's own full screen, which it only allows
   *  from a gesture - and Present always comes from one, a key, a menu row or a
   *  palette row. A refusal costs nothing: the deck covers the window either
   *  way, which is the whole screen already on a phone. */
  private async fill() {
    const window = await currentWindow()
    this.wasFullscreen = await window.isFullscreen()
    if (!this.wasFullscreen) await window.setFullscreen(true)
  }

  private async shrink() {
    if (this.wasFullscreen) return

    const window = await currentWindow()
    await window.setFullscreen(false)
  }
}

export const present = new Present()
