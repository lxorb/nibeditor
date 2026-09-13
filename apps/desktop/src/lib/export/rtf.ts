/** The note as an RTF 1.5 file.
 *
 *  RTF is the one document format that is plain ASCII and still carries a
 *  footnote, a real table and an embedded picture, which is why it is what a
 *  word processor opens without asking anything. The whole translation lives
 *  here: the escaping of a single character, the twips a table column is wide,
 *  the hex a picture comes to.
 *
 *  Pure. The pictures arrive already read, and their pixel size is taken out of
 *  their own bytes, so a picture goes onto the page in the shape it has rather
 *  than in a shape guessed for it. */

import type { Align, Block, Doc, Item, Span } from './document'
import type { Picture } from './pictures'

/** The colour table's numbering, which starts at one: nought is the reader's
 *  own default colour. */
const BLACK = 1
const GREY = 2
const LINK = 3
const SHADE = 4
const WASH = 5

/** The five coloured highlights, in the order highlights.ts in @nib/markdown
 *  names them, as the indices they take in the table above.
 *
 *  A tone rather than a name: `==🔴 careful==` is drawn in `--canvas-1` on every
 *  other surface, and a document that arrived with all five the same yellow was
 *  the one surface that threw the colour away. RTF has a colour table of the
 *  document's own, so unlike Word these are the real wash rather than the nearest
 *  of a fixed few; the plain highlight keeps `WASH`, the index it always had. */
const TONE_COLOURS: Record<number, number> = { 1: 6, 2: 7, 4: 8, 5: 9, 6: 10 }

/** The wash each of the five is drawn in: the light theme's own `--canvas-1` and
 *  its neighbours at the same strength `--mark-1` mixes them, over the white of
 *  the page. Written out because an RTF colour table is numbers, and a word
 *  processor has no `color-mix` to do it with. See tokens.css in @nib/themes. */
const TONE_WASHES = [
  '\\red250\\green210\\blue215',
  '\\red251\\green225\\blue199',
  '\\red201\\green240\\blue216',
  '\\red199\\green238\\blue238',
  '\\red225\\green217\\blue251',
].join(';')

/** The three faces, and the colours everything is drawn in. `\f0` is the body,
 *  `\f1` the headings, `\f2` code and maths. Each names a face that is on every
 *  machine as its `\*\falt`, so a reader that has neither Georgia nor Consolas
 *  still picks something of the right kind. */
const HEADER = [
  '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1',
  '{\\fonttbl',
  '{\\f0\\froman\\fcharset0 Georgia{\\*\\falt Times New Roman};}',
  '{\\f1\\fswiss\\fcharset0 Segoe UI{\\*\\falt Arial};}',
  '{\\f2\\fmodern\\fcharset0 Consolas{\\*\\falt Courier New};}',
  '}',
  '{\\colortbl;\\red0\\green0\\blue0;\\red90\\green90\\blue90;\\red17\\green85\\blue204;',
  '\\red238\\green238\\blue238;\\red255\\green242\\blue160;',
  `${TONE_WASHES};}`,
].join('')

/** Letter paper with an inch of margin all round, which is what leaves the
 *  9360 twips a table and a wide picture are measured against. `\ftnbj` puts
 *  the footnotes at the foot of their page, where a reader looks for them. */
const PAGE = '\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440\\ftnbj'

/** Six and a half inches: the text column, and so the width of a table and the
 *  most a picture may be drawn at. */
const COLUMN = 9360

/** One rung of indent, half an inch, the same step a list takes per level. */
const STEP = 720

/** Body text: eleven point, the air after a paragraph, and the line spacing
 *  that makes a page of prose readable. */
const BODY = '\\sa180\\sl276\\slmult1\\f0\\fs22'

/** A paragraph that belongs to the one above or below it - a callout's label, a
 *  term, a detail - and so wants less air under it than prose does. */
const TIGHT = '\\sa60\\f0\\fs22'

const TERM = '\\sb120\\sa40\\f0\\fs22'

/** A line down the left of everything inside a quote. */
const QUOTE = '\\brdrl\\brdrs\\brdrw20\\brsp80'

