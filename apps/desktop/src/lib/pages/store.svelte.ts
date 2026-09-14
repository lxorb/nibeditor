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
  added,
  columnHeight,
  GUTTER,
  grown,
  onPage,
  pageCount,
  pagesOf,
  pageShowing,
  settled,
} from '@nib/markdown/pages'
import { type Camera, clampScale, zoomed } from '../camera'
import { type Canvas, type PageNode, readCanvas, takeParsed, writeCanvas } from '../canvas/format'
import { strokeBox } from '../canvas/ink'
import type { KeptView } from '../canvas/place'
import { CanvasStore } from '../canvas/store.svelte'
import { stillness } from '../motion'
import type { Tab } from '../workspace/documents.svelte'

/** Room left round the column when the view is fitted, in pixels. Enough that the
 *  edge of the paper is visibly an edge. */
const MARGIN = 28

/** How much of the next sheet is in reach at the end of the column, in screen
 *  pixels.
 *
 *  A page note ends in the silhouette of the sheet that is not there yet, and the
 *  scroll reaches far enough past the last page to show this much of it. That is
 *  the whole of how the gesture is discoverable: somebody who scrolls to the end
 *  of a note sees where the next page would go, can press it, and can carry on
 *  scrolling to pull it into being. In screen pixels rather than plane units, so
 *  the band is the same size on paper seen from any distance.
 *
 *  Nought for a note nobody may write in: there is nothing to add, and a dashed
 *  slot offering it would be a button that refuses. */
export const PEEK = 88

/** How long the view takes to settle on a page a pull has just made, in
 *  milliseconds. Long enough to follow by eye, short enough not to be a wait. */
const SETTLE = 420

export class PagesStore extends CanvasStore {
  constructor(tab: Tab) {
    super(tab)
    // A zoom the reader chose comes back with the camera it belongs to, so the
    // paper is not fitted across the pane again the first time this one is
    // measured. See `keptView` and place.ts.
    if (this.restored?.chose === true) this.chose = true
  }

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

