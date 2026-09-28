/** What a reader has marked on a PDF, and the shape it is written down in.
 *
 *  Beside the PDF, never inside it: `paper.pdf.highlights.json` sits next to
 *  `paper.pdf`, so the file stays byte for byte what the reader put in the space.
 *  The sidecar syncs like a note, travels with the PDF when it is renamed or
 *  moved, and goes when the PDF goes; the Rust side owns that half (see
 *  `highlights.rs` and `move_highlights` in `paths.rs`).
 *
 *  Positions are in PDF user space rather than in pixels, because pixels are
 *  about a zoom and a screen: the same mark has to land on the same words at any
 *  zoom, on any machine, and in any other reader that ever opens the sidecar. */

import { linkTo } from '../composer'
import { isRecord, isNumber, isString } from '../stored'

/** What the file is called: the PDF's whole name with this after it. The Rust
 *  side owns the same name - `HIGHLIGHTS` in paths.rs - because it is what makes
 *  the sidecar follow the PDF on a rename and go with it on a delete. A test
 *  reads both and fails if the two ever drift apart.
 *
 *  Here rather than in the command that writes it, because the browser build has
 *  no Rust to ask. */
export const SIDECAR = '.highlights.json'

/** The shape the file says it is. A file from a version this build has never
 *  heard of is read as far as it makes sense and never written over; see
 *  `frozen` below. */
const VERSION = 1

/** One run of highlighted text, as the four corners of the box it covers, in PDF
 *  user space: clockwise from the top left as the page is read. Eight numbers,
 *  the way a PDF's own `QuadPoints` holds them, so a mark made here means the
 *  same thing to anything else that reads PDFs. */
export type Quad = readonly [number, number, number, number, number, number, number, number]

/** The colours a highlight can wear. One is offered today; the index is written
 *  down so a second one can be without the file changing shape. */
export const COLOURS = ['var(--accent)', 'var(--success)', 'var(--callout-warning)'] as const

export interface Highlight {
  /** This mark, so clicking one and deleting one can name it. */
  id: string
  /** Counting from one, the way a link and a reader both count pages. */
  page: number
  /** The words that were selected: what a citation quotes, and what says which
   *  passage a mark is on when the quads no longer line up with anything. */
  text: string
  /** One quad per line the selection ran across. */
  quads: Quad[]
  /** Into `COLOURS`. */
  colour: number
  /** Milliseconds since the epoch. */
  created: number
}

/** The sidecar, whole. */
export interface Sheet {
  version: number
  highlights: Highlight[]
}

export function emptySheet(): Sheet {
  return { version: VERSION, highlights: [] }
}

/** A sheet that shows no marks and is never written back: what a sidecar that
 *  is there and cannot be understood reads as, so the next highlight made on the
 *  PDF does not take the place of every one in the file. */
export function leftAlone(): Sheet {
  return { version: VERSION + 1, highlights: [] }
}

/** Whether a sheet may be written back. A file from a later version holds fields
 *  this build knows nothing about, and writing what was understood would throw
 *  the rest away, so it is left exactly as it is. */
export function frozen(sheet: Sheet): boolean {
  return sheet.version > VERSION
}

/** A quad, when eight numbers is what it is. */
function readQuad(value: unknown): Quad | null {
  if (!Array.isArray(value) || value.length !== 8) return null

  // Anything that is not a number becomes one that no comparison passes, which
  // is how eight readings turn into one answer.
  const at = (index: number): number => {
    const one: unknown = value[index]
    return isNumber(one) ? one : Number.NaN
  }

  const quad: Quad = [at(0), at(1), at(2), at(3), at(4), at(5), at(6), at(7)]
  return quad.some(Number.isNaN) ? null : quad
}

/** One highlight, once it reads as one. A mark with no page or no quads covers
 *  nothing and is dropped: half a highlight is a corrupt entry, not a mark. */
function readHighlight(value: unknown): Highlight | null {
  if (!isRecord(value)) return null

  const quads = Array.isArray(value.quads)
    ? value.quads.map(readQuad).filter((quad): quad is Quad => quad !== null)
    : []
  const page = isNumber(value.page) ? Math.floor(value.page) : 0
  if (page < 1 || !quads.length) return null

  return {
    id: isString(value.id) && value.id ? value.id : `${page}-${quads[0]?.[0] ?? 0}`,
    page,
    text: isString(value.text) ? value.text : '',
    quads,
    colour: isNumber(value.colour) ? Math.min(Math.max(0, Math.floor(value.colour)), 2) : 0,
    created: isNumber(value.created) ? value.created : 0,
  }
}

/** The sidecar as it was written down. Nothing here casts: the file may have been
 *  written by another version, by a sync half way through, or by hand. Each mark
 *  is recognised on its own, so one bad entry costs the reader that entry rather
 *  than every highlight in the document. */
export function readSheet(text: string): Sheet {
  if (!text.trim()) return emptySheet()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON at all: the file is somebody's and not ours.
    return leftAlone()
  }

  if (!isRecord(parsed)) return emptySheet()

  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.map(readHighlight).filter((one): one is Highlight => one !== null)
    : []

  return {
    version: isNumber(parsed.version) ? parsed.version : VERSION,
    highlights: sorted(highlights),
  }
}

/** In reading order, so the file reads like the document and two machines that
 *  made the same marks write the same bytes. */