/** A rule is an empty paragraph with a line under it, which is how a word
 *  processor draws one itself. */
const RULE = '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20\\par\n'

/** A line on all four sides of a cell, half a point thick. */
const BORDERS = ['t', 'l', 'b', 'r'].map((side) => `\\clbrdr${side}\\brdrs\\brdrw10`).join('')

/** What a character below U+0080 comes to when it cannot stand for itself. */
const SPECIAL: Record<number, string> = {
  0x5c: '\\\\',
  0x7b: '\\{',
  0x7d: '\\}',
  0x09: '\\tab ',
  0x0a: '\\line ',
  // The other half of a Windows line ending. The newline beside it already
  // stands for the break, so this one says nothing.
  0x0d: '',
}

/** Text as RTF says it.
 *
 *  Walked by code unit rather than by code point on purpose: RTF writes a
 *  character outside the BMP as two `\uN?` escapes, one per surrogate, which is
 *  exactly what the string already holds. */
function escaped(text: string): string {
  let out = ''

  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at)
    const special = SPECIAL[unit]

    if (special !== undefined) out += special
    else if (unit === 0xa0) out += '\\~'
    else if (unit < 0x80) out += String.fromCharCode(unit)
    // `\uN` takes a signed 16-bit number, so the upper half of the range is
    // written as the negative it wraps to. The `?` after it is the single
    // character a reader that cannot do Unicode shows instead.
    else out += `\\u${unit >= 0x8000 ? unit - 0x10000 : unit}?`
  }

  return out
}

interface Mark {
  of: (span: Span) => boolean
  /** What turns it on. A function where the span decides which: a highlight is
   *  one of six colours, and each is its own control word. */
  on: string | ((span: Span) => string)
  off: string
}

/** Every mark a span can carry, and the control words that turn it on and off
 *  again. One list rather than a case each, and in this order so the same
 *  combination of marks always nests the same way. */
const MARKS: readonly Mark[] = [
  { of: (span) => span.bold === true, on: '\\b', off: '\\b0' },
  { of: (span) => span.italic === true, on: '\\i', off: '\\i0' },
  { of: (span) => span.strike === true, on: '\\strike', off: '\\strike0' },
  {
    of: (span) => span.mark === true,
    on: (span) => `\\highlight${TONE_COLOURS[span.tone ?? 0] ?? WASH}`,
    off: '\\highlight0',
  },
  { of: (span) => span.sup === true, on: '\\super', off: '\\nosupersub' },
  { of: (span) => span.sub === true, on: '\\sub', off: '\\nosupersub' },
  // Inline maths is TeX, so it reads as what it is, in the face code is set in
  // but without the grey that says "not prose".
  { of: (span) => span.maths === true, on: '\\f2', off: '\\f0' },
  { of: (span) => span.code === true, on: `\\f2\\cf${GREY}`, off: `\\cf${BLACK}\\f0` },
]

/** One run of text with its marks around it. The braces are not decoration:
 *  they close the run for the reader, so the first word of whatever comes next
 *  can never be read as part of the control word that ended this one. */
function marked(span: Span, words: string): string {
  const on: string[] = []
  const off: string[] = []

  for (const mark of MARKS) {
    if (!mark.of(span)) continue
    on.push(typeof mark.on === 'string' ? mark.on : mark.on(span))
    off.unshift(mark.off)
  }

  return on.length ? `{${on.join('')} ${words}${off.join('')}}` : words
}

/** The field a reader turns into something clickable. The words sit inside the
 *  result group as well, because that is all an older reader shows.
 *
 *  The address is quoted and RTF has no escape for a quote inside a field's
 *  instruction, so one written in the note would end the address early and leave
 *  whatever followed it reading as switches to the field. A URL spells a quote
 *  `%22` anyway, so that is what it becomes. */
