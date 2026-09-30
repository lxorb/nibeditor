/** Chrome's tab hover card: what a tab is called in full, where it lives, and the
 *  page as it was left, in a card under the tab after the pointer has rested on it.
 *
 *  Chrome's gesture throughout (docs/chrome-tabs.md, card.ts for the numbers): the
 *  first card waits, longer the more of every name the strip already shows; one card
 *  up, the next tab's comes at once and the card slides across to it; back on the
 *  strip a moment after leaving it, the card is there again at once. Any press, any
 *  key, a turn of the wheel or the window losing the pointer puts it away, and the tab
 *  that was pressed says nothing more until the pointer has left it. Never over a menu
 *  or anything else the app has open, never while something is being dragged, never
 *  under a finger. A tab the keyboard walks to shows its card at once, as Chrome's does.
 *
 *  A native page draws over every pixel of HTML, so a card that would hang over one
 *  photographs the pages on screen first and stands on the overlay stack while it is
 *  up: the pages step behind their stills, exactly as they do for a menu, and come
 *  back as the card goes. Both engines photograph through `pages.shoot`.
 *
 *  Fetched with the first pointer to rest on a tab, and not before: nothing of it is
 *  in front of the first paint. Tabs.svelte says where the pointer is. */

import { mount } from 'svelte'
import { i18n } from '../i18n.svelte'
import { overlays } from '../overlays'
import { viewport } from '../viewport.svelte'
import { pages } from '../web-tab/pages.svelte'
import { workspace, type Tab } from '../workspace.svelte'
import { type Anchor, REENTRY, showDelay, siteOf, spot, whereOf } from './card'
import TabCard from './TabCard.svelte'

/** What the pointer, or the keyboard, is resting on. */
export interface Aim {
  tab: Tab
  /** The tab's body on the glass. */
  box: Anchor
  /** The widest tab of its strip, which decides how long every tab of it waits. */
  widest: number
  /** Arrived at by the keyboard, which gets its card at once. */
  focused?: boolean
}

/** What the card shows, and where. */
export interface Shown {
  id: string
  title: string
  where: string
  still: string | null
  x: number
  y: number
  /** Moving over from another tab's card rather than arriving. */
  sliding: boolean
}

/** The card's width: Chrome's is its standard tab, which is the bubble's own widest. */
const WIDE_REM = 16

/** How tall a card is, near enough to know whether it reaches a page under it: a name
 *  and a line of where, and a still of sixteen by nine under them. */
const WORDS_TALL = 72
const STILL_TALL = 144

class Hovering {
  card = $state<Shown | null>(null)

  private aim: Aim | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  /** When the pointer last left the strip with a card up, for the slip back. */
  private leftAt = Number.NEGATIVE_INFINITY
  /** The tab a press landed on, which says nothing more until the pointer leaves it. */
  private hushed: string | null = null
  /** Off the overlay stack again, while the card is on it. */
  private uncover: (() => void) | null = null
  private mounted = false

  constructor() {
    // Chrome's event sniffer: whatever the hand does next, the card is in its way.
    // Capturing, so the card is off the overlay stack before anything reads it.
    const hush = () => this.hush()
    window.addEventListener('pointerdown', hush, true)
    window.addEventListener('wheel', hush, { capture: true, passive: true })
    window.addEventListener('blur', hush)
    window.addEventListener(
      'keydown',
      (event) => {
        // The arrows walk a strip the keyboard is in, and the card walks with them.
        if (WALKING.has(event.key) && inStrip(document.activeElement)) return
        this.hush()
      },
      true,
    )
  }

  /** The pointer came to rest on a tab, or the keyboard arrived at one. */
  enter(aim: Aim) {
    if (viewport.touch || aim.tab.id === this.hushed) return

    this.aim = aim
    clearTimeout(this.timer)

    const now = this.card !== null || aim.focused === true || this.slippedBack()
    if (now) void this.show(aim)
    else this.timer = setTimeout(() => void this.show(aim), showDelay(aim.widest))
  }

