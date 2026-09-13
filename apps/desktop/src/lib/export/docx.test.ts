import JSZip from 'jszip'
import { beforeAll, describe, expect, test } from 'vitest'
import { CORPUS, CORPUS_NAME } from './corpus'
import { documentOf } from './document'
import { toDocx } from './docx'
import type { Picture } from './pictures'

/** A real PNG, twenty four by sixteen: header, one stored deflate block, end.
 *  Built by hand so the test knows the size the writer should read back. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, body: number[]): number[] => {
    const bytes = [...new TextEncoder().encode(type), ...body]
    const length = [
      (body.length >>> 24) & 0xff,
      (body.length >>> 16) & 0xff,
      (body.length >>> 8) & 0xff,
      body.length & 0xff,
    ]
    // The CRC is not read by anything here, and a wrong one would only matter to
    // a reader that draws the picture.
    return [...length, ...bytes, 0, 0, 0, 0]
  }

  const be = (value: number) => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]

  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...be(width), ...be(height), 8, 2, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0, 0, 0, 1]),
    ...chunk('IEND', []),
  ])
}

/** A JPEG header alone: start of image, a baseline frame that says how big it is,
 *  end of image. Only the frame is read, so nothing else has to be real. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ])
}

const LOCAL = png(24, 16)
const REMOTE = jpeg(1200, 600)

const PICTURES: Picture[] = [
  { src: 'assets/pic.png', name: 'pic.png', mime: 'image/png', bytes: LOCAL },
  {
    src: 'https://nibeditor.com/remote.jpg',
    name: 'remote.jpg',
    mime: 'image/jpeg',
    bytes: REMOTE,
  },
]

const doc = documentOf(CORPUS, CORPUS_NAME)

let zip: JSZip
let document_: string
let styles: string
let footnotes: string
let rels: string

beforeAll(async () => {
  // Built once: packing a document is the slow part, and every test below reads
  // the same package.
  zip = await JSZip.loadAsync(await toDocx(doc, PICTURES))
  const read = async (path: string) => {
    const file = zip.file(path)
    expect(file, path).not.toBeNull()
    // Asserted just above; a missing part is a failed test, not a null read.
    return file!.async('string')
  }

  document_ = await read('word/document.xml')
  styles = await read('word/styles.xml')
  footnotes = await read('word/footnotes.xml')
  rels = await read('word/_rels/document.xml.rels')
})

/** Every tag in some XML, in order, with a stack so a close that does not match
 *  its open is a failure rather than something a later assertion trips over. */
function wellFormed(xml: string): { tags: number; deepest: number } {
  const open: string[] = []
  let tags = 0
  let deepest = 0

  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')

  for (const match of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name = '', attributes = '', empty] = match
    tags++

    if (closing) {
      expect(open.pop(), `</${name}> closes the wrong tag`).toBe(name)
      continue
    }

    // An attribute value may hold a `>`, which the pattern above would end the
    // tag on; none of what Word writes does, so a stray one is a real fault.
    expect(attributes, name).not.toContain('<')
    if (!empty) {
      open.push(name)
      deepest = Math.max(deepest, open.length)
    }
  }

  expect(open, 'tags left open').toEqual([])

  // A bare ampersand is the other way well-formed XML goes wrong, and the one a
  // note full of prose is likeliest to cause.
  const stray = [...body.matchAll(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g)]
  expect(stray.map((one) => body.slice(one.index, one.index + 12))).toEqual([])

  return { tags, deepest }
}

const count = (xml: string, pattern: RegExp) => [...xml.matchAll(pattern)].length

