/** The note as a Word document.
 *
 *  A real one: named styles a person can change in Word's own styles pane, real
 *  numbering behind the ordered lists, a real table whose header repeats over a
 *  page break, real footnotes at the foot of the page, and the maths as OMML
 *  rather than a picture of it. Everything is built through the `docx` package,
 *  which owns the package's parts and its relationships; what is here is only the
 *  reading of the note into components.
 *
 *  Pure but for the pictures it is handed. The bytes arrive already read, so
 *  nothing here touches a disk or the network and the whole writer is testable on
 *  a note alone. */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  type FileChild,
  FootnoteReferenceRun,
  HeadingLevel,
  HighlightColor,
  type INumberingOptions,
  type IParagraphPropertiesOptions,
  type IRunPropertiesOptions,
  type IStylesOptions,
  ImageRun,
  LevelFormat,
  LineRuleType,
  // `Math` is the global every rounding call below needs, so Word's own maths
  // element comes in under the name the rest of this codebase gives the subject.
  Math as Maths,
  PageBreak,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { fromBase64 } from '../bytes'
import type { Align, Block, Doc, Entry, Item, Span } from './document'
import { ommlFor } from './omml'
import type { Picture } from './pictures'

/** Consolas is on every Windows and Word substitutes something monospaced for it
 *  everywhere else, which is more than a bare `monospace` would get. */
const MONOSPACE = 'Consolas'

const INK = '1A1A1A'
const CODE_INK = '3F3F46'
const CODE_FILL = 'F5F5F5'
const HEAD_FILL = 'EFEFEF'
const LINE = 'BFBFBF'

/** Twips, which is how Word counts a page: a twentieth of a point, so an inch is
 *  1440 and half an inch - one rung of indent - is this. */
const STEP = 720

/** The numbering every ordered list in the document counts against. */
const ORDERED = 'nib-ordered'

/** Five rungs is as deep as a list goes before the shape stops saying anything,
 *  and Word wants each rung declared before a paragraph may sit on it. */
const RUNGS = [0, 1, 2, 3, 4]

/** How wide a picture may be drawn, in pixels at the 96 to the inch Word counts
 *  a drawing in. The text column of a letter page with an inch of margin each
 *  side is 624 of them, so 600 keeps a picture inside the column with room to
 *  spare whatever the margins turn out to be. */
const MAX_PICTURE = 600

/** An open box and a ticked one. Word has a content control that draws a real
 *  checkbox, but it survives almost nothing it is handed to - another reader, a
 *  PDF, a paste into mail - and these two characters survive all of it. */
const CHECKS = { open: '☐ ', done: '☑ ' }

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

/** The body: eleven point, with a line and a little air, which is what a page of
 *  prose reads at. Used twice on purpose - as the document's defaults, which
 *  everything in the file falls back to, and as `Normal`, which is the name a
 *  person finds it under in Word. */
const BODY = {
  run: { font: 'Calibri', size: 22 },
  paragraph: { spacing: { after: 160, line: 276, lineRule: LineRuleType.AUTO } },
}

/** One rung of the heading ladder. The air above a heading is twice the air
 *  under it, which is what ties it to the text it introduces. */
function heading(size: number, before: number) {
  return {
    run: { size, bold: true, color: size >= 24 ? INK : CODE_INK },
    paragraph: { spacing: { before, after: Math.round(before / 2) } },
  }
}

const CODE_BORDER = { style: BorderStyle.SINGLE, size: 2, color: 'E4E4E7', space: 4 }

const STYLES: IStylesOptions = {
  default: {
    document: BODY,
    title: { run: { size: 52, bold: true, color: INK }, paragraph: { spacing: { after: 280 } } },
    heading1: heading(32, 320),
    heading2: heading(28, 280),
    heading3: heading(24, 240),
    heading4: heading(22, 220),
    heading5: heading(22, 200),
    heading6: heading(20, 200),
  },
  paragraphStyles: [
    { id: 'Normal', name: 'Normal', quickFormat: true, ...BODY },
    {
      id: 'CodeBlock',
      name: 'Code Block',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: MONOSPACE, size: 18, color: CODE_INK },
      paragraph: {
        shading: { fill: CODE_FILL },
        // No air between the lines, because the lines are one block: a fence
        // spaced like prose is a fence nobody can read the shape of.
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        contextualSpacing: true,
        border: {
          top: CODE_BORDER,
          bottom: CODE_BORDER,
          left: CODE_BORDER,
          right: CODE_BORDER,
        },
      },
    },
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { italics: true, color: '52525B' },
      paragraph: {
        indent: { left: STEP },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: LINE, space: 12 } },
        spacing: { after: 120 },
      },
    },
    {
      id: 'Caption',
      name: 'Caption',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 18, italics: true, color: '52525B' },
      paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 240 } },
    },
  ],
  characterStyles: [
    {
      id: 'Code',
      name: 'Code',
      run: { font: MONOSPACE, size: 18, color: CODE_INK, shading: { fill: CODE_FILL } },
    },
  ],
}