function hyperlink(href: string, words: string): string {
  const address = escaped(href.replace(/"/g, '%22'))
  return `{\\field{\\*\\fldinst{HYPERLINK "${address}"}}{\\fldrslt{\\cf${LINK}\\ul ${words}}}}`
}

/** The same spans, bold. A term and a callout's label are bold because of where
 *  they are, not because the note said so, and going through the marks means
 *  they are opened and closed the way every other run is. */
function bolded(spans: readonly Span[]): Span[] {
  return spans.map((span) => ({ ...span, bold: true }))
}

/** What every run needs beyond the span itself. */
interface Sheet {
  doc: Doc
  /** The pictures by the `src` the note wrote, which is the key a span holds. */
  pictures: Map<string, Picture>
  /** The footnotes being written at this moment, so a note that refers to
   *  itself stops instead of going round for ever. */
  open: Set<string>
}

/** A footnote where it is referred to, which is where RTF keeps them: the
 *  reference is a `\chftn` the reader numbers itself, and the words follow in
 *  the group beside it. A label nothing defines is left as the label, so a note
 *  with a typo in it still says a note was meant. */
function footnote(label: string, sheet: Sheet): string {
  const found = sheet.doc.notes.find((note) => note.label === label)
  if (!found || sheet.open.has(label)) return `{\\super ${escaped(label)}}`

  sheet.open.add(label)
  const words = runs(found.spans, sheet)
  sheet.open.delete(label)

  return `{\\super\\chftn}{\\footnote\\pard\\plain\\fs20\\chftn\\space\\tab ${words}}`
}

interface Size {
  width: number
  height: number
}

/** A big-endian 16-bit number, or null past the end of the bytes. */
function be16(bytes: Uint8Array, at: number): number | null {
  const high = bytes[at]
  const low = bytes[at + 1]

  return high === undefined || low === undefined ? null : high * 256 + low
}

function be32(bytes: Uint8Array, at: number): number | null {
  const high = be16(bytes, at)
  const low = be16(bytes, at + 2)

  return high === null || low === null ? null : high * 65536 + low
}

function sized(width: number | null, height: number | null): Size | null {
  if (width === null || height === null || width < 1 || height < 1) return null

  return { width, height }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** `IHDR`, as the four bytes of its name read as one number. */
const IHDR = 0x49484452

/** A PNG says its size in its first chunk, which the format requires to be
 *  IHDR: two big-endian words right after that chunk's header. */
function pngSize(bytes: Uint8Array): Size | null {
  if (PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte)) return null
  if (be32(bytes, 12) !== IHDR) return null

  return sized(be32(bytes, 16), be32(bytes, 20))
}

/** The markers with no length behind them, so walking the segments steps over
 *  two bytes rather than reading a size. */
const BARE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9])

/** A start-of-frame marker, which is the one that carries the size. C4, C8 and
 *  CC sit in the same range and are a Huffman table, an extension and an
 *  arithmetic coding table instead. */
function isFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/** A JPEG's size is in its frame header, and the only way there is to walk the
 *  segments from the front: all but a handful of them say how long they are. */
function jpegSize(bytes: Uint8Array): Size | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let at = 2
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null

    const marker = bytes[at + 1]
    if (marker === undefined) return null
    // A run of 0xff in front of a marker is padding the format allows.
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (BARE.has(marker)) {
      at += 2
      continue
    }

    const length = be16(bytes, at + 2)
    if (length === null || length < 2) return null
    // Height comes before width in a frame header, which is the one place in
    // either format where it does.
    if (isFrame(marker)) return sized(be16(bytes, at + 7), be16(bytes, at + 5))

    at += 2 + length
  }

  return null
}

/** How RTF names the two formats it can carry as they are, and how each one
 *  says its size. Everything else - a GIF, a WebP, an SVG - has no `\...blip`
 *  of its own, and turning one into a PNG would mean carrying a decoder this
 *  file has no business carrying, so those fall back to their words. */
const BLIPS: Record<string, { word: string; size: (bytes: Uint8Array) => Size | null }> = {
  'image/png': { word: '\\pngblip', size: pngSize },
  'image/jpeg': { word: '\\jpegblip', size: jpegSize },
}

/** Pixels to twips at the 96 dpi a picture for a screen is drawn for. */
const PER_PIXEL = 1440 / 96