  /** The pointer left a tab, or the keyboard did. Maybe for the tab beside it, which
   *  says so in the same breath, so the card waits that breath before it goes. */
  leave(tabId: string) {
    if (this.hushed === tabId) this.hushed = null
    if (this.aim?.tab.id !== tabId) return

    this.aim = null
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.aim) this.hide(true)
    })
  }

  /** Put away by the hand doing something, and not shown again for the tab under it. */
  hush() {
    if (!this.aim && !this.card) return

    this.hushed = this.aim?.tab.id ?? this.card?.id ?? null
    this.aim = null
    clearTimeout(this.timer)
    this.hide(false)
  }

  private slippedBack(): boolean {
    return performance.now() - this.leftAt < REENTRY
  }

  /** Nothing of the app's is open, and nothing is being carried. The card's own place
   *  on the overlay stack does not count against it. */
  private may(): boolean {
    const own = this.uncover ? 1 : 0
    return (
      overlays.depth <= own &&
      workspace.panes.dragging === null &&
      workspace.panes.landing === null
    )
  }

  private async show(aim: Aim) {
    if (this.aim !== aim || !this.may()) return

    const { tab } = aim
    const active = workspace.panes.at(tab.paneId)?.activeTabId === tab.id
    const web = tab.kind === 'web'
    // Chrome shows the page only for a tab that is not the one in front: that one is
    // already on the screen.
    const still = web && !active ? pages.of(tab.id).shot : null
    const width = wide()
    const at = spot(aim.box, width, window.innerWidth, i18n.factor)

    if (!this.card) {
      const tall = WORDS_TALL + (still ? STILL_TALL : 0)
      await this.cover({ left: at.x, top: at.y, right: at.x + width, bottom: at.y + tall })
      // Moved on, or pressed, while the pages were being photographed: the pages come
      // back out from behind their stills.
      if (this.aim !== aim) {
        this.hide(false)
        return
      }
    }

    this.card = {
      id: tab.id,
      title: tab.shown,
      where: web ? siteOf(pages.addressOf(tab.id) ?? tab.address) : whereOf(tab.path, workspace.spaces),
      still,
      x: at.x,
      y: at.y,
      sliding: this.card !== null,
    }

    if (!this.mounted) {
      this.mounted = true
      mount(TabCard, { target: document.body, props: { hovering: this } })
    }
  }

  /** Put away, and off the overlay stack, which may have been joined for a card that
   *  never arrived. */
  private hide(left: boolean) {
    if (left && this.card) this.leftAt = performance.now()
    this.card = null
    this.uncover?.()
    this.uncover = null
  }

  /** Where the card would hang over a page, every page on screen is photographed and
   *  the card goes on the overlay stack, which puts them behind their stills. All of
   *  them and not only the one under it, because the stack hides every page. */
  private async cover(box: { left: number; top: number; right: number; bottom: number }) {
    if (this.uncover) return

    const showing = workspace.panes.all
      .map((pane) => workspace.tabs.find((one) => one.id === pane.activeTabId))
      .filter((one): one is Tab => one?.kind === 'web')
      .filter((one) => pages.of(one.id).live && pages.of(one.id).shown)
    if (!showing.some((one) => overlaps(one.paneId, box))) return

    await Promise.all(showing.map((one) => pages.shoot(one.id)))
    this.uncover = overlays.show(() => this.hush())
  }
}

/** The keys that walk a strip of tabs; see roving.ts. */
const WALKING = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

function inStrip(node: Element | null): boolean {
  return !!node?.closest('[data-strip]')
}

/** The card's width on the glass, which is the bubble's at the root's own size. */
function wide(): number {
  return WIDE_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
}

function overlaps(
  paneId: string,
  box: { left: number; top: number; right: number; bottom: number },
): boolean {
  const pane = document.querySelector(`[data-pane="${CSS.escape(paneId)}"]`)
  if (!pane) return false

  const at = pane.getBoundingClientRect()
  return at.left < box.right && box.left < at.right && at.top < box.bottom && box.top < at.bottom
}

export const hovering = new Hovering()
