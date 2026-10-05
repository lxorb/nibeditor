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
 *  stands on the overlay stack while it is up, and the page under it cuts the card out
 *  of itself, exactly as it does for a menu; see web-tab/covers.ts. A card sliding to the
 *  next tab says so to the stack, and the cut follows it there.
 *
 *  Fetched with the first pointer to rest on a tab, and not before: nothing of it is
 *  in front of the first paint. Tabs.svelte says where the pointer is. */

import { mount } from 'svelte'
import { i18n } from '../i18n.svelte'
import { overlays } from '../overlays'
import { viewport } from '../viewport.svelte'
import { pages } from '../web-tab/pages.svelte'
import { workspace, type Tab } from '../workspace.svelte'
import { type Anchor, type From, fromOf, REENTRY, showDelay, siteOf, spot, whereOf } from './card'
import TabCard from './TabCard.svelte'
import { stillOf } from './thumb'

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
  /** The space a web tab is from, where that is not the one on screen; see `fromOf`. */
  from: From | null
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

  /** A tab the pointer came to rest on, or the keyboard arrived at: the card hangs from
   *  its body, and waits as long as the widest tab of its strip says. */
  restOn(tab: Tab, node: Element, widest: number, focused = false) {
    const body = (node.closest('.tab')?.querySelector('.fill') ?? node).getBoundingClientRect()
    this.enter({
      tab,
      box: { left: body.left, right: body.right, bottom: body.bottom },
      widest,
      focused,
    })
  }

  /** The pointer came to rest on a tab, or the keyboard arrived at one. */
  enter(aim: Aim) {
    if (viewport.touch || aim.tab.id === this.hushed) return

    this.aim = aim
    clearTimeout(this.timer)
    // The still is made while the card waits, so it is there when the card is.
    void this.stillFor(aim)

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
      overlays.depth <= own && workspace.panes.dragging === null && workspace.panes.landing === null
    )
  }

  private async show(aim: Aim) {
    if (this.aim !== aim || !this.may()) return

    const { tab } = aim
    const web = tab.kind === 'web'
    const width = wide()
    const at = spot(aim.box, width, window.innerWidth, i18n.factor)
    const still = await this.stillFor(aim)
    const tall = WORDS_TALL + (still ? STILL_TALL : 0)
    const sliding = this.card !== null

    // Every card, the first and each one it slides on to: the pages under where it is
    // going are asked, not those under where it was.
    const over = await this.cover({
      left: at.x,
      top: at.y,
      right: at.x + width,
      bottom: at.y + tall,
    })
    // Moved on, or pressed, while the still was made or the pages photographed: a card
    // that never arrived takes its place on the stack back with it.
    if (this.aim !== aim) {
      if (!this.card) this.hide(false)
      return
    }
    // A page that would be left blank behind it: the card gives way; see `cover`.
    if (!over) {
      this.hide(false)
      return
    }

    this.card = {
      id: tab.id,
      title: tab.shown,
      where: web
        ? siteOf(pages.addressOf(tab.id) ?? tab.address)
        : whereOf(tab.path, workspace.spaces),
      from: web ? fromOf(tab.path, tab.note.home, workspace.spaces, workspace.activeSpaceId) : null,
      still,
      x: at.x,
      y: at.y,
      sliding,
    }
    // A slide opens nothing, and the pages under the card have to hear of it all the same:
    // they are cut round where it was until they look again, which is what the stack's
    // watchers are told to do. So the card steps off the stack and back on in one breath,
    // which every page under it hears, and the cut goes where the card went. Emil,
    // 2026-10-05: a card slid off one tab onto the next stood behind the page but for a
    // strip where its two places met.
    if (sliding && this.uncover) {
      this.uncover()
      this.uncover = overlays.show(() => this.hush())
    }

    if (!this.mounted) {
      this.mounted = true
      mount(TabCard, { target: document.body, props: { hovering: this } })
    }
  }

  /** The page's still for a web tab that is not the one in front - Chrome shows none for
   *  that one, which is already on the screen - or null. */
  private async stillFor(aim: Aim): Promise<string | null> {
    const { tab } = aim
    if (tab.kind !== 'web' || workspace.panes.at(tab.paneId)?.activeTabId === tab.id) return null
    const shot = pages.of(tab.id).shot
    return shot ? stillOf(tab.id, shot, wide()) : null
  }

  /** Put away, and off the overlay stack, which may have been joined for a card that
   *  never arrived. */
  private hide(left: boolean) {
    if (left && this.card) this.leftAt = performance.now()
    this.card = null
    this.uncover?.()
    this.uncover = null
  }

  /** Where the card would hang over a page, it goes on the overlay stack, which has the
   *  page under it look again at what is over it: the card is cut out of the page and the
   *  page goes on round it (see web-tab/covers.ts). An engine that cannot cut puts the
   *  page behind its still instead, so there the pages under the card are photographed
   *  first - only those, because a page the card is not over is left alone.
   *
   *  Answers whether the card may stand there. A page the engine would not photograph
   *  stays in front of the card rather than stepping back for it: behind it there would
   *  be an empty pane - the black Emil saw under a hovered tab on 2026-10-03 - and the
   *  card is a glance, where the page is the thing being read. Chrome never blanks a page
   *  for its card either. */
  private async cover(box: {
    left: number
    top: number
    right: number
    bottom: number
  }): Promise<boolean> {
    const under = workspace.panes.all
      .map((pane) => workspace.tabs.find((one) => one.id === pane.activeTabId))
      .filter((one): one is Tab => one?.kind === 'web')
      .filter((one) => pages.of(one.id).live && pages.of(one.id).shown)
      .filter((one) => overlaps(one.paneId, box))
    if (under.length === 0) return true

    if (!pages.cuts) {
      await Promise.all(under.map((one) => pages.shoot(one.id)))
      if (under.some((one) => pages.of(one.id).shot === null)) return false
    }
    this.uncover ??= overlays.show(() => this.hush())
    return true
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