const NUMBERING: INumberingOptions = {
  config: [
    {
      reference: ORDERED,
      levels: RUNGS.map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: STEP * (level + 1), hanging: 360 } } },
      })),
    },
  ],
}

/** The kinds of picture Word embeds as they are. */
const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

/** The frame headers of a JPEG, which are the markers that carry the size. C4,
 *  C8 and CC share the range and are tables rather than frames. */
const JPEG_FRAMES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

interface Size {
  width: number
  height: number
}

function reader(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** A PNG says its size in the IHDR chunk, which the format puts first: two
 *  big-endian words at byte 16. */
function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24) return null

  const png = reader(bytes)
  if (png.getUint32(0) !== 0x89504e47) return null

  return { width: png.getUint32(16), height: png.getUint32(20) }
}

/** A JPEG is a chain of segments, each one `FF`, a marker, and its own length.
 *  The size is in the first frame header, height five bytes into the segment and
 *  width seven. */
function jpegSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const jpeg = reader(bytes)
  let at = 2

  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }

    const marker = bytes[at + 1] ?? 0
    if (JPEG_FRAMES.has(marker)) {
      return { width: jpeg.getUint16(at + 7), height: jpeg.getUint16(at + 5) }
    }

    // The padding between segments, and the markers that stand on their own,
    // carry no length to step over.
    if (marker === 0xff) at++
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) at += 2
    else at += 2 + Math.max(jpeg.getUint16(at + 2), 2)
  }

  return null
}

/** A GIF writes its size little-endian right after the signature. */
function gifSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 10) return null

  const gif = reader(bytes)
  return { width: gif.getUint16(6, true), height: gif.getUint16(8, true) }
}

/** A BMP writes its size in the info header. The height is signed, because a
 *  negative one means the rows were stored top down. */
function bmpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 26) return null

  const bmp = reader(bytes)
  return { width: bmp.getInt32(18, true), height: Math.abs(bmp.getInt32(22, true)) }
}

function sizeOf(bytes: Uint8Array, mime: string): Size | null {
  if (mime === 'image/png') return pngSize(bytes)
  if (mime === 'image/jpeg') return jpegSize(bytes)
  if (mime === 'image/gif') return gifSize(bytes)
  if (mime === 'image/bmp') return bmpSize(bytes)

  return null
}

/** The size a picture is drawn at: its own, or as much of it as the text column
 *  takes, in proportion. Word stretches a drawing to whatever it is told, so a
 *  size guessed rather than read is a squashed picture. */
function fitted(size: Size): Size {
  if (size.width <= MAX_PICTURE) return size

  return { width: MAX_PICTURE, height: Math.round((size.height * MAX_PICTURE) / size.width) }
}

interface Drawn {
  readonly picture: Picture
  readonly type: 'png' | 'jpg' | 'gif' | 'bmp'
  readonly size: Size
}

/** What a document needs to write a run: the pictures the note may name, the
 *  number each footnote label was given, and a count of the ordered lists so far,
 *  because each of them needs a numbering of its own to start again from one. */
interface Writer {
  readonly pictures: ReadonlyMap<string, Picture>
  readonly notes: ReadonlyMap<string, number>
  lists: number
}

/** What a block inherits from whatever it sits inside: the rung of the list it is
 *  under, and the style a blockquote puts on the prose in it. */
interface Nesting {
  readonly level: number
  readonly style: string | null
}

const OUTERMOST: Nesting = { level: 0, style: null }

