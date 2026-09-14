import { frontMatter, frontMatterValue } from '@nib/markdown'

/** Paper the print dialog understands, in `@page size` spelling. */
export const PAPER_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const

export const ORIENTATIONS = ['portrait', 'landscape'] as const

type Paper = (typeof PAPER_SIZES)[number]
type Orientation = (typeof ORIENTATIONS)[number]

/** The units a stylesheet and a printer both understand, and how many of each
 *  make an inch. One list, so a unit cannot be accepted when a length is read
 *  and then be unknown when it is converted. */
const PER_INCH = { mm: 25.4, cm: 2.54, in: 1, pt: 72, px: 96 } as const
type Unit = keyof typeof PER_INCH
const UNITS: readonly Unit[] = ['mm', 'cm', 'in', 'pt', 'px']
const LENGTH = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNITS.join('|')})?$`)

/** A length pulled apart. The amount stays as it was written, so `2.50` does
 *  not lose its trailing zero on the way through a number. */
interface Length {
  amount: string
  unit: Unit
}

const DEFAULT_MARGIN: Length = { amount: '20', unit: 'mm' }

function isUnit(value: string): value is Unit {
  return UNITS.some((unit) => unit === value)
}

/** Accepts `15mm`, `0.5in` or a bare number, and refuses anything else so the
 *  value can go straight into a stylesheet. A bare number is millimetres. */
function parseLength(value: string): Length | null {
  const [, amount, unit] = LENGTH.exec(value.trim()) ?? []
  if (amount === undefined) return null

  return { amount, unit: unit !== undefined && isUnit(unit) ? unit : DEFAULT_MARGIN.unit }
}

export interface PageSetup {
  paper: Paper
  orientation: Orientation
  /** A CSS length, or a plain number read as millimetres. */
  margin: string
  header: string
  footer: string
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  orientation: 'portrait',
  margin: `${DEFAULT_MARGIN.amount}${DEFAULT_MARGIN.unit}`,
  header: '',
  footer: '',
}

/** A note can overrule the app's own settings through its front matter:
 *
 *      ---
 *      export:
 *        paper: Letter
 *        margin: 15mm
 *        footer: ${title}
 *      ---
 */
export function pageSetupFor(source: string, base: PageSetup = DEFAULT_PAGE_SETUP): PageSetup {
  const block = frontMatter(source)
  if (!block) return base

  const lines = block.split('\n')
  const start = lines.findIndex((line) => /^export\s*:\s*$/.test(line))
  if (start < 0) return base

  const setup = { ...base }

  for (const line of lines.slice(start + 1)) {
    // The block ends at the first line that is not indented under it.
    if (!/^\s+\S/.test(line)) break

    const [, field, written = ''] = /^\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line) ?? []
    if (field === undefined) continue

    const value = written.trim().replace(/^["']|["']$/g, '')
    if (!value) continue

    switch (field.toLowerCase()) {
      case 'paper':
      case 'size': {
        const paper = PAPER_SIZES.find((entry) => entry.toLowerCase() === value.toLowerCase())
        if (paper) setup.paper = paper
        break
      }
      case 'orientation':
        if (value === 'portrait' || value === 'landscape') setup.orientation = value
        break
      case 'margin':
        setup.margin = length(value) ?? setup.margin
        break
      case 'header':
        setup.header = value
        break
      case 'footer':
        setup.footer = value
        break
    }
  }

  return setup
}

/** The same length written the way a stylesheet takes it, or null when what
 *  came in is not a length at all. */
export function length(value: string): string | null {
  const parsed = parseLength(value)
  return parsed ? `${parsed.amount}${parsed.unit}` : null
}

/** `${title}` and `${date}` are the only placeholders; page numbers come from
 *  the print dialog, which is the only thing that knows how many there are. */
export function fill(template: string, title: string, date: string): string {
  return template
    .replace(/\$\{title\}/g, title)
    .replace(/\$\{date\}/g, date)
    .replace(/\$\{year\}/g, date.slice(0, 4))
}

/** The paper half of the print stylesheet. */
export function pageCss(setup: PageSetup): string {
  const margin = length(setup.margin) ?? DEFAULT_PAGE_SETUP.margin
  return `@page { size: ${setup.paper} ${setup.orientation}; margin: ${margin}; }`
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character)
}

/** Wraps the page body so a header repeats at the top of every sheet and a
 *  footer sits at the bottom of each. Browsers repeat a table's head and foot
 *  across pages and reserve their room, which is what makes running text
 *  possible without a print engine; a plain export stays a plain document. */
export function withRunningText(
  body: string,
  setup: PageSetup,
  title: string,
  date: string,
): string {
  if (!setup.header && !setup.footer) return body

  const header = setup.header
    ? `<thead><tr><td><div class="running-header">${escape(fill(setup.header, title, date))}</div></td></tr></thead>\n`
    : ''
  const footer = setup.footer
    ? `<tfoot><tr><td></td></tr></tfoot>\n<div class="running-footer">${escape(fill(setup.footer, title, date))}</div>\n`
    : ''

  return `<table class="sheet">\n${header}<tbody><tr><td>\n${body}</td></tr></tbody>\n</table>\n${footer}`
}

/** How many twips make an inch: a twip is a twentieth of a point, which is the unit
 *  both Word and RTF count a page in. */
export const TWIPS_PER_INCH = 1440

/** Paper in inches, the unit a native print engine takes. */
const PAPER_INCHES: Record<Paper, [number, number]> = {
  A3: [11.69, 16.54],
  A4: [8.27, 11.69],
  A5: [5.83, 8.27],
  Letter: [8.5, 11],
  Legal: [8.5, 14],
}

/** The date the running text says: what the caller asked for, else the note's own
 *  `date`, else today. One rule, so the footer of a printed page and the footer of
 *  a Word document never disagree about what day it is. */
export function runningDate(source: string, given?: string): string {
  return given ?? frontMatterValue(source, 'date') ?? new Date().toISOString().slice(0, 10)
}

export interface PaperInches {
  width: number
  height: number
  margin: number
  landscape: boolean
}

/** The same setup as numbers, for the native printer on the desktop. The
 *  sheet is given upright; the printer turns it when the page is landscape. */
export function paperInches(setup: PageSetup): PaperInches {
  const [width, height] = PAPER_INCHES[setup.paper]
  const margin = parseLength(setup.margin) ?? DEFAULT_MARGIN

  return {
    width,
    height,
    margin: Math.round((Number(margin.amount) / PER_INCH[margin.unit]) * 1000) / 1000,
    landscape: setup.orientation === 'landscape',
  }
}

/** The same setup as a document writer needs it: the sheet and its margin in twips,
 *  which is what Word and RTF count a page in, and the running text with its
 *  placeholders already filled.
 *
 *  Here beside `paperInches` rather than in either writer, because the two writers
 *  would otherwise each hold a copy of the same three things - the table of paper
 *  sizes, the arithmetic from a CSS length to a printer's unit, and what `${title}`
 *  stands for - and two copies of a page size is one of them being Letter when the
 *  other is A4. Which is exactly what this is here to fix: Word and RTF ignored the
 *  page setup altogether, so a reader on the A4 default got US Letter with an inch of
 *  margin and A5, landscape and 33mm were dropped without a word.
 *
 *  The sheet is given upright, the way `paperInches` gives it, and `landscape` says to
 *  turn it: Word swaps the two itself for a landscape section, and RTF is written the
 *  other way round, so each writer says what its own format says rather than being
 *  handed a shape that suits one of them.
 *
 *  A length the settings could not read falls back to the default margin, the same
 *  answer `pageCss` gives the stylesheet. */
export interface PaperTwips {
  /** The upright sheet, in twips. */
  width: number
  height: number
  margin: number
  landscape: boolean
  /** The running text, with `${title}` and `${date}` already filled in. Empty for a
   *  setup that asks for none. */
  header: string
  footer: string
}

export function paperTwips(setup: PageSetup, title: string, date: string): PaperTwips {
  const [width, height] = PAPER_INCHES[setup.paper]
  const margin = parseLength(setup.margin) ?? DEFAULT_MARGIN
  const twips = (value: number) => Math.round(value * TWIPS_PER_INCH)

  return {
    width: twips(width),
    height: twips(height),
    // From the length itself rather than from `paperInches`, which rounds to the
    // thousandth of an inch a print engine is given: 20 mm is 1134 twips, and
    // 1133 is what that rounding would have made of it.
    margin: twips(Number(margin.amount) / PER_INCH[margin.unit]),
    landscape: setup.orientation === 'landscape',
    header: setup.header ? fill(setup.header, title, date) : '',
    footer: setup.footer ? fill(setup.footer, title, date) : '',
  }
}
