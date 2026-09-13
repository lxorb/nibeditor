/** One open page note: the pages, what is on them, and what can be taken back.
 *
 *  Almost nothing. A page note is a canvas with pages among the objects on it, so
 *  this is the canvas's own store with two methods changed - the pages are laid out
 *  in their column on the way in and on the way out - and everything else is
 *  inherited: the one edit per gesture, the one undo step, the write once the
 *  changes stop, the room, the merge when words arrive from somewhere else, the
 *  camera. There is one plane surface in this app and this is it wearing pages.
 *
 *  Laying the column out on the way in as well as out is what makes a page note
 *  from another device fall into line: two people who added a page at the same
 *  moment have two pages, and where they sit is worked out from the list rather than
 *  from what either device wrote down, so neither ends up under the other. See
 *  laidOut in @nib/markdown/pages. */

import {
  columnHeight,
  grown,
  onPage,
  pageCount,
  pagesOf,
  pageShowing,
  settled,
} from '@nib/markdown/pages'
import { type Camera, clampScale, zoomed } from '../camera'
import { type Canvas, readCanvas, takeParsed, writeCanvas } from '../canvas/format'
import { strokeBox } from '../canvas/ink'
import { CanvasStore } from '../canvas/store.svelte'

/** Room left round the column when the view is fitted, in pixels. Enough that the
 *  edge of the paper is visibly an edge. */
const MARGIN = 28

export class PagesStore extends CanvasStore {
  /** How big the pane is, in pixels. Told by the surface, because only a component
   *  can measure one, and held here because every sum about where the view may go
   *  needs it: turning to a page, fitting the width, holding a scroll to the column.
   *
   *  The camera is the store's, so the arithmetic on it is the store's too. Which is
   *  also what lets the thumbnails in the outline panel turn the page: they are
   *  nowhere near the pane, and this is the thing they can both reach. */
  pane = $state.raw<{ width: number; height: number }>({ width: 0, height: 0 })

  /** Whether the reader has chosen a zoom of their own.
   *
   *  Until they have, the paper stays fitted across the pane: the sidebar opening, a
   *  pane splitting, a phone turning, a window dragged narrower. That is what a page is
   *  - a sheet you are reading, not a thing at a coordinate - and it is what every PDF
   *  viewer does. Once somebody has zoomed in on a corner of a diagram, the zoom is
   *  theirs and nothing takes it off them.
   *
   *  A canvas has no equivalent, and rightly: an endless plane has no width to fit. */
  private chose = false

  /** The pane's new size, and the paper still fitted across it if nobody has said
   *  otherwise. Told by the surface on every resize; see Pages.svelte. */
  measured(width: number, height: number) {
    const was = this.pane
    if (was.width === width && was.height === height) return

    this.pane = { width, height }
    if (this.chose || !width || !height || !this.widest) return
    // Only once there is something to fit: a note whose pages have not arrived yet is
    // framed by the surface when they do.
    if (this.framed) this.fitWidth()
  }

  /** A zoom the reader asked for, by whichever road. From here on the scale is theirs. */
  private theirs() {
    this.chose = true
  }

  /** The pages, in the order they turn. Derived rather than held: the canvas is
   *  the state, and a second list of the same pages is a second thing to keep in
   *  step. */
  get pages() {
    return pagesOf(this.canvas)
  }

  get count(): number {
    return pageCount(this.canvas)
  }

  /** How tall the column is, and how wide its widest page is. */
  get tall(): number {
    return columnHeight(this.pages)
  }

  get widest(): number {
    return this.pages.reduce((most, page) => Math.max(most, page.width), 0)
  }

  /** Where the top of the view is, in plane units. The camera names the middle of
   *  the view - see camera.ts - and every sum here is about the top of a page, so
   *  the conversion is said once. */
  get top(): number {
    return this.camera.y - this.pane.height / this.camera.scale / 2
  }

  /** Which page is being looked at, counting from one. The middle of the view
   *  rather than its top, so the number changes when the page somebody is reading
   *  changes and not when its top edge crosses the bar. */
  get showing(): number {
    return pageShowing(this.pages, this.top, this.pane.height / this.camera.scale)
  }

