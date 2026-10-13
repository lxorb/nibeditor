/** What of a web tab's page the app's own layers are over.
 *
 *  A page is a native webview that draws above every pixel of the window's HTML, so
 *  something of the app's over a page has to be answered by the page. It used to be
 *  answered by hiding the whole page whenever anything at all was open - a tab's hover
 *  card over the strip, a menu over the file list - and every page in the window stepped
 *  behind a still picture of itself, or behind nothing where there was no picture yet.
 *  Emil, 2026-10-03: *"While a toast shows or while hovering things, the website is
 *  sometimes invisible until he stops."*
 *
 *  So the question is asked of each page and of each layer: which of the app's layers
 *  are over *this* page, and where. A layer beside the page leaves it alone. A layer
 *  that floats over it - a menu, a dropdown, a card, a site's popover under the bar - is
 *  cut out of the page in its own shape, and the page goes on being the page around it
 *  (see src-tauri/src/web_cut.rs). A scrim covers the whole window, so a sheet over one
 *  covers all of the page, and so does a clear one: it is there to catch the press
 *  outside the menu, and a page left over it would take that press.
 *
 *  The layers are found by the shapes the theme package gives them, `.nib-layer`,
 *  `.nib-bubble`, `.nib-screen` and `.nib-scrim`, so a layer written tomorrow in one of
 *  them is covered on the day it is written - and by the row the app's own notices float
 *  in over the foot of the panes, whatever each card in it wears (see `.notices` in
 *  App.svelte). Anything else over the page - a drawer, a deck being presented - is found
 *  by the hit test the pane has always done, and covers all of it, which is the safe
 *  answer for a thing nothing here knows the shape of. */

import type { Rect } from './pages.svelte'

/** One of the app's layers over a page, in the page's own coordinates, with its corner. */
interface Hollow extends Rect {
  radius: number
}

/** What of a page is under the app's layers: all of it, and the layers themselves. */
export interface Cut {
  all: boolean
  hollows: Hollow[]
}

/** Something of the app's on the window, as `layersOver` finds it. */
export interface Layer {
  box: Rect
  radius: number
  /** A scrim, clear or not, which covers the whole window; otherwise a floating layer. */
  scrim: boolean
  /** A card in the notices row, which stands at the foot of the panes; see `clearOf`. */
  notice?: boolean
  /** The element itself, which the page watches for a change of size; see WebTab.svelte. */
  node?: Element
}

/** The row the app's notices float in: a toast, the update notice, the storage card,
 *  the recording pill. See `.notices` in App.svelte. */
const NOTICES = '[data-notices]'
/** And each card in it, whatever it wears. */
const CARDS = `${NOTICES} > *`

/** The shapes the theme package gives every layer that floats (see base.css), the
 *  arrow a swipe brings in over a page, which is round and moves with the fingers (see
 *  back-swipe/SwipeArrow.svelte), and each card in the notices row. */
const FLOATING = `.nib-layer, .nib-bubble, .nib-screen, .nib-swipe, ${CARDS}`
const SCRIMS = '.nib-scrim'

function meets(one: Rect, other: Rect): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}

/** What of a page at `hole` the layers cover, or null for none of it. Pure. */
export function cutOf(hole: Rect, layers: readonly Layer[]): Cut | null {
  const over = layers.filter(
    (one) => one.box.width > 0 && one.box.height > 0 && meets(one.box, hole),
  )
  if (over.length === 0) return null

  return {
    all: over.some((one) => one.scrim),
    hollows: over
      .filter((one) => !one.scrim)
      .map((one) => ({
        x: one.box.x - hole.x,
        y: one.box.y - hole.y,
        width: one.box.width,
        height: one.box.height,
        radius: one.radius,
      })),
  }
}

/** A cut of all of the page. */
export const ALL: Cut = { all: true, hollows: [] }

/** How much of a page has to be left above the notices for the page to stand clear of
 *  them rather than behind its still: half of it. */
const LEFT = 0.5

/** Where a page goes on an engine that cannot cut, and the layers still over it there.
 *
 *  Such an engine can only answer a layer by hiding the page behind its still, and a
 *  notice is up for as long as nobody answers it - the update notice for a whole day -
 *  with the page behind a picture of itself all that time, or behind nothing where
 *  there was no picture yet. A notice stands at the foot of the panes, so the page is
 *  ended above it instead, the way Chrome gives its download bar and its infobars room
 *  of their own rather than drawing them over the page: the page stays live, and the
 *  notice is in a band of the pane's own. Only where that leaves the page most of its
 *  height; past that, the notices are layers like any other. Pure. */
