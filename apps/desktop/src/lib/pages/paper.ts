/** The paper behind a page, where the paper is a page of a PDF.
 *
 *  A page note made from a PDF keeps the PDF. Nothing is baked into the note: each
 *  page says which file and which page of it, and the picture is drawn from the
 *  paper itself when that page comes near the view. So the PDF in the space is the
 *  one copy of it - Obsidian opens it, a rename is one file to rename, and the note
 *  beside it is kilobytes of ink rather than a folder of PNGs.
 *
 *  Drawn once per page and kept, because a page somebody is writing on is a page
 *  they are looking at for minutes: rasterising it on every scroll would be the one
 *  thing the surface cannot afford. Kept as a bitmap rather than a canvas, which is
 *  what a 2d context can draw without a second copy.
 *
 *  Two caps, and they are different caps. The first is the scale: twice the page's
 *  own size, which is enough for a retina screen and for a reader who zooms in a
 *  little, and past which the pixels are not worth their memory. The second is the
 *  area, because a poster at twice its size is a texture a browser either refuses or
 *  pays for in memory nobody gets back; past it the page is drawn a little softer
 *  rather than not at all, which is what the PDF viewer already does.
 *
 *  How many are kept at once is capped as well. A note made from a four hundred page
 *  scan would otherwise hold four hundred bitmaps the moment somebody scrolled to
 *  the end of it, and the pages nobody is looking at are the ones to let go of. */

import type { OpenPdf } from '../pdf/document'
import { openDocument } from '../pdf/document'
import { PDF_TO_CSS } from '../pdf/pages'
import { placesOf } from '../space-paths'

/** How much bigger than the page itself a background is drawn. */
const SCALE = 2

/** How many pixels one page may be drawn with; the same ceiling one page of the
 *  PDF viewer has, for the same reason. */
const MOST_PIXELS = 16 * 1024 * 1024

/** How many pages' backgrounds are held at once. A screenful is two or three, and
 *  this is enough that scrolling back a page or two finds them already drawn. */
const KEPT = 24

/** A page of a paper, drawn. */
export interface Paper {
  image: ImageBitmap
  /** The page's size in CSS pixels, which is what the note's own page is. */
  width: number
  height: number
}

/** One PDF, open, with the pages that have been drawn out of it.
 *
 *  One document per file however many pages ask for it: opening a PDF costs a
 *  worker and a copy of the bytes, and a note of four hundred pages is four hundred
 *  pages of one paper. */
interface Held {
  open: Promise<OpenPdf>
  drawn: Map<number, Promise<Paper | null>>
  /** Which pages were asked for most recently, oldest first, so the ones nobody is
   *  looking at are the ones let go. */
  recent: number[]
}

const held = new Map<string, Held>()

/** A paper a page names, and the two things its name is relative to.
 *
 *  A page holds the path the way a JSON Canvas file node holds one, which is to say
 *  relative. What it is relative to is the note, or the space the note is in, and only
 *  the surface knows either - so the surface says, and `placesOf` decides where to
 *  look. Handing the bare name to the reader is what made every page of an imported
 *  PDF a blank sheet: nothing in the app can read `Lecture 4.pdf`. */
export interface PaperAt {
  /** What the page says: the path as the file holds it. */
  file: string
  /** The note's own path, or null for a note that has none. */
  note: string | null
  /** The root of the space it is in, or null when it is in none. */
  root: string | null
}

/** One paper, named the same way twice, so two pages of it are one document.
 *
 *  The places rather than the path, because which of them answers is not known until
 *  one of them is opened. Two notes in one folder therefore share a paper; two notes
 *  in different folders naming the same paper under the space's root open it twice,
 *  which is a worker apiece and rare enough to leave alone. */
function keyOf(at: PaperAt): string {
  return placesOf(at.file, at.note, at.root).join('\n')
}

/** One page of a paper as a picture, drawn now or already drawn.
 *
 *  Null where the paper is not there any more, cannot be read, or has no such page.
 *  The sheet still draws and the ink on it is still readable - a page note whose PDF
 *  somebody deleted is a note you can still read your own writing on - but the sheet
 *  says so rather than coming out silently blank; see PagesPage.svelte. */