describe('the package', () => {
  test('holds every part a Word document is made of', async () => {
    const wanted = [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/footnotes.xml',
      'word/_rels/document.xml.rels',
      'docProps/core.xml',
    ]

    expect(wanted.filter((path) => zip.file(path) === null)).toEqual([])
    // Guards the test: an empty zip would pass a filter over nothing.
    expect(Object.keys(zip.files).length).toBeGreaterThan(wanted.length)
  })

  test('declares a content type for every part in it', async () => {
    const types = await zip.file('[Content_Types].xml')!.async('string')
    wellFormed(types)

    for (const extension of ['png', 'jpeg', 'xml', 'rels']) {
      expect(types.toLowerCase(), extension).toContain(`extension="${extension}"`)
    }
  })

  test('names the document and its author in the properties', async () => {
    const core = await zip.file('docProps/core.xml')!.async('string')
    wellFormed(core)

    expect(core).toContain('Export corpus')
    expect(core).toContain('Ada Lovelace')
  })
})

describe('the document part', () => {
  test('is well formed, and deep enough to be a real document', () => {
    const { tags, deepest } = wellFormed(document_)

    expect(tags).toBeGreaterThan(200)
    expect(deepest).toBeGreaterThan(4)
  })

  test('every relationship it names resolves to a target in the package', () => {
    wellFormed(rels)

    const declared = new Map(
      [...rels.matchAll(/Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(([, id = '', target = '']) => [
        id,
        target,
      ]),
    )

    const used = [...document_.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map(([, id = '']) => id)
    expect(used.length, 'a link and two pictures at least').toBeGreaterThan(2)

    const missing = used.filter((id) => !declared.has(id))
    expect(missing).toEqual([])

    // A picture's relationship points at a part that has to actually be there.
    const parts = [...declared.values()].filter((target) => target.startsWith('media/'))
    expect(parts.length).toBe(2)
    expect(parts.filter((target) => zip.file(`word/${target}`) === null)).toEqual([])
  })
})

describe('styles and numbering', () => {
  test('declare the headings and the two code styles by id', () => {
    wellFormed(styles)

    for (const id of ['Heading1', 'Heading2', 'Heading6', 'Title', 'Code', 'CodeBlock', 'Quote']) {
      expect(styles, id).toContain(`w:styleId="${id}"`)
    }
  })

  test('give code a monospace face and a shaded block', () => {
    expect(styles).toContain('Consolas')
    expect(styles).toContain('F5F5F5')
  })

  test('number an ordered list with Word’s own numbering rather than typed digits', async () => {
    const numbering = await zip.file('word/numbering.xml')!.async('string')
    wellFormed(numbering)

    expect(numbering).toContain('%1.')
    expect(document_).toContain('<w:numPr>')
  })
})

describe('what the note says reaches the document', () => {
  test('the headings, in order, at their own levels', () => {
    const used = [...document_.matchAll(/w:val="Heading(\d)"/g)].map(([, level = '']) => level)

    expect(used[0]).toBe('1')
    expect(used).toContain('2')
  })

  test('a bold, an italic, a struck and a highlighted run', () => {
    expect(document_).toContain('<w:b/>')
    expect(document_).toContain('<w:i/>')
    expect(document_).toContain('<w:strike/>')
    expect(document_).toContain('<w:highlight')
  })

  test('a superscript and a subscript', () => {
    expect(document_).toContain('w:val="superscript"')
    expect(document_).toContain('w:val="subscript"')
  })

  test('a link, pointing where the note pointed', () => {
    expect(rels).toContain('https://nibeditor.com')
    expect(document_).toContain('<w:hyperlink')
  })

  test('the code block, keeping every line and its indentation', () => {
    expect(document_).toContain('const answer: number = 42')
    // The leading spaces of the second line are what a code block is for, and
    // Word drops leading space unless the run says to keep it.
    expect(document_).toMatch(/xml:space="preserve">\s*const indented = true/)
  })

  test('the table, with a header row that repeats over a page break', () => {
    expect(count(document_, /<w:tr[ >]/g)).toBe(3)
    expect(count(document_, /<w:tc>/g)).toBe(9)
    expect(document_).toContain('<w:tblHeader/>')
  })

  test('the table’s columns keep the alignment the note gave them', () => {
    expect(document_).toContain('w:val="center"')
    expect(document_).toContain('w:val="right"')
  })

  test('a task list, as the checkbox glyphs a reader anywhere can show', () => {
    expect(document_).toContain('\u2611')
    expect(document_).toContain('\u2610')
  })

  test('a page break where the note asked for one', () => {
    expect(document_).toContain('w:type="page"')
  })

  test('the definition list, its term and both meanings', () => {
    expect(document_).toContain('A way of writing formatted text.')
    expect(document_).toContain('Also the format itself.')
  })

  test('the callout’s label, and its words without the marker', () => {
    expect(document_).toContain('Note')
    expect(document_).toContain('Careful with that.')
    expect(document_).not.toContain('[!NOTE]')
  })

  test('a wikilink as the words it showed, brackets and all gone', () => {
    // Its own run, because the words around it are not part of the link.
    expect(document_).toContain('A wikilink to ')
    expect(document_).toContain('Another note')
    expect(document_).toContain('the other')
    expect(document_).not.toContain('[[')
  })
})

describe('maths', () => {
  test('display maths becomes OMML Word lays out itself', () => {
    expect(document_).toContain('<m:oMath>')
    // The corpus formula is an integral of a fraction, so both must be in there.
    expect(document_).toContain('<m:nary')
    expect(document_).toContain('<m:f>')
  })

  test('inline maths becomes OMML in the middle of its paragraph', () => {
    expect(count(document_, /<m:oMath>/g)).toBeGreaterThan(1)
  })

  test('a formula the translator does not know falls back to its source', async () => {
    const odd = documentOf('$$\n\\begin{matrix} a \\end{matrix}\n$$\n', 'N.md')
    const xml = await JSZip.loadAsync(await toDocx(odd, [])).then((one) =>
      one.file('word/document.xml')!.async('string'),
    )

    wellFormed(xml)
    expect(xml).toContain('begin{matrix}')
  })
})

describe('footnotes', () => {
  test('are real footnotes, referenced from where the note referenced them', () => {
    expect(document_).toMatch(/<w:footnoteReference w:id="1"\s*\/>/)
    // The apostrophe is a character reference in XML, which is what makes this
    // the check that the words were escaped rather than pasted in.
    expect(footnotes).toContain('The footnote&apos;s own words')
  })

  test('keep the marks inside their own words', () => {
    wellFormed(footnotes)
    expect(footnotes).toContain('<w:b/>')
  })

  test('a reference to a footnote nobody defined is written as its label', async () => {
    const orphan = documentOf('Words[^gone] and no definition.\n', 'N.md')
    const xml = await JSZip.loadAsync(await toDocx(orphan, [])).then((one) =>
      one.file('word/document.xml')!.async('string'),
    )

    expect(xml).toContain('gone')
    expect(xml).not.toContain('<w:footnoteReference')
  })
})

/** English metric units per pixel at 96 dpi: 914400 to the inch. What `docx`
 *  writes a transformation given in pixels as. */
const EMU = 9525

/** The parts every picture in the document points at, in the order the pictures
 *  appear. `docx` names a media part after a hash of its bytes, so the only way
 *  to the right one is through the relationship the drawing names. */
async function mediaParts(): Promise<Uint8Array[]> {
  const targets = new Map(
    [...rels.matchAll(/Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(([, id = '', target = '']) => [
      id,
      target,
    ]),
  )

  const used = [...document_.matchAll(/<a:blip r:embed="([^"]+)"/g)].map(([, id = '']) => id)

  return Promise.all(
    used.map(async (id) => {
      const file = zip.file(`word/${targets.get(id) ?? ''}`)
      expect(file, id).not.toBeNull()
      // Asserted on the line above.
      return file!.async('uint8array')
    }),
  )
}

/** Every picture's drawn size, in pixels. */
function extents(): number[][] {
  return [...document_.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map(
    ([, cx = '0', cy = '0']) => [Number(cx) / EMU, Number(cy) / EMU],
  )
}

describe('pictures', () => {
  test('are in the package with the very bytes they were handed', async () => {
    const parts = await mediaParts()

    expect(parts).toHaveLength(2)
    expect([...(parts[0] ?? [])]).toEqual([...LOCAL])
    expect([...(parts[1] ?? [])]).toEqual([...REMOTE])
  })

  test('keep the size their own header gives', () => {
    // 24 by 16 fits the column, so it is drawn at its own size.
    expect(extents()).toHaveLength(2)
    expect(extents()[0]).toEqual([24, 16])
  })

  test('a picture wider than the text column is scaled, keeping its shape', () => {
    // 1200 by 600 does not fit, so it comes down to the column's 600 and takes
    // its height with it.
    expect(extents()[1]).toEqual([600, 300])
  })

  test('one whose bytes say nothing is written as its words instead', async () => {
    const broken = documentOf('![A picture](broken.png)\n', 'N.md')
    const xml = await JSZip.loadAsync(
      await toDocx(broken, [
        { src: 'broken.png', name: 'broken.png', mime: 'image/png', bytes: new Uint8Array([1, 2]) },
      ]),
    ).then((one) => one.file('word/document.xml')!.async('string'))

    expect(xml).toContain('[A picture]')
    expect(xml).not.toContain('<w:drawing>')
  })

  test('one the caller never managed to read is written as its words too', async () => {
    const missing = documentOf('![Gone](gone.png)\n', 'N.md')
    const xml = await JSZip.loadAsync(await toDocx(missing, [])).then((one) =>
      one.file('word/document.xml')!.async('string'),
    )

    expect(xml).toContain('[Gone]')
  })
})

describe('a note with nothing much in it', () => {
  test('still packs a document that opens', async () => {
    const bare = await JSZip.loadAsync(await toDocx(documentOf('', 'Empty.md'), []))
    const xml = await bare.file('word/document.xml')!.async('string')

    wellFormed(xml)
    expect(bare.file('word/styles.xml')).not.toBeNull()
  })

  test('takes its title from the file when the note names none', async () => {
    const bare = await JSZip.loadAsync(await toDocx(documentOf('words\n', 'Untitled.md'), []))
    const core = await bare.file('docProps/core.xml')!.async('string')

    expect(core).toContain('Untitled')
  })
})

/** The six colours a `==highlight==` can be, each mapped to the nearest of the
 *  seventeen Word's own highlight attribute allows. Word has no palette of its
 *  own to mix, so this is as near as a highlight can come; what matters is that
 *  a red one and a green one do not both arrive yellow. */
describe('a coloured highlight', () => {
  const TONES = `==plain==, ==🔴 red==, ==🟠 orange==, ==🟢 green==, ==🔵 blue==, ==🟣 violet==\n`

  let xml: string

  beforeAll(async () => {
    const zip = await JSZip.loadAsync(await toDocx(documentOf(TONES, 'Tones.md'), []))
    xml = await zip.file('word/document.xml')!.async('string')
  })

  test('wears the colour it was written in, and no two the same', () => {
    const used = [...xml.matchAll(/<w:highlight w:val="([a-zA-Z]+)"\/>/g)].map(([, one]) => one)

    expect(used).toEqual(['yellow', 'red', 'darkYellow', 'green', 'cyan', 'magenta'])
    expect(new Set(used).size).toBe(6)
  })

  test('keeps the plain highlight yellow, which is what it always was', () => {
    expect(xml).toContain('<w:highlight w:val="yellow"/>')
  })

  test('never carries the colour emoji into the words', () => {
    for (const emoji of ['🔴', '🟠', '🟢', '🔵', '🟣']) expect(xml).not.toContain(emoji)
  })
})