/** What the picture is drawn at: its own size, until that is wider than the
 *  column, and then the column's width with the height brought down with it so
 *  nothing is squashed. */
function goal(size: Size): Size {
  const width = Math.round(size.width * PER_PIXEL)
  const height = Math.round(size.height * PER_PIXEL)
  if (width <= COLUMN) return { width, height }

  return { width: COLUMN, height: Math.round((height * COLUMN) / width) }
}

/** How much hex goes on one line. A reader skips the breaks inside a picture,
 *  and a person who opens the file in an editor gets lines to scroll past
 *  rather than one of a million characters. */
const HEX_WIDTH = 120

function hex(bytes: Uint8Array): string {
  const digits: string[] = []
  for (const byte of bytes) digits.push(byte.toString(16).padStart(2, '0'))

  const all = digits.join('')
  const lines: string[] = []
  for (let at = 0; at < all.length; at += HEX_WIDTH) lines.push(all.slice(at, at + HEX_WIDTH))

  return lines.join('\n')
}

/** A picture as its own bytes. Without a size read out of those bytes the goal
 *  width would be a guess, and a guess is exactly what squashes a picture, so
 *  one that cannot be measured is written as the words under it instead - the
 *  same answer the plain text writer gives. */
function pictureRun(span: Span, sheet: Sheet): string {
  const found = sheet.pictures.get(span.picture ?? '')
  const blip = found ? BLIPS[found.mime] : undefined
  const size = found && blip ? blip.size(found.bytes) : null

  if (!found || !blip || !size) return `[${escaped(span.text === '' ? 'picture' : span.text)}]`

  const drawn = goal(size)
  const props = `${blip.word}\\picw${size.width}\\pich${size.height}`

  return `{\\pict${props}\\picwgoal${drawn.width}\\pichgoal${drawn.height}\n${hex(found.bytes)}}`
}

function runOf(span: Span, sheet: Sheet): string {
  if (span.picture !== undefined) return pictureRun(span, sheet)
  if (span.note !== undefined) return footnote(span.note, sheet)

  const words = marked(span, escaped(span.text))

  return span.href === undefined ? words : hyperlink(span.href, words)
}

function runs(spans: readonly Span[], sheet: Sheet): string {
  return spans.map((span) => runOf(span, sheet)).join('')
}

/** Where a paragraph sits and what is drawn beside it, carried down so a
 *  paragraph inside a quote inside a list still knows about both. */
interface Frame {
  /** Left indent in twips. */
  indent: number
  /** Paragraph properties every paragraph in here repeats, which is how a
   *  quote's left border reaches every line of it. */
  border: string
}

const ROOT: Frame = { indent: 0, border: '' }

/** The head of a paragraph: everything reset, then where it sits, then how it
 *  looks. `lead` is for the groups a numbered item puts before its indent. The
 *  trailing space is the delimiter that keeps the first word of the text out of
 *  the last control word. */
function opened(frame: Frame, props: string, lead = ''): string {
  const indent = frame.indent > 0 ? `\\li${frame.indent}` : ''

  return `\\pard\\plain${frame.border}${lead}${indent}${props} `
}

function paragraph(spans: readonly Span[], sheet: Sheet, frame: Frame, props = BODY): string {
  return `${opened(frame, props)}${runs(spans, sheet)}\\par\n`
}

/** Half-point sizes and the air around each level. The step down is what says
 *  which heading sits under which, and `\outlinelevel` is what a reader builds
 *  its outline from. */
const HEADINGS = [
  { size: 36, before: 360, after: 160 },
  { size: 32, before: 320, after: 150 },
  { size: 28, before: 300, after: 140 },
  { size: 26, before: 280, after: 130 },
  { size: 24, before: 260, after: 120 },
  { size: 22, before: 240, after: 110 },
] as const