  /** A view held to the column: never so far up or down that the pages have left,
   *  and never sideways at all until the zoom is close enough for there to be
   *  something beside them to see.
   *
   *  This is the whole difference between reading pages and panning a plane. An
   *  endless plane lets you lose your work off the side of it, which is right for a
   *  plane and wrong for a stack of paper. */
  held(next: Camera): Camera {
    const scale = clampScale(next.scale)
    const across = this.pane.width / scale
    const down = this.pane.height / scale
    const slack = MARGIN / scale
    const widest = this.widest

    // The pages are centred on nought, so a view wider than the widest of them sits
    // on nought and cannot be dragged off them at all.
    const sideways = Math.max(0, (widest - across) / 2 + slack)
    const x = Math.min(Math.max(next.x, -sideways), sideways)

    // And down, between the top of the first page and the bottom of the last, both
    // with the margin's worth of paper-coloured air beyond them.
    // A column shorter than the view has nowhere to scroll: it sits in the middle.
    const first = -slack + down / 2
    const last = this.tall + slack - down / 2
    const y = last < first ? this.tall / 2 : Math.min(Math.max(next.y, first), last)

    return { x, y, scale }
  }

  /** The view moved so a page's top edge is at the top of the pane, counting from
   *  one. What a thumbnail, the two page keys and a link with a page in it all do. */
  turnTo(number: number) {
    const page = this.pages[Math.min(Math.max(1, Math.round(number)), this.pages.length) - 1]
    if (!page) return

    const down = this.pane.height / this.camera.scale
    this.camera = this.held({
      ...this.camera,
      y: page.y + down / 2 - MARGIN / this.camera.scale,
    })
  }

  /** The widest page across the pane, which is what fitting means for pages: a
   *  column has no width to frame beyond the paper's own. */
  fitWidth(keepTop = true) {
    const widest = this.widest
    if (!widest || !this.pane.width || !this.pane.height) return

    const scale = clampScale((this.pane.width - 2 * MARGIN) / widest)
    const down = this.pane.height / scale
    // Kept where it was by the top of the view rather than by the middle: a zoom that
    // moved the page somebody is reading is a zoom that lost their place.
    const y = keepTop ? this.top + down / 2 : down / 2 - MARGIN / scale
    this.camera = this.held({ x: 0, y, scale })
  }

  /** In or out about the middle of the view, which is what the bar's two buttons
   *  ask for. From here on the zoom is the reader's. */
  zoomBy(by: number) {
    const { width, height } = this.pane
    this.theirs()
    this.camera = this.held(zoomed(this.camera, width, height, width / 2, height / 2, by))
  }

  /** In or out about a point: a pinch, or Ctrl and the wheel. Also theirs. */
  zoomAt(at: { x: number; y: number }, by: number) {
    const { width, height } = this.pane
    this.theirs()
    this.camera = this.held(zoomed(this.camera, width, height, at.x, at.y, by))
  }

  /** Back to the paper across the pane, which is what the bar's fit button asks for -
   *  and it hands the scale back, so the pane resizing keeps it fitted again. */
  fitAgain() {
    this.chose = false
    this.fitWidth()
  }

  /** An edit, with the long pages grown to hold what is now on them.
   *
   *  Here and not in the pages module because how far down a stroke reaches is the
   *  ink code's answer and not the format's: a stroke's outline is wider than its
   *  points by however thick the nib is. Only after an edit, never during one, so
   *  the paper does not move under the nib mid-stroke.
   *
   *  A canvas that comes back unchanged is handed straight on, which is what the
   *  store below already does nothing for. */
  override edit(next: Canvas, run?: string) {
    super.edit(next === this.canvas ? next : grown(settled(next), this.reach(next)), run)
  }

  /** How far down anything on each page reaches, by page id. Only the long pages
   *  are asked about, since they are the only ones that grow, and a note of A4 is
   *  then no sums at all. */
  private reach(canvas: Canvas): Map<string, number> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away; nothing renders from it
    const lowest = new Map<string, number>()
    const long = pagesOf(canvas).filter((page) => page.paper === 'long')
    if (!long.length) return lowest

    for (const page of long) {
      const box = { x: page.x, y: page.y, width: page.width, height: page.height }
      let reach = page.y

      for (const node of canvas.nodes) {
        if (node.id === page.id) continue
        if (node.x + node.width <= box.x || node.x >= box.x + box.width) continue
        if (node.y + node.height <= box.y || node.y >= box.y + box.height) continue
        reach = Math.max(reach, node.y + node.height)
      }

      for (const stroke of canvas.ink) {
        if (!onPage(stroke, box)) continue
        const around = strokeBox(stroke)
        reach = Math.max(reach, around.y + around.height)
      }

      lowest.set(page.id, reach)
    }

    return lowest
  }

  /** The same format either way. A page note's file is JSON Canvas with pages in
   *  it, so these two are the canvas's own reader and writer with the column laid
   *  out round them, and a `.pages` file renamed to `.canvas` opens in Obsidian. */
  protected override parse(text: string): Canvas {
    return settled(takeParsed(text) ?? readCanvas(text))
  }

  protected override serialise(canvas: Canvas): string {
    return writeCanvas(settled(canvas))
  }
}