function sorted(highlights: readonly Highlight[]): Highlight[] {
  return [...highlights].sort(
    (one, other) =>
      one.page - other.page || one.created - other.created || (one.id < other.id ? -1 : 1),
  )
}

/** The sidecar as text, or the empty string for a PDF with no marks left on it -
 *  which is the command's cue to take the file away rather than leave an empty
 *  one behind. */
export function writeSheet(sheet: Sheet): string {
  if (!sheet.highlights.length) return ''

  return `${JSON.stringify({ version: VERSION, highlights: sorted(sheet.highlights) }, null, 2)}\n`
}

/** A box on the page as it is drawn now, in CSS pixels from the page's top left
 *  corner. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Turns a point one way or the other, between PDF user space and the page as it
 *  is drawn. */
export type Point = (x: number, y: number) => readonly [number, number]

/** A page's own transform, the six numbers pdf.js hands over on its viewport: a
 *  scale, the flip that puts the origin at the top, and a shift. It carries the
 *  zoom and the page's rotation with it, which is why the marks are placed
 *  through it rather than by multiplying by a zoom.
 *
 *  Read out of `viewport.transform` rather than asked of the viewport itself, so
 *  the arithmetic here is arithmetic a test can state. */
export type Transform = readonly [number, number, number, number, number, number]

/** The six numbers, whatever pdf.js handed over. An identity where one is
 *  missing, which is the transform that changes nothing. */
export function matrixOf(values: readonly number[]): Transform {
  return [
    values[0] ?? 1,
    values[1] ?? 0,
    values[2] ?? 0,
    values[3] ?? 1,
    values[4] ?? 0,
    values[5] ?? 0,
  ]
}

/** Where a point in PDF user space lands on the page as it is drawn. */
export function toViewport(matrix: Transform): Point {
  const [a, b, c, d, e, f] = matrix
  return (x, y) => [a * x + c * y + e, b * x + d * y + f]
}

/** And the other way about. The transform a page hands over is a scale, a flip
 *  and a shift, so it always has an inverse; a page that somehow says otherwise
 *  turns every point into the same one rather than into infinities. */
export function toPdf(matrix: Transform): Point {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (!determinant) return () => [0, 0]

  return (x, y) => [
    (d * (x - e) - c * (y - f)) / determinant,
    (a * (y - f) - b * (x - e)) / determinant,
  ]
}

/** Where a quad lands on the page as it is drawn. All four corners are turned
 *  rather than two, so a rotated page and rotated text both come out right. */
export function boxOf(quad: Quad, toViewport: Point): Box {
  const xs: number[] = []
  const ys: number[] = []

  for (let corner = 0; corner < 8; corner += 2) {
    const [x, y] = toViewport(quad[corner] ?? 0, quad[corner + 1] ?? 0)
    xs.push(x)
    ys.push(y)
  }

  const left = Math.min(...xs)
  const top = Math.min(...ys)

  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

/** And the other way: the box a selection covers, in PDF user space. */
export function quadOf(box: Box, toPdf: Point): Quad {
  const right = box.left + box.width
  const bottom = box.top + box.height

  const [x1, y1] = toPdf(box.left, box.top)
  const [x2, y2] = toPdf(right, box.top)
  const [x3, y3] = toPdf(right, bottom)
  const [x4, y4] = toPdf(box.left, bottom)

  return [x1, y1, x2, y2, x3, y3, x4, y4]
}

/** Marks near enough to be the same line, so two client rectangles a browser
 *  splits one line into do not become two quads with a seam down the middle. */
const SAME_LINE = 1.5

/** The boxes a selection covers, joined where the browser split one line in two.
 *  A selection across styled words comes back as a rectangle per run; a highlight
 *  should be one band per line. */
export function joinRuns(boxes: readonly Box[]): Box[] {
  const out: Box[] = []

  for (const box of [...boxes].sort((one, other) => one.top - other.top || one.left - other.left)) {
    if (box.width <= 0 || box.height <= 0) continue

    const last = out[out.length - 1]
    const sameLine =
      last !== undefined &&
      Math.abs(last.top - box.top) < SAME_LINE &&
      Math.abs(last.height - box.height) < SAME_LINE &&
      box.left <= last.left + last.width + SAME_LINE

    if (last && sameLine) {
      const right = Math.max(last.left + last.width, box.left + box.width)
      last.left = Math.min(last.left, box.left)
      last.width = right - last.left
      continue
    }

    out.push({ ...box })
  }

  return out
}

/** What the copy-link action puts on the clipboard: the link, and the words as a
 *  quote, so it pastes into a note as a citation rather than as a bare link.
 *
 *  The link itself is written by `linkTo`, like every other link in the app, so a
 *  space set to markdown links gets one of those here too. The PDF's own name is
 *  all this knows about it - a citation is copied while reading, with no note in
 *  front of it to be relative to - which is the shortest spelling either way. */
export function citation(name: string, page: number, text: string): string {
  const link = linkTo(name, null, { fragment: `page=${page}` })
  // Asked before the quote is built, not after: splitting nothing gives one
  // empty line, and an empty line quoted is a `>` with nothing after it.
  const words = text.trim()
  if (!words) return `${link}\n`

  const quoted = words
    .split('\n')
    .map((line) => `> ${line.trim()}`)
    .join('\n')

  return `${quoted}\n\n${link}\n`
}
