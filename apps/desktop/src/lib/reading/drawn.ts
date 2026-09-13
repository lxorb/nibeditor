/** A page of a paper and a plane, drawn inside the card that stands for one.
 *
 *  `![[paper.pdf#page=3]]` and `![[Board.canvas]]` render as a card - the name of
 *  the file, the mark of what kind of thing it is, one click - because that is the
 *  only markup that is right everywhere. A published page runs no script and an
 *  exported document has no space behind it, so neither could ever draw a page of
 *  a paper; see `card` in @nib/markdown/wikilinks. Inside the app there is a
 *  script and a disk, and here the card is where the drawing goes.
 *
 *  One drawer for both faces of a note. The editor's live preview reaches it
 *  through the index, the way it reaches the reading view's render, and the
 *  reading view calls it over the cards on the page it has just built; so a paper
 *  embedded in a note is the same page, at the same width, in the same frame,
 *  whichever face is up. That is the whole reason this lives under reading/ rather
 *  than beside either surface.
 *
 *  Nothing is read off a disk until the reader can see the card. A note that names
 *  thirty papers would otherwise open thirty documents and draw thirty pages
 *  before the first paragraph is on screen, and a paper is tens of megabytes. So
 *  each card waits on an `IntersectionObserver`, and waiting buys the other half
 *  of it too: a card that is on the page has a real width, so the page is drawn at
 *  the column's own measure rather than at a number guessed in advance.
 *
 *  What is drawn is a picture and not a reader. No scrolling, no selecting, no
 *  marks, no pen - a click anywhere on it opens the file in the tab that has all
 *  of those. And where the drawing cannot be made - no such page, no such file, a
 *  paper that turns out to be broken, a plane with nothing on it - the card is
 *  left exactly as it was found. A card is never replaced by an empty box. */

import type { FileDrawing } from '@nib/editor'
import { nameOf } from '../space-paths'
import { invoke, joinPath } from '../tauri'

/** Where the file is, on top of what the card asked for. The card speaks in paths
 *  relative to the space, because that is what a link says and what the words
 *  inside a plane's cards resolve from; the space's own folder is what turns one
 *  into something a disk can answer. */
export interface Drawn extends FileDrawing {
  root: string
}

/** Which page a paper is drawn at when its link named none. Said here because
 *  this is the one place that asks pdf.js for a page: a renderer has no business
 *  having an opinion about it, and pages count from one. */
const FIRST_PAGE = 1

/** How far ahead of the viewport a drawing starts, so the page is there by the
 *  time the reader arrives at it rather than appearing under their eyes. About a
 *  screen of a note. */
const AHEAD = '400px'

/** How wide a page is drawn when the card cannot say - a card in a column that has
 *  not been laid out. Roughly a note's measure at the default text size, which is
 *  wrong by a little rather than by everything. */
const FALLBACK_WIDTH = 640

/** How many pixels one page of a paper may be drawn with. A page at three device
 *  pixels to the CSS pixel would otherwise ask for a bitmap of tens of megabytes
 *  for a picture a reader glances at; past this the page is drawn a little softer
 *  rather than not at all. The same reasoning PdfPage.svelte's own cap goes by,
 *  at a fifth of the room, because that one is the page somebody is reading. */
const MOST_PIXELS = 4 * 1024 * 1024

/** The class the card wears once something has been drawn in it, and the class on
 *  the drawing itself. One pair for both faces, because one set of rules dresses
 *  both; see the Embedded files section of packages/themes/src/document.css. */
const DRAWN = 'embed-drawn'
const SHEET = 'embed-sheet'

/** Draws `file` in `card` once the reader can see it, and answers with what stops
 *  that: an observer given back, and a drawing already in flight abandoned. Called
 *  once per card - a card already drawn in is left alone, so a reading view that
 *  draws its page again over the same elements cannot stack two pages up. */
export function drawFile(card: HTMLElement, file: Drawn): () => void {
  if (card.classList.contains(DRAWN)) return () => undefined

  let stopped = false
  const seen = new IntersectionObserver(
    (entries) => {
      if (stopped || !entries.some((entry) => entry.isIntersecting)) return

      // Once. The class is set before anything is read, so a second call on this
      // card - the editor drawing the same widget twice - finds it taken.
      seen.disconnect()
      card.classList.add(DRAWN)
      void fill(card, file, () => !stopped && card.isConnected)
    },
    { rootMargin: AHEAD },
  )

  seen.observe(card)

  return () => {
    stopped = true
    seen.disconnect()
  }
}

