/** A swipe over a pane, heard and answered: two fingers sideways on a touchpad, or one
 *  from the side of the pane on a screen, go back and forward along the tab's trail.
 *
 *  Two places a swipe is heard, and one machine for both (gesture.ts):
 *
 *  - **A note, a canvas, a PDF** - anything of the app's own - says it as the wheel and
 *    touch events of the window. Only inside a pane's content: never its strip of tabs,
 *    the sidebar, or under a layer that is open. What the content would scroll itself is
 *    asked of the content (edge.ts), and a wheel a surface took for itself - the canvas
 *    and the graph pan on it, a page note scrolls its column - is the surface's.
 *  - **A web page** is a webview of its own, whose events never reach the window. The
 *    page says what it saw instead, from nib's own world in it, and the crate says that
 *    here as `nib://web-swipe`; see src-tauri/src/web_swipe.rs.
 *
 *  A step is the tab's own Back or Forward (`workspace.goBack`, `goForward`), so a web
 *  tab walks the trail its arrows walk - a tab revived after a relaunch included - and a
 *  note tab walks the notes it has shown. Fetched as the launch ends; see `warmDoors`.
 *
 *  **One swipe, one step.** The touchpad's coast goes on after a swipe has gone, and the
 *  step itself can leave a gap in it - a page is replaced, a note is drawn - long enough to
 *  read as the fingers lifting. What arrives within `SETTLE` of that is the same coast, and
 *  nobody's. */

import { mount, unmount } from 'svelte'
import { overlays } from '../overlays'
import { reading } from '../direction'
import { dur } from '../motion'
import { isDesktop, isMobile } from '../tauri'
import { viewport } from '../viewport.svelte'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { swipeChoice } from './choice.svelte'
import { chainOf, taken } from './edge'
import { QUIET, SETTLE, type Side, type Source, Swipe, type Turn } from './gesture'
import { type Room, swiping } from './shown.svelte'
import SwipeArrow from './SwipeArrow.svelte'

/** How near a pane's side a finger has to land to be a swipe and not a pan. */
export const SIDE = 24

/** How long the arrow plays out once a swipe is decided; see SwipeArrow.svelte. */
export const PLAYS = 210

/** Both ways taken: what a surface that kept the scroll for itself says. */
const KEPT: Record<Side, boolean> = { left: true, right: true }

/** Neither: what a step that is not asked says, one straight down or one the stream has
 *  decided already. */
const NEITHER: Record<Side, boolean> = { left: false, right: false }

/** One step of a swipe, from wherever it was heard. `at` is on the clock of whatever
 *  heard it, which only ever compares it with its own steps. */
export interface Heard {
  tab: Tab
  source: Source
  dx: number
  dy: number
  at: number
  scrolls: Record<Side, boolean>
}

/** The stream being heard, if any: one at a time, over one tab. */
interface Live {
  swipe: Swipe
  tab: Tab
  source: Source
  /** Whether the arrow has been out, so a decision is played rather than skipped. */
  shown: boolean
  /** Whether a step has been taken for it, so a coast cannot take a second. */
  stepped: boolean
  /** Whether that step went, so what follows it settles first. */
  went: boolean
  /** Whether it began while the last swipe's coast was settling: then it is that coast,
   *  and every step of it is nobody's. */
  swallowed: boolean
  /** The last step's time on its own clock, and on this window's. */
  at: number
  heardAt: number
}

let live: Live | null = null
let quiet: ReturnType<typeof setTimeout> | undefined
let clearing: ReturnType<typeof setTimeout> | undefined
/** Until when, on this window's clock, a touchpad's new stream is the last swipe's coast. */
let settling = 0

/** Which way a side goes: Back at the left, unless the interface reads right to left,
 *  where the history runs the other way across the screen too. */
export function wayOf(side: Side): 'back' | 'forward' {
  const back: Side = reading() === 'rtl' ? 'right' : 'left'
  return side === back ? 'back' : 'forward'
}

/** Whether `tab` has somewhere to go at each side. */
function goes(tab: Tab): Record<Side, boolean> {
  const can = (side: Side) => {
    const way = wayOf(side)
    if (tab.kind === 'web') {
      const page = pages.of(tab.id)
      return way === 'back' ? page.back : page.forward
    }
    return way === 'back' ? tab.canGoBack : tab.canGoForward
  }
  return { left: can('left'), right: can('right') }
}

/** The pane a tab is shown in. */
function paneOf(tab: Tab): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[data-pane]')
  return Array.from(all).find((one) => one.dataset.pane === tab.paneId) ?? null
}

/** What of a pane the arrow comes in over: a web tab's page, or everything under the
 *  pane's own head. */
function roomOf(pane: HTMLElement): Room {
  const page = pane.querySelector('.hole')
  const box = (page ?? pane).getBoundingClientRect()
  const head = page ? null : Array.from(pane.children).find((one) => one.classList.contains('head'))
  const top = head ? Math.max(box.top, head.getBoundingClientRect().bottom) : box.top
  return { x: box.left, y: top, width: box.width, height: box.bottom - top }
}

