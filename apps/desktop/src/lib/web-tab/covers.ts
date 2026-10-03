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
 *  them is covered on the day it is written. Anything else over the page - a drawer, a
 *  deck being presented - is found by the hit test the pane has always done, and covers
 *  all of it, which is the safe answer for a thing nothing here knows the shape of. */

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
}

/** The shapes the theme package gives every layer that floats (see base.css), and the
 *  arrow a swipe brings in over a page, which is round and moves with the fingers; see
 *  back-swipe/SwipeArrow.svelte. */
const FLOATING = '.nib-layer, .nib-bubble, .nib-screen, .nib-swipe'
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

function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** Every layer of the app's on the window, but those inside `hole` itself - a card the
 *  pane draws in its own room is under the page by design. */
export function layersOver(hole: HTMLElement): Layer[] {
  const found: Layer[] = []
  for (const node of document.querySelectorAll(`${FLOATING}, ${SCRIMS}`)) {
    if (hole.contains(node)) continue
    const scrim = node.matches(SCRIMS)
    found.push({
      box: boxOf(node),
      radius: scrim ? 0 : parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0,
      scrim,
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