/** Every paper and plane card on a rendered page, drawn as the reader reaches
 *  them, and what stops all of them.
 *
 *  The reading view's own way in. It has no widgets to hang anything off, only the
 *  HTML the renderer just handed it, so the cards are found on the page and read
 *  for what they say. A page with no space behind it - a note opened from outside
 *  one - draws nothing, because there is nowhere to read a file from. */
export function inlineFiles(surface: HTMLElement, root: string | null): () => void {
  if (root === null) return () => undefined

  const cards = surface.querySelectorAll<HTMLElement>('.embed-file[data-file]')
  const stops = [...cards].flatMap((card) => {
    const file = askedBy(card, root)
    return file === null ? [] : [drawFile(card, file)]
  })

  return () => {
    for (const stop of stops) stop()
  }
}

/** What one card on a page asks to have drawn, or null for a card that cannot
 *  say.
 *
 *  Read off the card itself rather than resolved a second time: `data-kind` and
 *  `data-page` are the renderer's reading of the link, and the file comes from the
 *  very href the card already opens - which is where the link resolved to in this
 *  space, worked out once when the page was built. A card the space could not
 *  answer has no link in it at all, and stays a card. */
function askedBy(card: HTMLElement, root: string): Drawn | null {
  const kind = card.dataset.kind
  if (kind !== 'pdf' && kind !== 'canvas') return null

  const href = card.querySelector('a[href]')?.getAttribute('href')
  if (href === null || href === undefined || href === '') return null

  // Up to the fragment, which is the page and is already on the card as a number.
  const hash = href.indexOf('#')
  const path = written(hash === -1 ? href : href.slice(0, hash))
  if (!path) return null

  const page = Number(card.dataset.page)
  return { kind, path, root, page: Number.isInteger(page) && page >= 1 ? page : null }
}

/** A target as the name it stands for: what a card writes in a link is a URL, and
 *  `attributeUrl` is what put it through `encodeURI` on the way in. The same
 *  reading the page's own click does; see `written` in Reading.svelte. */
function written(target: string): string {
  try {
    return decodeURI(target)
  } catch {
    return target
  }
}

/** Draws the thing and puts it in the card, or leaves the card alone.
 *
 *  `showing` is asked again after every await rather than read once: a drawing is
 *  a read off a disk and then a render, and the note may have been edited, the
 *  pane closed or the page thrown away through either of them. */
async function fill(card: HTMLElement, file: Drawn, showing: () => boolean): Promise<void> {
  // The column the card landed in, measured rather than guessed - which is what
  // waiting for the card to be seen is worth beyond not reading the file at all.
  const width = Math.round(card.clientWidth) || FALLBACK_WIDTH

  const drawing = await (file.kind === 'pdf' ? paperPage(file, width) : plane(file)).catch(
    () => null,
  )
  if (drawing === null || !showing()) {
    // Nothing was drawn, so nothing about the card has changed except that it will
    // not be asked again. What is on screen is the card, which is what it was.
    card.classList.remove(DRAWN)
    return
  }

  into(card).append(drawing)
}

/** Where the drawing goes.
 *
 *  The editor's card is a button that already opens the file however it is
 *  pressed, so the drawing goes straight into it. The reading view's card is a
 *  figure whose name is a link, and a picture beside that link is a picture
 *  nothing happens when you press - so there the drawing gets a link of its own,
 *  pointing where the name points. Kept away from the keyboard and from a screen
 *  reader either way: the name beside it says where this goes, once.
 *
 *  Prepended, so the page or the plane is above the row that names it - the frame
 *  an embedded note already reads as, with its name along the bottom. */
function into(card: HTMLElement): HTMLElement {
  const named = card.querySelector('a[href]')
  if (!(named instanceof HTMLAnchorElement)) {
    const holder = document.createElement('span')
    holder.className = SHEET
    holder.setAttribute('aria-hidden', 'true')
    card.prepend(holder)
    return holder
  }

  // The card's own link said again, classes and all, because it is the same link:
  // what reads a press asks the anchor whether it is a wikilink before deciding how
  // to resolve the target, and a picture of a link that answered differently would
  // be followed somewhere else. See `follow` in Reading.svelte.
  const link = document.createElement('a')
  link.className = `${named.className} ${SHEET}`.trim()
  link.setAttribute('href', named.getAttribute('href') ?? '')
  link.tabIndex = -1
  link.setAttribute('aria-hidden', 'true')
  card.prepend(link)

  return link
}

