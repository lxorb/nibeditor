/** The rendered note as a picture, drawn by the browser it is already in.
 *
 *  The `html` handed over is a complete, self-contained document: every
 *  stylesheet inline, every font a `data:` URI, every picture a `data:` URI.
 *  Nothing is fetched, and that is the whole reason this works. A
 *  `foreignObject` that loads so much as one file over the network taints the
 *  canvas it is drawn on, `toBlob` then throws a SecurityError instead of
 *  answering, and the export fails at the last step with nothing to show for
 *  it. So everything is inlined before it gets here, and this file never
 *  fetches anything itself.
 *
 *  Only two steps need a window - measuring the note in a frame, and drawing it
 *  on a canvas - and each sits behind a small function of its own. The
 *  arithmetic and the markup are pure, and are what the tests read. */

import { escapeAll } from '@nib/markdown/html'
import { toXhtml } from './epub'

export interface ImageOptions {
  /** `image/png` or `image/jpeg`. */
  mime: string
  /** Device pixels per CSS pixel. Two, so the picture is sharp on any screen. */
  scale?: number
  /** The paper behind the note. */
  background: string
  /** Cut into pages this many CSS pixels tall, or one tall picture when null. */
  pageHeight?: number | null
  /** JPEG only, 0 to 1. */
  quality?: number
  /** How wide the note is laid out, in CSS pixels. */
  width?: number
}

/** A comfortable column of text, and what the note is laid out at when the
 *  caller does not say. */
const DEFAULT_WIDTH = 800
const DEFAULT_SCALE = 2

const XHTML = 'http://www.w3.org/1999/xhtml'

/** One picture's worth of the laid-out note: where it starts down the page and
 *  how tall it is. */
export interface Page {
  top: number
  height: number
}

/** The pages a note of that height comes to.
 *
 *  Pure, because it is the part that decides how many files the person ends up
 *  with and it should be arguable without a browser. */
export function pagesOf(totalHeight: number, pageHeight: number | null | undefined): Page[] {
  const total = Math.max(0, totalHeight)

  // No page height, or one no page could be filled to, is one picture of the
  // whole note. So is a note that fits, which is the common case.
  if (pageHeight === null || pageHeight === undefined || pageHeight <= 0 || total <= pageHeight) {
    return [{ top: 0, height: total }]
  }

  return Array.from({ length: Math.ceil(total / pageHeight) }, (_unused, index) => {
    const top = index * pageHeight
    // The last page stops where the note does rather than running on into paper
    // with nothing on it.
    return { top, height: Math.min(pageHeight, total - top) }
  })
}

/** The document with the XHTML namespace on its root element.
 *
 *  Inside a `foreignObject` the default namespace is SVG's, so an `<html>` that
 *  does not say otherwise is read as an SVG element nothing has heard of and
 *  drawn as nothing at all. */
function namespaced(xhtml: string): string {
  if (/<html\b[^>]*\sxmlns=/.test(xhtml)) return xhtml
  if (/<html\b/.test(xhtml)) return xhtml.replace(/<html\b/, `<html xmlns="${XHTML}"`)

  // A fragment rather than a whole document still has to be in a namespace, so
  // it travels inside an element that names one.
  return `<div xmlns="${XHTML}">${xhtml}</div>`
}

/** The note as one SVG picture the browser can draw in a single step.
 *
 *  The document goes in through `toXhtml`, the same transformer the ePub is
 *  built with: a `foreignObject` has to hold well-formed XML, and markup that
 *  does not parse takes the whole SVG down without a word - the image simply
 *  never loads and the picture comes out blank.
 *
 *  The paper is painted here as well as on the canvas. The canvas fill is what
 *  a JPEG needs, having no transparency to fall back on; the rectangle is what
 *  puts the paper behind the text within the same drawing, so that the letters
 *  are smoothed against the colour they will be read on. */