function heading(block: Extract<Block, { kind: 'heading' }>, sheet: Sheet, frame: Frame): string {
  const level = Math.min(Math.max(Math.round(block.level), 1), HEADINGS.length)
  // The clamp above keeps the index inside the table; the fallback is what the
  // compiler needs to believe it.
  const style = HEADINGS[level - 1] ?? HEADINGS[0]
  const air = `\\sb${style.before}\\sa${style.after}`
  const props = `\\keepn${air}\\outlinelevel${level - 1}\\f1\\fs${style.size}\\b`

  return `${opened(frame, props)}${runs(block.spans, sheet)}\\b0\\par\n`
}

/** A block of lines kept as they were written, each its own paragraph so the
 *  shading and the face hold for all of them rather than for one long wrapped
 *  line. `\sa` lands on the last line only, which keeps the block together and
 *  still leaves air under it. Nothing is trimmed: the indent is the code. */
function lined(text: string, frame: Frame, props: string): string {
  // Text ending in a newline ends where its last line does. Keeping the empty
  // string after it would add a paragraph with nothing written in it.
  const lines = text.replace(/\n$/, '').split('\n')

  return lines
    .map((line, at) => {
      const air = at === lines.length - 1 ? 180 : 0
      return `${opened(frame, `\\sb0\\sa${air}${props}`)}${escaped(line)}\\par\n`
    })
    .join('')
}

/** The bullet or the number in front of an item, twice over: the `\pntext` group
 *  is what a reader that cannot number for itself shows, and the `\*\pn` group
 *  is what one that can reads instead. */
function marker(block: Extract<Block, { kind: 'list' }>, at: number): string {
  if (!block.ordered) {
    return '{\\pntext\\f0\\bullet\\tab}{\\*\\pn\\pnlvlblt\\pnf0\\pnindent0{\\pntxtb\\bullet}}'
  }

  const number = block.start + at
  const pn = `\\pnlvlbody\\pnf0\\pnindent0\\pnstart${number}\\pndec{\\pntxta.}`

  return `{\\pntext\\f0 ${number}.\\tab}{\\*\\pn${pn}}`
}

/** The two checkbox glyphs, which is how a task reads on paper. */
const CHECKS = { true: '\\u9745?', false: '\\u9744?' }

function itemRtf(item: Item, lead: string, sheet: Sheet, frame: Frame): string {
  const inner: Frame = { ...frame, indent: frame.indent + STEP }
  const check = item.checked === null ? '' : `${CHECKS[item.checked ? 'true' : 'false']} `
  const own = `${opened(inner, '\\fi-360\\sa60\\f0\\fs22', lead)}${check}`

  // What sits under an item lines up with its words rather than its marker, and
  // a list under it steps in again from there.
  return `${own}${runs(item.spans, sheet)}\\par\n${blocksRtf(item.blocks, sheet, inner)}`
}

const ALIGNS: Record<'left' | 'center' | 'right', string> = {
  left: '\\ql',
  center: '\\qc',
  right: '\\qr',
}

/** A column with no alignment of its own reads left, which is what a table
 *  written without colons in its rule means. */
function alignWord(align: Align | undefined): string {
  return align == null ? '\\ql' : ALIGNS[align]
}

/** A real RTF table: one row definition per row, saying where each cell's right
 *  edge is, then the cells, then `\row`. The columns share the text column
 *  evenly - the note says nothing about how wide any of them wants to be. */
function tableRtf(block: Extract<Block, { kind: 'table' }>, sheet: Sheet, frame: Frame): string {
  const rows = block.head.length ? [block.head, ...block.rows] : block.rows
  const columns = Math.max(1, ...rows.map((row) => row.length))
  const edges = Array.from(
    { length: columns },
    (_, at) => frame.indent + Math.round((COLUMN * (at + 1)) / columns),
  )

  const definition = (head: boolean) =>
    edges.map((edge) => `${BORDERS}${head ? `\\clcbpat${SHADE}` : ''}\\cellx${edge}`).join('')

  const cell = (spans: readonly Span[] | undefined, at: number, head: boolean) => {
    const bold = head ? '\\b' : ''
    const props = `\\intbl${alignWord(block.align[at])}\\f0\\fs22${bold}`
    const words = spans ? runs(spans, sheet) : ''

    return `\\pard\\plain${props} ${words}${head ? '\\b0' : ''}\\cell`
  }

  const row = (cells: readonly Span[][], head: boolean) => {
    const opening = `\\trowd\\trgaph108\\trleft${frame.indent}${definition(head)}\n`
    return `${opening}${edges.map((_, at) => cell(cells[at], at, head)).join('')}\\row\n`
  }

  return rows.map((cells, at) => row(cells, at === 0 && block.head.length > 0)).join('')
}