/** The picture a `src` names, as far as it can be drawn: the bytes, the kind Word
 *  reads them as, and the size its own header gives.
 *
 *  Null for everything else, which the caller writes as words instead. An SVG is
 *  one of those: Word wants a raster fallback beside the vector for the readers
 *  that cannot draw one, and rasterising here to make one costs more than a
 *  note's diagram is worth. */
function drawnPicture(src: string, writer: Writer): Drawn | null {
  const picture = writer.pictures.get(src)
  if (picture === undefined) return null

  const type = IMAGE_TYPES[picture.mime]
  if (type === undefined) return null

  const size = sizeOf(picture.bytes, picture.mime)
  if (size === null || size.width <= 0 || size.height <= 0) return null

  return { picture, type, size: fitted(size) }
}

/** What a picture falls back to, in brackets, exactly as the plain text export
 *  writes it. */
function pictureWords(span: Span): string {
  return span.text ? `[${span.text}]` : '[picture]'
}

function pictureRun(span: Span, drawn: Drawn | null): ParagraphChild {
  if (drawn === null) return new TextRun({ text: pictureWords(span) })

  return new ImageRun({
    type: drawn.type,
    data: drawn.picture.bytes,
    transformation: drawn.size,
    altText: {
      name: drawn.picture.name,
      ...(span.text ? { description: span.text } : {}),
    },
  })
}

/** The six colours a `==highlight==` can be, as the nearest of the seventeen
 *  Word's highlight attribute allows.
 *
 *  Word has no colour of its own to mix here: `w:highlight` takes one of a fixed
 *  seventeen names, so a wash of `--canvas-2` cannot be asked for and the nearest
 *  is what a reader gets. What matters is that a red highlight and a green one do
 *  not both arrive yellow, which is what one hardcoded colour made of them.
 *
 *  The plain highlight keeps yellow: it named no colour, and yellow is what a
 *  highlighter is. `darkYellow` is Word's amber and the only orange it has.
 *  `cyan` rather than `blue` for the blue tone, and `magenta` rather than
 *  `darkMagenta` for the violet one, because Word's own blue and dark magenta are
 *  dark enough to swallow the words they are meant to be lighting up. */
const HIGHLIGHTS: Record<number, (typeof HighlightColor)[keyof typeof HighlightColor]> = {
  1: HighlightColor.RED,
  2: HighlightColor.DARK_YELLOW,
  4: HighlightColor.GREEN,
  5: HighlightColor.CYAN,
  6: HighlightColor.MAGENTA,
}

/** The marks a span carries, and only those. Word writes `<w:b w:val="false"/>`
 *  for a mark set to false, and a file full of those is a file nothing can be
 *  read out of. */
function marksOf(span: Span): IRunPropertiesOptions {
  return {
    ...(span.bold ? { bold: true } : {}),
    ...(span.italic ? { italics: true } : {}),
    ...(span.strike ? { strike: true } : {}),
    ...(span.mark ? { highlight: HIGHLIGHTS[span.tone ?? 0] ?? HighlightColor.YELLOW } : {}),
    ...(span.sup ? { superScript: true } : {}),
    ...(span.sub ? { subScript: true } : {}),
    // A run wears one character style, so code beats a link. The address is not
    // lost by that: it is on the hyperlink around the run, not on the run.
    ...(span.code ? { style: 'Code' } : span.href === undefined ? {} : { style: 'Hyperlink' }),
  }
}

/** The span's words. A line break inside a paragraph becomes Word's own break
 *  rather than a character, which is the only way it survives. */
function textRuns(span: Span): TextRun[] {
  const marks = marksOf(span)

  return span.text
    .split('\n')
    .map((line, at) => new TextRun({ text: line, ...marks, ...(at > 0 ? { break: 1 } : {}) }))
}

function mathsRuns(span: Span): ParagraphChild[] {
  const omml = ommlFor(span.text)
  if (omml !== null) return [new Maths({ children: omml })]

  // The source in the code style, which is neither a picture nor silence: a
  // reader who knows TeX still reads the formula, and one who does not at least
  // sees that there was one.
  return [new TextRun({ text: span.text, style: 'Code' })]
}

function noteRuns(span: Span, writer: Writer): ParagraphChild[] {
  const label = span.note ?? ''
  const number = writer.notes.get(label)
  if (number !== undefined) return [new FootnoteReferenceRun(number)]

  // A reference to a footnote nobody defined has nothing to point at, so the
  // label is raised and left standing where it was written.
  return [new TextRun({ text: label, superScript: true })]
}