/** One page of a paper, drawn onto a canvas `width` CSS pixels across.
 *
 *  Through the app's one PDF loading path, which is the one that knows where the
 *  bytes come from on a desktop and in a browser both; the document is given back
 *  as soon as the page is drawn, because one page is all that was wanted and a
 *  paper held open is a worker and tens of megabytes held with it.
 *
 *  Null for a page the paper has not got, which is a link that says `#page=400`
 *  about a paper of twelve: the card is the honest answer there. */
async function paperPage(file: Drawn, width: number): Promise<HTMLCanvasElement | null> {
  const { openDocument } = await import('../pdf/document')
  const held = await openDocument(joinPath(file.root, file.path))

  try {
    const number = file.page ?? FIRST_PAGE
    if (number > held.doc.numPages) return null

    const page = await held.doc.getPage(number)

    try {
      const at = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
      const sheet = document.createElement('canvas')

      // Crisp on the screen it is on: the canvas holds device pixels and the
      // stylesheet sizes it back down to the column. The same arithmetic
      // PdfPage.svelte does, against this file's own smaller ceiling.
      const room = Math.sqrt(MOST_PIXELS / (at.width * at.height))
      const density = Math.min(window.devicePixelRatio || 1, Math.max(1, room))
      sheet.width = Math.floor(at.width * density)
      sheet.height = Math.floor(at.height * density)

      const context = sheet.getContext('2d', { alpha: false })
      if (!context) return null

      await page.render({
        canvas: sheet,
        canvasContext: context,
        viewport: at,
        ...(density === 1 ? {} : { transform: [density, 0, 0, density, 0, 0] }),
      }).promise

      return sheet
    } finally {
      // The page's own working set - its fonts, its images - is pdf.js's and has
      // to be given back; the bitmap belongs to the element and stays with it.
      page.cleanup()
    }
  } finally {
    await held.close()
  }
}

/** The whole plane, as the one picture of a canvas this app has.
 *
 *  `canvasSvg` is what an exported SVG, a PNG and a printed page are all made of,
 *  so a plane embedded in a note looks like the plane rather than like a fourth
 *  drawing of it. Asked for in its plain reading - cards as their words rather
 *  than as markdown in a `foreignObject` - for two reasons: the picture goes into
 *  the app's own page here rather than into a file somebody takes away, and a
 *  card's markdown is the note's own HTML, which is not something to run in the
 *  app on the strength of a link; and a plane embedded in a note is a glance at
 *  the shape of it, which is what the plain reading is.
 *
 *  Null for a plane with nothing on it. An empty plane draws as an empty rectangle
 *  of the default size, and an empty box is worse than the card. */
async function plane(file: Drawn): Promise<SVGSVGElement | null> {
  const text = await invoke<string>('read_note', { path: joinPath(file.root, file.path) })

  // Both asked for here rather than imported at the top: the picture reaches back
  // through the canvas into the link index, which is what hands this module out in
  // the first place, and a plane is only ever drawn once somebody embedded one.
  const [{ drawingOf }, { canvasSvg }] = await Promise.all([
    import('../export/drawing'),
    import('../canvas/picture'),
  ])

  const drawing = drawingOf({ text, name: nameOf(file.path), path: file.path, root: file.root })
  if (!drawing.canvas.nodes.length && !drawing.canvas.ink.length) return null

  // Parsed by the browser rather than built element by element: the picture is a
  // string of SVG, and it is a string in which every value a note wrote has
  // already been escaped - there is no HTML in the plain reading at all.
  const holder = document.createElement('div')
  holder.innerHTML = canvasSvg(drawing.canvas, drawing.palette, drawing.path, drawing.root, true)

  const picture = holder.firstElementChild
  if (!(picture instanceof SVGSVGElement)) return null

  // The plane is as wide as whatever is on it, in plane units; the column decides
  // how wide it is drawn, and the `viewBox` keeps its shape while it shrinks.
  picture.removeAttribute('width')
  picture.removeAttribute('height')

  return picture
}
