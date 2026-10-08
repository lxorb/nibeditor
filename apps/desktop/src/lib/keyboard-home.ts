/** Where the keyboard was in this window's own page, and the keyboard put back there.
 *
 *  Emil, 2026-09-30: coming back to nib, he had to click before he could type. The
 *  crate keeps which of the window's webviews had the keyboard and hands it back as the
 *  window comes back; see src-tauri/src/keyboard.rs. This is the other half of the same
 *  record: which element of the app's own page, and the crate told whenever a person
 *  takes the keyboard into this page, so it knows the keyboard is no longer in a site.
 *
 *  Two moments read it. **The window coming back** with nothing focused here - the
 *  engine keeps the focused element across a switch of windows, so this is a net under
 *  it - puts the keyboard back in the note, the terminal or the field it was in. **One of
 *  the app's own layers closing** - the palette, a menu, a sheet, a site's question -
 *  with the keyboard nowhere, because what had it was the layer:
 *  once the layer has gone, the keyboard goes back to the site it was in, or to the
 *  element here. A layer that put the keyboard somewhere on its way out, a note it
 *  opened or a name to type, keeps it there.
 *
 *  What is not a place the keyboard was: an element inside a layer, and a button, a tab
 *  or a link pressed with the pointer. Chrome keeps its toolbar out of the keyboard's way
 *  like this, so a menu opened over a page gives the page its typing back as it closes.
 *
 *  Fetched at the launch's last turn, where it listens for itself; see `warmDoors`. */

import { overlays } from './overlays'
import { invoke, isDesktop } from './tauri'
import { IN_A_PAGE } from './trap'

/** What a press lands on on its way to something else. */
const PRESSED_THROUGH = [
  'button',
  'a[href]',
  'summary',
  'select',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="slider"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  'input[type="color"]',
  'input[type="file"]',
].join(', ')

/** How long a layer that has closed may still be in the document on its way out; the
 *  same wait as `LEAVING` in web-tab/WebTab.svelte. */
const LEAVING = 300

/** How long the crate holds the keyboard for a site still out of sight; `OWED_MS` in
 *  src-tauri/src/keyboard.rs. */
const OWED = 1000

/** Whether the keyboard is nowhere in this page. */
export function adrift(at: Element | null): boolean {
  return !at || at === document.body || at === document.documentElement || !at.isConnected
}

/** Whether a press putting the keyboard here was only on the way to something else. */
export function pressedThrough(at: Element): boolean {
  return at.matches(PRESSED_THROUGH)
}

class KeyboardHome {
  /** The element here the keyboard was last in, outside every layer. */
  private here: HTMLElement | null = null
  /** The element that took the keyboard last, layers and all, and whether a layer was up. */
  private last: Element | null = null
  private lastInLayer = false
  /** Whether the crate knows the keyboard is in this page since it last let go of it. */
  private told = false
  /** A pointer press is putting the keyboard somewhere, within its own turn. */
  private pressing = false
  /** The page is taking the keyboard back from another window, and the engine is focusing
   *  the element it kept: that is not a person choosing it. */
  private regaining = false
  private settling = 0

  constructor() {
    const capture = { capture: true }
    addEventListener('pointerdown', () => this.pressed(), capture)
    addEventListener('focusin', (event) => this.focused(event), capture)
    addEventListener('keydown', (event) => this.typed(event), capture)
    addEventListener('blur', (event) => this.window(event, false), capture)
    addEventListener('focus', (event) => this.window(event, true), capture)
    overlays.watch(() => {
      if (overlays.depth === 0) this.settle()
    })
    if (isDesktop) void invoke('keyboard_watch').catch(() => undefined)
  }

  private pressed() {
    this.pressing = true
    setTimeout(() => (this.pressing = false))
  }

  private focused(event: FocusEvent) {
    const at = event.target
    if (!(at instanceof HTMLElement)) return

    this.last = at
    this.lastInLayer = overlays.depth > 0
    if (this.lastInLayer || this.regaining || !document.hasFocus()) return
    if (this.pressing && pressedThrough(at)) return

    this.here = at
    this.say()
  }

  private typed(event: KeyboardEvent) {
    if (!event.isTrusted || overlays.depth > 0) return
    // A modifier alone is not typing: Alt is the first half of Alt+Tab.
    if (['Alt', 'Control', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return
    this.say()
  }

  /** The crate told, once each time this page has the keyboard again. */
  private say() {
    document.documentElement.removeAttribute(IN_A_PAGE)
    if (this.told || !isDesktop) return
    this.told = true
    void invoke('keyboard_here').catch(() => undefined)
  }

  private window(event: Event, coming: boolean) {
    // The window's own, and not an element's, which the capturing turn hears too.
    if (event.target instanceof Node) return

    if (!coming) {
      this.told = false
      // To a site in this window, or to another program, which the crate can tell apart.
      if (isDesktop) void this.went()
      return
    }

    this.regaining = true
    setTimeout(() => (this.regaining = false))
    requestAnimationFrame(() => {
      if (document.hasFocus()) this.orHome()
    })
  }

  private async went() {
    if (await invoke<boolean>('keyboard_went').catch(() => false)) {
      document.documentElement.setAttribute(IN_A_PAGE, '')
    }
  }

  /** The last layer closed: once it has gone, the keyboard goes back if nothing took it. */
  private settle() {
    cancelAnimationFrame(this.settling)
    const until = performance.now() + LEAVING
    // A frame first, for whatever the layer opened to take the keyboard itself: the
    // caret goes into a note on the frame after it arrives; see App.svelte.
    const look = (first: boolean) => {
      this.settling = requestAnimationFrame(() => {
        if (overlays.depth > 0) return
        const at = document.activeElement
        const leaving = !adrift(at) && at === this.last && this.lastInLayer
        if (first || (leaving && performance.now() < until)) {
          look(false)
          return
        }
        if (adrift(at) && (this.lastInLayer || !this.last?.isConnected)) void this.back()
      })
    }
    look(true)
  }

  private async back() {
    const paged = isDesktop && (await invoke<boolean>('keyboard_back').catch(() => false))
    // A site still out of sight under the layer takes it as it is shown again, which the
    // crate waits a second for; one that is never shown again leaves it with this page.
    if (paged) {
      setTimeout(() => {
        if (document.hasFocus()) this.orHome()
      }, OWED)
    } else this.orHome()
  }

  /** Home, if the keyboard is still nowhere in this page and nothing is over it. */
  private orHome() {
    if (overlays.depth === 0 && adrift(document.activeElement)) this.home()
  }

  private home() {
    if (this.here?.isConnected) this.here.focus({ preventScroll: true })
  }
}

new KeyboardHome()