function runsOf(spans: readonly Span[], writer: Writer): ParagraphChild[] {
  return spans.flatMap((span) => {
    if (span.picture !== undefined) {
      return [pictureRun(span, drawnPicture(span.picture, writer))]
    }
    if (span.note !== undefined) return noteRuns(span, writer)
    if (span.maths === true) return mathsRuns(span)
    if (span.href !== undefined) {
      return [new ExternalHyperlink({ children: textRuns(span), link: span.href })]
    }

    return textRuns(span)
  })
}

/** The words a run of spans says, with none of the marks: what a title is
 *  compared against. */
function wordsOf(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('')
}

function alignmentOf(align: Align) {
  if (align === 'center') return AlignmentType.CENTER
  if (align === 'right') return AlignmentType.RIGHT

  return AlignmentType.LEFT
}

function nested(nesting: Nesting): IParagraphPropertiesOptions {
  return {
    ...(nesting.level > 0 ? { indent: { left: STEP * nesting.level } } : {}),
    ...(nesting.style === null ? {} : { style: nesting.style }),
  }
}

const CELL_EDGE = { style: BorderStyle.SINGLE, size: 2, color: LINE }
const CELL_BORDERS = { top: CELL_EDGE, bottom: CELL_EDGE, left: CELL_EDGE, right: CELL_EDGE }

function cellOf(spans: readonly Span[], align: Align, head: boolean, writer: Writer): TableCell {
  // The header's words are bold because the row is a header, not because the note
  // wrote them bold, so the mark goes on the spans rather than being threaded
  // through every run behind them.
  const shown = head ? spans.map((span) => ({ ...span, bold: true })) : spans

  return new TableCell({
    borders: CELL_BORDERS,
    ...(head ? { shading: { fill: HEAD_FILL } } : {}),
    children: [new Paragraph({ alignment: alignmentOf(align), children: runsOf(shown, writer) })],
  })
}

function tableOf(block: Extract<Block, { kind: 'table' }>, writer: Writer): Table {
  const row = (cells: readonly Span[][], head: boolean) =>
    new TableRow({
      // A header that repeats is a header a reader can still see on page four.
      ...(head ? { tableHeader: true } : {}),
      children: cells.map((cell, at) => cellOf(cell, block.align[at] ?? null, head, writer)),
    })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [row(block.head, true), ...block.rows.map((cells) => row(cells, false))],
  })
}

function itemChildren(
  item: Item,
  ordered: boolean,
  instance: number,
  nesting: Nesting,
  writer: Writer,
): FileChild[] {
  const check =
    item.checked === null ? [] : [new TextRun({ text: item.checked ? CHECKS.done : CHECKS.open })]

  const own = new Paragraph({
    ...(ordered
      ? { numbering: { reference: ORDERED, level: nesting.level, instance } }
      : { bullet: { level: nesting.level } }),
    children: [...check, ...runsOf(item.spans, writer)],
  })

  return [own, ...childrenOf(item.blocks, writer, { ...nesting, level: nesting.level + 1 })]
}

/** A paragraph, and the picture that is sometimes the whole of one. That picture
 *  gets a line to itself with its words under it as a caption, which is what a
 *  picture in a note looks like on a page. */
function paragraphChildren(spans: readonly Span[], writer: Writer, nesting: Nesting): FileChild[] {
  const only = spans.length === 1 ? spans[0] : undefined
  const drawn = only?.picture === undefined ? null : drawnPicture(only.picture, writer)

  if (only !== undefined && drawn !== null) {
    const caption = only.text
      ? [new Paragraph({ style: 'Caption', children: [new TextRun({ text: only.text })] })]
      : []

    return [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [pictureRun(only, drawn)] }),
      ...caption,
    ]
  }

  return [new Paragraph({ ...nested(nesting), children: runsOf(spans, writer) })]
}

function entryChildren(entry: Entry, writer: Writer, nesting: Nesting): FileChild[] {
  const term = entry.term.map((span) => ({ ...span, bold: true }))

  return [
    new Paragraph({ ...nested(nesting), children: runsOf(term, writer) }),
    ...entry.details.map(
      (detail) =>
        new Paragraph({
          ...nested(nesting),
          indent: { left: STEP * (nesting.level + 1) },
          children: runsOf(detail, writer),
        }),
    ),
  ]
}