/** Says where the arrow is now. */
function draw(one: Live) {
  const { phase, side, progress } = one.swipe.shown
  const pane = paneOf(one.tab)
  if (!pane) return
  swiping.tab = one.tab.id
  swiping.room = roomOf(pane)
  swiping.side = side
  swiping.stage = phase === 'went' ? 'went' : phase === 'stayed' ? 'stayed' : 'tracking'
  swiping.progress = progress
  swiping.turn++
}

/** The arrow plays out and goes. */
function played() {
  clearTimeout(clearing)
  clearing = setTimeout(() => {
    swiping.tab = null
    swiping.room = null
    swiping.progress = 0
    swiping.turn++
  }, dur(PLAYS))
}

/** A decided swipe, acted on once: the step, if it went, and the arrow played out. */
function decided(one: Live, phase: 'went' | 'stayed', side: Side) {
  if (one.stepped) return
  one.stepped = true
  one.went = phase === 'went'
  if (one.shown) {
    swiping.stage = phase
    swiping.turn++
    played()
  }
  if (phase !== 'went') return
  if (wayOf(side) === 'back') workspace.goBack(one.tab.id)
  else workspace.goForward(one.tab.id)
}

/** One step of whichever stream it belongs to. A step over another tab, or from another
 *  kind of hand, ends the stream before it. */
export function heard(step: Heard): void {
  if (!swipeChoice.on) return
  if (live && (live.tab.id !== step.tab.id || live.source !== step.source)) lift()

  const now = performance.now()
  live ??= {
    swipe: new Swipe(step.source, () => ({ width: innerWidth, height: innerHeight })),
    tab: step.tab,
    source: step.source,
    shown: false,
    stepped: false,
    went: false,
    swallowed: step.source === 'touchpad' && now < settling,
    at: step.at,
    heardAt: now,
  }
  const one = live
  one.at = step.at
  one.heardAt = now
  // A touchpad never says it was let go of; a finger does. See gesture.ts. Gone quiet,
  // it was let go of that long after its last step, on that step's own clock.
  clearTimeout(quiet)
  if (step.source === 'touchpad') quiet = setTimeout(() => lift(step.at + QUIET), QUIET)
  if (one.swallowed) return

  const turn: Turn = {
    dx: step.dx,
    dy: step.dy,
    at: step.at,
    scrolls: step.scrolls,
    goes: goes(step.tab),
  }
  const shown = one.swipe.turn(turn)

  if (shown.phase === 'tracking') {
    clearTimeout(clearing)
    one.shown = true
    draw(one)
  } else if ((shown.phase === 'went' || shown.phase === 'stayed') && !one.stepped) {
    if (one.shown) draw(one)
    decided(one, shown.phase, shown.side)
  }
}

/** The fingers have lifted: the stream is decided, and the next step starts another.
 *  `at` is on the stream's own clock; left out - a stream cut short by another - it is
 *  as long after its last step as this window has waited since hearing it. */
export function lift(at?: number): void {
  clearTimeout(quiet)
  const one = live
  live = null
  if (!one || one.swallowed) return
  const when = at ?? one.at + (performance.now() - one.heardAt)
  const shown = one.swipe.lift(when)
  // A stream the content kept, or one a coast decided already, leaves nothing to decide.
  if (shown.phase === 'went' || shown.phase === 'stayed') {
    if (one.shown) draw(one)
    decided(one, shown.phase, shown.side)
  }
  if (one.went && one.source === 'touchpad') settling = performance.now() + SETTLE
}

/** The tab a window event is over, when it is one a swipe may start on: inside a pane's
 *  content, under no layer, and not a web tab, whose page says its own. */
function tabUnder(target: EventTarget | null): { tab: Tab; pane: HTMLElement; at: Element } | null {
  if (!(target instanceof Element) || overlays.depth > 0) return null
  const pane = target.closest<HTMLElement>('[data-pane]')
  if (!pane || target.closest('[data-chrome]')) return null
  const tab = workspace.showing(pane.dataset.pane ?? '')
  if (!tab || tab.kind === 'web') return null
  return { tab, pane, at: target }
}

/** Whether a wheel is a touchpad's: in pixels, with no key held, and - to start a stream
 *  - not a tilted wheel's notch: Chrome never swipes on a mouse. Inside a stream a step
 *  that happens to add up to a whole notch is still the stream's; the engine adds up
 *  what arrives within a frame. */
export function fromTouchpad(event: WheelEvent, streaming: boolean): boolean {
  if (event.deltaMode !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
    return false
  }
  const notch = 'wheelDeltaX' in event ? Number(event.wheelDeltaX) : 0
  return streaming || !(notch !== 0 && notch % 120 === 0)
}

/** Which way the content under a wheel would take it, asked only where the answer counts:
 *  a sideways step of a stream that has not decided yet. */
function scrollsUnder(event: WheelEvent, under: { tab: Tab; pane: HTMLElement; at: Element }) {
  if (event.defaultPrevented) return KEPT
  const decided = live?.tab.id === under.tab.id && !live.swipe.asking
  if (event.deltaX === 0 || decided) return NEITHER
  return taken(chainOf(under.at, under.pane))
}