export function svgOf(html: string, size: { width: number; height: number }, background: string) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`,
    `<rect width="100%" height="100%" fill="${escapeAll(background)}" />`,
    '<foreignObject width="100%" height="100%">',
    namespaced(toXhtml(html)),
    '</foreignObject>',
    '</svg>',
  ].join('')
}

/** The picture as a URL the canvas will draw from. A `data:` URL is
 *  same-origin, which is the other half of keeping the canvas readable. */
function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** A picture that will not decode is one the note shows broken too, so the
 *  measurement neither waits on it nor fails for it. */
async function decoded(picture: HTMLImageElement): Promise<void> {
  await picture.decode().catch(() => undefined)
}

/** How tall the note lays out at that width, measured in a frame of its own so
 *  that nothing on the page around it can change the answer. */
async function measuredHeight(html: string, width: number): Promise<number> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:100px;border:0;visibility:hidden;`

  try {
    await new Promise<void>((resolve) => {
      frame.addEventListener(
        'load',
        () => {
          resolve()
        },
        { once: true },
      )
      // `srcdoc` rather than a blob URL, so the frame is same-origin and its
      // document can be read back. Nothing in it is fetched, so the load event
      // is only waiting on the parse.
      frame.srcdoc = html
      document.body.append(frame)
    })

    const inside = frame.contentDocument
    if (!inside) throw new Error('The note could not be laid out, so it cannot be pictured.')

    // The fonts arrive inline but still have to be decoded before anything is
    // measured with them, and a picture that has not loaded has no height yet.
    await inside.fonts.ready.catch(() => undefined)
    await Promise.all([...inside.images].map(decoded))

    return Math.max(inside.documentElement.scrollHeight, inside.body.scrollHeight, 1)
  } finally {
    // Whatever happened, the frame goes: one left behind is a whole second
    // document living in the app for as long as the window is open.
    frame.remove()
  }
}

/** The SVG, loaded as something a canvas will take. */
function loadedPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const picture = new Image()
    picture.addEventListener('load', () => {
      resolve(picture)
    })
    picture.addEventListener('error', () => {
      reject(new Error('The note could not be drawn, because its markup did not parse as XML.'))
    })
    picture.src = url
  })
}

/** What one page is written as, and how. */
interface Paper {
  width: number
  scale: number
  background: string
  mime: string
  quality: number | undefined
}

/** The bytes the browser hands back, or a sentence saying why it would not. */
async function bytesOf(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number | undefined,
): Promise<Uint8Array> {
  let picture: Blob | null

  try {
    picture = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (made) => {
          resolve(made)
        },
        mime,
        quality,
      )
    })
  } catch (error) {
    // A canvas that has drawn anything fetched from elsewhere is tainted and
    // refuses to be read back. Everything reaching here is inlined beforehand,
    // so this is a fault in the export rather than in the note - but the person
    // is the one looking at it, so they are told in words.
    throw new Error(
      'The note could not be saved as a picture, because something in it was loaded from outside the document.',
      { cause: error },
    )
  }

  if (!picture) throw new Error(`This browser cannot write a picture as ${mime}.`)

  return new Uint8Array(await picture.arrayBuffer())
}

/** One page of the note, drawn and encoded. */
async function pageBytes(drawing: HTMLImageElement, page: Page, paper: Paper): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(paper.width * paper.scale))
  canvas.height = Math.max(1, Math.round(page.height * paper.scale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser gave the export no canvas to draw the note on.')

  context.fillStyle = paper.background
  context.fillRect(0, 0, canvas.width, canvas.height)
  // Scaled after the fill, so the rest of the drawing is done in the note's own
  // pixels and only the canvas underneath is denser.
  context.scale(paper.scale, paper.scale)
  // The whole note is drawn every time and moved up by the pages already taken,
  // so each page is a window onto one layout rather than a layout of its own.
  context.drawImage(drawing, 0, -page.top)

  return bytesOf(canvas, paper.mime, paper.quality)
}

/** The pages the note comes to, each a PNG or JPEG. */
export async function toImages(html: string, options: ImageOptions): Promise<Uint8Array[]> {
  const width = options.width ?? DEFAULT_WIDTH
  const height = await measuredHeight(html, width)
  const drawing = await loadedPicture(svgUrl(svgOf(html, { width, height }, options.background)))

  const paper: Paper = {
    width,
    scale: options.scale ?? DEFAULT_SCALE,
    background: options.background,
    mime: options.mime,
    quality: options.quality,
  }

  const pages: Uint8Array[] = []
  // One canvas at a time: a long note cut into pages is many canvases the size
  // of a screen each, and holding them all at once is what makes a browser give
  // up halfway through an export.
  for (const page of pagesOf(height, options.pageHeight)) {
    pages.push(await pageBytes(drawing, page, paper))
  }

  return pages
}