/** A formula on its own line, centred either way. When the TeX is more than the
 *  translator knows, the source goes in instead: it is what the note says, and a
 *  reader can still read it, which is more than a blank line offers. */
function mathsChildren(tex: string): FileChild[] {
  const omml = ommlFor(tex)

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children:
        omml === null
          ? [new TextRun({ text: tex, style: 'Code' })]
          : [new Maths({ children: omml })],
    }),
  ]
}

function blockChildren(block: Block, writer: Writer, nesting: Nesting): FileChild[] {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), HEADINGS.length)

      return [
        new Paragraph({
          heading: HEADINGS[level - 1] ?? HeadingLevel.HEADING_1,
          // A heading alone at the foot of a page is a heading in the wrong
          // place, so it holds on to the paragraph after it.
          keepNext: true,
          children: runsOf(block.spans, writer),
        }),
      ]
    }

    case 'paragraph':
      return paragraphChildren(block.spans, writer, nesting)

    case 'code':
      // One paragraph per line, and no colouring. The indentation and the blank
      // lines are the point: somebody is here to copy the code out.
      return block.code
        .split('\n')
        .map(
          (line) => new Paragraph({ style: 'CodeBlock', children: [new TextRun({ text: line })] }),
        )

    case 'maths':
      return mathsChildren(block.tex)

    case 'quote': {
      const label =
        block.label === null
          ? []
          : [
              new Paragraph({
                style: 'Quote',
                children: [new TextRun({ text: block.label, bold: true })],
              }),
            ]

      return [...label, ...childrenOf(block.blocks, writer, { ...nesting, style: 'Quote' })]
    }

    case 'list': {
      const instance = block.ordered ? writer.lists++ : 0

      return block.items.flatMap((item) =>
        itemChildren(item, block.ordered, instance, nesting, writer),
      )
    }

    case 'table':
      return [tableOf(block, writer)]

    case 'terms':
      return block.entries.flatMap((entry) => entryChildren(entry, writer, nesting))

    case 'rule':
      return [
        new Paragraph({
          ...nested(nesting),
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } },
        }),
      ]

    case 'break':
      return [new Paragraph({ children: [new PageBreak()] })]
  }
}

function childrenOf(blocks: readonly Block[], writer: Writer, nesting: Nesting): FileChild[] {
  return blocks.flatMap((block) => blockChildren(block, writer, nesting))
}

/** The document's own name at the top, unless the note already opens with it as a
 *  heading. The rule the plain text export follows, so one note cannot come out
 *  titled twice. */
function titleChildren(doc: Doc): FileChild[] {
  const first = doc.blocks[0]
  const heads = first?.kind === 'heading' && wordsOf(first.spans).trim() === doc.title.trim()
  // A title the note never claimed is the file's own name, which is already on
  // the file; printing it as the first line would be a word nobody wrote.
  if (heads || !doc.named) return []

  return [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title })] }),
  ]
}

/** The footnotes, numbered in the order the note defined them, which is the order
 *  Word shows them in. */
function footnotesOf(doc: Doc, writer: Writer): Record<string, { children: Paragraph[] }> {
  return Object.fromEntries(
    doc.notes.map((note, at) => [
      String(at + 1),
      { children: [new Paragraph({ children: runsOf(note.spans, writer) })] },
    ]),
  )
}

/** The whole note as the bytes of a `.docx`. */
export async function toDocx(doc: Doc, pictures: readonly Picture[]): Promise<Uint8Array> {
  const writer: Writer = {
    pictures: new Map(pictures.map((picture) => [picture.src, picture])),
    notes: new Map(doc.notes.map((note, at) => [note.label, at + 1])),
    lists: 0,
  }

  const file = new Document({
    title: doc.title,
    ...(doc.author === null ? {} : { creator: doc.author }),
    styles: STYLES,
    numbering: NUMBERING,
    footnotes: footnotesOf(doc, writer),
    sections: [{ children: [...titleChildren(doc), ...childrenOf(doc.blocks, writer, OUTERMOST)] }],
  })

  // Base64 rather than `toBuffer` or `toBlob`: the first is Node's alone and the
  // second the browser's, and this same call runs in both.
  return fromBase64(await Packer.toBase64String(file))
}