function wheeled(event: WheelEvent) {
  if (!swipeChoice.on || !fromTouchpad(event, live !== null)) return
  // Every step, one straight down included: which way a stream goes is read from its
  // first. See gesture.ts.
  if (event.deltaX === 0 && event.deltaY === 0) return
  const under = tabUnder(event.target)
  if (!under) return
  heard({
    tab: under.tab,
    source: 'touchpad',
    dx: event.deltaX,
    dy: event.deltaY,
    at: event.timeStamp,
    scrolls: scrollsUnder(event, under),
  })
}

/** The finger on the screen, from the moment it landed at a pane's side. */
let finger: { tab: Tab; x: number; y: number; scrolls: Record<Side, boolean> } | null = null

function touched(event: TouchEvent) {
  finger = null
  const touch = event.touches[0]
  // A tablet held upright pulls its drawers out from the sides; see drawer-follow.ts.
  if (!swipeChoice.on || viewport.drawer || event.touches.length !== 1 || !touch) return
  const under = tabUnder(event.target)
  if (!under) return
  const room = roomOf(under.pane)
  const fromSide = touch.clientX - room.x <= SIDE || room.x + room.width - touch.clientX <= SIDE
  if (!fromSide) return
  finger = {
    tab: under.tab,
    x: touch.clientX,
    y: touch.clientY,
    scrolls: taken(chainOf(under.at, under.pane)),
  }
}

function moved(event: TouchEvent) {
  const touch = event.touches[0]
  if (!finger || !touch) return
  if (event.touches.length !== 1) {
    released(event)
    return
  }
  // A finger moving right scrolls towards the left, as two fingers on a pad do.
  heard({
    tab: finger.tab,
    source: 'touch',
    dx: finger.x - touch.clientX,
    dy: finger.y - touch.clientY,
    at: event.timeStamp,
    scrolls: finger.scrolls,
  })
  finger.x = touch.clientX
  finger.y = touch.clientY
}

function released(event: TouchEvent) {
  if (!finger) return
  finger = null
  if (live?.source === 'touch') lift(event.timeStamp)
}

/** What the crate says a page saw; see src-tauri/src/web_swipe.rs. */
export interface Said {
  tab: string
  kind: 'wheel' | 'touch' | 'lift'
  dx: number
  dy: number
  at: number
  left: boolean
  right: boolean
}

export function readSaid(value: unknown): Said | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const { tab, kind, dx, dy, at, left, right } = said
  if (typeof tab !== 'string' || (kind !== 'wheel' && kind !== 'touch' && kind !== 'lift'))
    return null
  if (typeof dx !== 'number' || typeof dy !== 'number' || typeof at !== 'number') return null
  return { tab, kind, dx, dy, at, left: left === true, right: right === true }
}

/** A page's swipe, in the window's pixels: a page zoomed in reports its own, smaller
 *  ones. */
export function pageSaid(said: Said): void {
  const tab = workspace.tabs.find((one) => one.id === said.tab)
  if (tab?.kind !== 'web' || overlays.depth > 0) return
  if (said.kind === 'lift') {
    if (live?.tab.id === tab.id) lift(said.at)
    return
  }
  const zoom = pages.of(tab.id).zoom || 1
  heard({
    tab,
    source: said.kind === 'touch' ? 'touch' : 'touchpad',
    dx: said.dx * zoom,
    dy: said.dy * zoom,
    at: said.at,
    scrolls: { left: said.left, right: said.right },
  })
}

/** Starts hearing swipes, and puts the arrow on the window. Answers the way to stop. */
export function listen(): () => void {
  const target = document.createElement('div')
  document.body.append(target)
  const arrow = mount(SwipeArrow, { target })

  window.addEventListener('wheel', wheeled, { passive: true })
  // A phone has the system's own back at the side of the screen.
  const touching = !isMobile
  if (touching) {
    window.addEventListener('touchstart', touched, { capture: true, passive: true })
    window.addEventListener('touchmove', moved, { capture: true, passive: true })
    window.addEventListener('touchend', released, { capture: true, passive: true })
    window.addEventListener('touchcancel', released, { capture: true, passive: true })
  }

  let unlisten: (() => void) | null = null
  let stopped = false
  if (isDesktop) {
    void import('@tauri-apps/api/event').then(async ({ listen: hear }) => {
      const off = await hear('nib://web-swipe', (event) => {
        const said = readSaid(event.payload)
        if (said) pageSaid(said)
      })
      if (stopped) off()
      else unlisten = off
    })
  }

  return () => {
    stopped = true
    unlisten?.()
    window.removeEventListener('wheel', wheeled)
    if (touching) {
      window.removeEventListener('touchstart', touched, { capture: true })
      window.removeEventListener('touchmove', moved, { capture: true })
      window.removeEventListener('touchend', released, { capture: true })
      window.removeEventListener('touchcancel', released, { capture: true })
    }
    lift()
    settling = 0
    void unmount(arrow)
    target.remove()
  }
}