export function paperOf(at: PaperAt, number: number): Promise<Paper | null> {
  const key = keyOf(at)
  if (!key) return Promise.resolve(null)

  let one = held.get(key)
  if (!one) {
    one = { open: opened(at), drawn: new Map(), recent: [] }
    held.set(key, one)
  }

  const already = one.drawn.get(number)
  if (already) {
    touch(one, number)
    return already
  }

  const drawing = draw(one, number).catch(() => null)
  one.drawn.set(number, drawing)
  touch(one, number)
  forgetOldest(one)

  return drawing
}

/** The paper itself, opened at the first place that answers.
 *
 *  Tried in order rather than asked about first: opening it is the only question worth
 *  asking, and the answer to it is the document. A place that is not there costs a
 *  refusal from the reader and nothing else, and it is asked once per paper because
 *  the document is kept.
 *
 *  The last refusal is what comes back out, so the sheet can say the paper could not
 *  be read rather than nothing at all. */
async function opened(at: PaperAt): Promise<OpenPdf> {
  const places = placesOf(at.file, at.note, at.root)
  let last: unknown = new Error(`${at.file} is nowhere this space can read`)

  for (const path of places) {
    try {
      return await openDocument(path)
    } catch (error) {
      last = error
    }
  }

  throw last instanceof Error ? last : new Error(String(last))
}

function touch(one: Held, number: number) {
  const at = one.recent.indexOf(number)
  if (at >= 0) one.recent.splice(at, 1)
  one.recent.push(number)
}

/** The pages past the cap, let go of, oldest first. The bitmap is closed rather
 *  than only dropped: a bitmap holds its pixels outside the heap, and a collector
 *  has no reason to hurry about them. */
function forgetOldest(one: Held) {
  while (one.recent.length > KEPT) {
    const oldest = one.recent.shift()
    if (oldest === undefined) return

    const going = one.drawn.get(oldest)
    one.drawn.delete(oldest)
    void going?.then((paper) => paper?.image.close())
  }
}

async function draw(one: Held, number: number): Promise<Paper | null> {
  const opened = await one.open
  if (number < 1 || number > opened.doc.numPages) return null

  const page = await opened.doc.getPage(number)
  const wanted = page.getViewport({ scale: PDF_TO_CSS })

  // The scale asked for, brought down to what a texture may be. Rounded to the
  // page, so the bitmap is a whole number of pixels and the draw is not resampling
  // a fraction of one.
  const area = wanted.width * wanted.height * SCALE * SCALE
  const scale = area > MOST_PIXELS ? SCALE * Math.sqrt(MOST_PIXELS / area) : SCALE
  const view = page.getViewport({ scale: PDF_TO_CSS * scale })

  const paper = document.createElement('canvas')
  paper.width = Math.max(1, Math.round(view.width))
  paper.height = Math.max(1, Math.round(view.height))

  const ctx = paper.getContext('2d')
  if (!ctx) {
    page.cleanup()
    return null
  }

  await page.render({ canvas: paper, canvasContext: ctx, viewport: view }).promise
  page.cleanup()

  return {
    image: await createImageBitmap(paper),
    width: Math.round(wanted.width),
    height: Math.round(wanted.height),
  }
}

/** Everything drawn for one paper, let go of: the tab showing it has closed.
 *
 *  The document goes too, which is a worker and a copy of the bytes. Reopening one is
 *  a worker and a read; holding one is a worker and however many bitmaps were drawn,
 *  for as long as the window is open, which is the wrong way round for a paper nobody
 *  is looking at. */
export function forgetPaper(at: PaperAt) {
  const key = keyOf(at)
  const one = held.get(key)
  if (!one) return

  held.delete(key)
  for (const drawing of one.drawn.values()) void drawing.then((paper) => paper?.image.close())
  void one.open.then((opened) => opened.close()).catch(() => undefined)
}