  /** And that fact written down beside the camera, so it comes back with it.
   *
   *  Without this a zoom survived the app being started again for exactly as long
   *  as it took the pane to be measured: the camera came back, `chose` did not, and
   *  the first measurement fitted the paper across the pane again and threw the
   *  reader's zoom away. See place.ts. */
  protected override get keptView(): KeptView {
    return this.chose ? { ...this.camera, chose: true } : this.camera
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

  /** The last sheet, which is the one the end of the column is about. */
  get last(): PageNode | null {
    return this.pages[this.pages.length - 1] ?? null
  }

  /** Whether a page may be added at all: a note to write in, with something to add
   *  after. A space somebody shared to read has neither. */
  get canAdd(): boolean {
    return !this.readOnly && this.pages.length > 0
  }

  /** Where the next sheet would go: the silhouette's box, in plane units, which is
   *  exactly the box `added` will give the real page. Null where none may be added.
   *
   *  The same answer for the drawing, for the press that lands on it and for the
   *  camera that settles on it afterwards - which is what lets the silhouette
   *  become the page with nothing moving. */
  get slot(): { x: number; y: number; width: number; height: number } | null {
    const last = this.last
    if (!last || !this.canAdd) return null

    return { x: last.x, y: this.tall + GUTTER, width: last.width, height: last.height }
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
    const slack = MARGIN / scale
    const widest = this.widest

    // The pages are centred on nought, so a view wider than the widest of them sits
    // on nought and cannot be dragged off them at all.
    const sideways = Math.max(0, (widest - across) / 2 + slack)
    const x = Math.min(Math.max(next.x, -sideways), sideways)

    const { first, last } = this.limits(scale)
    const y = last < first ? this.tall / 2 : Math.min(Math.max(next.y, first), last)

    return { x, y, scale }
  }

  /** How far up and down the view may go at a scale, as camera positions.
   *
   *  Between the top of the first page and the bottom of the last, both with the
   *  margin's worth of paper-coloured air beyond them - and past the last one, the
   *  band the next sheet's silhouette sits in, so scrolling to the end of a note
   *  arrives at where the next page would go rather than at a dead stop.
   *
   *  A column shorter than the view has nowhere to scroll: it sits in the middle.
   *
   *  Its own method because the surface reads the same numbers: how far a scroll
   *  asked to go past the bottom is the pull, and the pull is what makes a page. */
  private limits(scale: number): { first: number; last: number } {
    const down = this.pane.height / scale
    const slack = MARGIN / scale
    const below = this.canAdd ? GUTTER + PEEK / scale : slack

    return { first: -slack + down / 2, last: this.tall + below - down / 2 }
  }

  /** The furthest down the view goes, in plane units. What a scroll asks to pass,
   *  and what the pull is measured from. */
  get bottom(): number {
    const { first, last } = this.limits(this.camera.scale)
    return last < first ? this.tall / 2 : last
  }

  /** Where the bottom of the view is, in plane units. The other half of the rule
   *  about where a pull may begin; see `startedNearEnd` in pull.ts. */
  get viewBottom(): number {
    return this.camera.y + this.pane.height / this.camera.scale / 2
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

  /** The whole of the page being read in the pane, which is the other thing a
   *  reader of paper asks for: the width to read it, the page to see it. Theirs
   *  from here on, like every other zoom somebody chose. */
  fitPage() {
    const page = this.pages[this.showing - 1] ?? this.last
    if (!page || !this.pane.width || !this.pane.height) return

    this.theirs()
    const scale = clampScale(
      Math.min(
        (this.pane.width - 2 * MARGIN) / page.width,
        (this.pane.height - 2 * MARGIN) / page.height,
      ),
    )
    this.camera = this.held({ x: 0, y: page.y + page.height / 2, scale })
  }

  /** A scale outright, which is what the 100% row asks for. Kept where it was by
   *  the top of the view, the way fitting the width is. */
  zoomTo(scale: number) {
    if (!this.pane.height) return

    this.theirs()
    const wanted = clampScale(scale)
    this.camera = this.held({
      ...this.camera,
      y: this.top + this.pane.height / wanted / 2,
      scale: wanted,
    })
  }

  /** Back to the paper across the pane, which is what the bar's fit button asks for -
   *  and it hands the scale back, so the pane resizing keeps it fitted again. */
  fitAgain() {
    this.chose = false
    this.fitWidth()
  }

  /** A page put in, after the one named or at the end, and which page it now is,
   *  counting from one. Nought where there was nothing to add to.
   *
   *  Here rather than in the surfaces that ask for it, because all three ask the
   *  same questions of the same canvas: the row in the navigator, the press on the
   *  silhouette at the end of the column, and the pull that brings it into being. */
  addPage(after: string | null = null): number {
    if (!this.canAdd) return 0

    const { canvas, id } = added(this.canvas, after)
    this.edit(canvas)

    const at = pagesOf(this.canvas).findIndex((one) => one.id === id)
    return at < 0 ? 0 : at + 1
  }

  /** The view slid down to a page rather than put there, for the one move that has
   *  to be followed by eye: the page a pull has just made, which was a silhouette a
   *  moment ago and must not jump.
   *
   *  Instant for a reader who has asked their system for as little movement as
   *  possible, and instant where there are no frames to ask for. */
  glideTo(number: number) {
    const page = this.pages[Math.min(Math.max(1, Math.round(number)), this.pages.length) - 1]
    if (!page) return

    const down = this.pane.height / this.camera.scale
    const wanted = this.held({
      ...this.camera,
      y: page.y + down / 2 - MARGIN / this.camera.scale,
    })

    this.halt()
    const from = this.camera.y
    if (stillness() || typeof requestAnimationFrame !== 'function' || from === wanted.y) {
      this.camera = wanted
      return
    }

    const began = Date.now()
    const step = () => {
      const part = Math.min(1, (Date.now() - began) / SETTLE)
      const eased = 1 - (1 - part) ** 3
      this.camera = this.held({ ...this.camera, y: from + (wanted.y - from) * eased })
      this.gliding = part < 1 ? requestAnimationFrame(step) : 0
    }
    this.gliding = requestAnimationFrame(step)
  }

  /** A glide dropped, because the reader has taken the view somewhere themselves.
   *  Every gesture says so: a view being pulled about while it slides is a fight. */
  halt() {
    if (!this.gliding) return

    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.gliding)
    this.gliding = 0
  }

  /** The frame a glide is waiting on, while one is. */
  private gliding = 0

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