function blocksRtf(blocks: readonly Block[], sheet: Sheet, frame: Frame): string {
  const parts: string[] = []

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        parts.push(heading(block, sheet, frame))
        break

      case 'paragraph':
        parts.push(paragraph(block.spans, sheet, frame))
        break

      case 'code':
        parts.push(lined(block.code, frame, `\\cbpat${SHADE}\\f2\\fs18`))
        break

      case 'maths':
        // Left as the TeX it is: a picture of a formula is not something the
        // reader can copy back out of the document.
        parts.push(lined(block.tex, frame, '\\qc\\f2\\fs20'))
        break

      case 'quote': {
        const inner: Frame = { indent: frame.indent + STEP, border: QUOTE }
        if (block.label !== null) {
          parts.push(paragraph(bolded([{ text: block.label }]), sheet, inner, TIGHT))
        }
        parts.push(blocksRtf(block.blocks, sheet, inner))
        break
      }

      case 'list':
        block.items.forEach((item, at) => {
          parts.push(itemRtf(item, marker(block, at), sheet, frame))
        })
        break

      case 'table':
        parts.push(tableRtf(block, sheet, frame))
        break

      case 'terms': {
        const under: Frame = { ...frame, indent: frame.indent + STEP }
        for (const entry of block.entries) {
          parts.push(paragraph(bolded(entry.term), sheet, frame, TERM))
          for (const detail of entry.details) parts.push(paragraph(detail, sheet, under, TIGHT))
        }
        break
      }

      case 'rule':
        parts.push(RULE)
        break

      case 'break':
        parts.push('\\page\n')
        break
    }
  }

  return parts.join('')
}

/** The Windows language ids for the languages a note is likely to be written in.
 *  Anything else falls back to US English, which is what a reader assumes when
 *  the file says nothing at all. */
const LANGS: Record<string, number> = {
  cs: 1029,
  da: 1030,
  de: 1031,
  en: 1033,
  es: 1034,
  fi: 1035,
  fr: 1036,
  it: 1040,
  ja: 1041,
  ko: 1042,
  nb: 1044,
  nl: 1043,
  no: 1044,
  pl: 1045,
  pt: 2070,
  ru: 1049,
  sv: 1053,
  tr: 1055,
  zh: 2052,
}

const DEFAULT_LANG = 1033

function langOf(lang: string): number {
  const base = lang.toLowerCase().split(/[-_]/)[0] ?? ''

  return LANGS[base] ?? DEFAULT_LANG
}

/** What the document says about itself. A word processor shows this as the
 *  title, and the file's name is not the note's name. */
function info(doc: Doc): string {
  const parts: string[] = []
  if (doc.title !== '') parts.push(`{\\title ${escaped(doc.title)}}`)
  if (doc.author !== null && doc.author !== '') parts.push(`{\\author ${escaped(doc.author)}}`)

  return parts.length ? `{\\info${parts.join('')}}` : ''
}

/** The whole note as one RTF file. `pictures` are the ones already read, keyed
 *  by the `src` the note wrote for them; a picture that is not in the list, or
 *  that is in a format RTF has no blip for, comes out as the words under it. */
export function toRtf(doc: Doc, pictures: readonly Picture[]): string {
  const sheet: Sheet = {
    doc,
    pictures: new Map(pictures.map((picture) => [picture.src, picture])),
    open: new Set(),
  }

  const head = `${HEADER}\\deflang${langOf(doc.lang)}${PAGE}${info(doc)}`

  return `${head}\n${blocksRtf(doc.blocks, sheet, ROOT)}}`
}