export function clearOf(hole: Rect, layers: readonly Layer[]): { box: Rect; layers: Layer[] } {
  const notices = layers.filter(
    (one) => one.notice && one.box.width > 0 && one.box.height > 0 && meets(one.box, hole),
  )
  if (notices.length === 0) return { box: hole, layers: [...layers] }

  const top = Math.min(...notices.map((one) => one.box.y))
  const height = Math.floor(top - hole.y)
  if (height < hole.height * LEFT) return { box: hole, layers: [...layers] }
  return {
    box: { ...hole, height },
    layers: layers.filter((one) => !notices.includes(one)),
  }
}

function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** Whether a layer is drawn at all. A hint in the sidebar foot stays in the document
 *  while the sidebar is shut, hidden with the column it stands in and still laid out
 *  over the foot of the page beside it - and a page cut round it showed an empty box
 *  where nothing was. Not its opacity: a layer fading in starts at none, and is a layer
 *  from its first frame. An engine with no way to ask draws it, as before. */
function seen(node: Element): boolean {
  if (typeof node.checkVisibility !== 'function') return true
  return node.checkVisibility({ visibilityProperty: true })
}

/** Every layer of the app's on the window that is drawn, but those inside `hole` itself -
 *  a card the pane draws in its own room is under the page by design. */
export function layersOver(hole: HTMLElement): Layer[] {
  const found: Layer[] = []
  for (const node of document.querySelectorAll(`${FLOATING}, ${SCRIMS}`)) {
    if (hole.contains(node) || !seen(node)) continue
    const scrim = node.matches(SCRIMS)
    found.push({
      box: boxOf(node),
      radius: scrim ? 0 : parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0,
      scrim,
      notice: node.matches(CARDS),
      node,
    })
  }
  return found
}

/** Whether any layer is still moving in or out: its shape has not settled, so the page
 *  is asked again next frame. */
export function moving(hole: HTMLElement): boolean {
  for (const node of document.querySelectorAll(`${FLOATING}, ${SCRIMS}`)) {
    if (hole.contains(node)) continue
    if (node.getAnimations().some((one) => one.playState === 'running')) return true
  }
  return false
}

/** Whether something nothing here knows the shape of is over the page: the hit test at
 *  nine points the pane has always done, less the layers already found. */
export function strangerOver(hole: HTMLElement): boolean {
  const box = hole.getBoundingClientRect()
  for (const x of [0.08, 0.5, 0.92]) {
    for (const y of [0.08, 0.5, 0.92]) {
      const on = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)
      if (on === null || on === hole || hole.contains(on)) continue
      if (on.closest(`${FLOATING}, ${SCRIMS}`)) continue
      return true
    }
  }
  return false
}

/** The rows the app's notices float in. A notice comes and goes without a press and is
 *  on no overlay stack, so a page hears of one by watching the row change size: empty,
 *  it has none. */
export function noticeRows(): Element[] {
  return [...document.querySelectorAll(NOTICES)]
}

/** Whether a change to the document brought a layer or took one away: a node that is
 *  one or holds one, or any card put in or taken out of the notices row - which, once
 *  out of the row, no longer matches the selector that found it. Pure but for the
 *  nodes it is handed. */
export function bringsLayer(
  record: Pick<MutationRecord, 'target' | 'addedNodes' | 'removedNodes'>,
): boolean {
  if (record.target instanceof Element && record.target.matches(NOTICES)) return true
  const any = `${FLOATING}, ${SCRIMS}`
  for (const nodes of [record.addedNodes, record.removedNodes]) {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue
      if (node.matches(any) || node.querySelector(any) !== null) return true
    }
  }
  return false
}

const told = new Set<() => void>()
let arriving: MutationObserver | null = null

/** Says to `tell` whenever a layer comes into the window or leaves it, whatever brought
 *  it. Most layers arrive by a press or on the overlay stack, which every page already
 *  hears; these do not - a hint, a card a row puts up under the pointer, the second
 *  toast in a row that did not change size, a layer written tomorrow by somebody who
 *  never heard of the stack - and a page that never heard of one left it drawn behind
 *  the page. One observer for the window, however many pages listen; the answer is
 *  only "look again", which is coalesced onto a frame by whoever is told. */
export function watchArrivals(tell: () => void): () => void {
  if (typeof MutationObserver !== 'function') return () => undefined
  told.add(tell)
  arriving ??= new MutationObserver((records) => {
    if (!records.some(bringsLayer)) return
    for (const one of told) one()
  })
  if (told.size === 1) arriving.observe(document.body, { childList: true, subtree: true })
  return () => {
    told.delete(tell)
    if (told.size === 0) arriving?.disconnect()
  }
}
