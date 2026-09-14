import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { DEFAULT_PAGE_SETUP, type PageSetup, pageSetupFor, paperTwips } from '../page-setup'
import { documentOf } from './document'
import { toDocx } from './docx'
import { toRtf } from './rtf'

/** The page setup, in the two formats that have a page.
 *
 *  Word and RTF ignored it altogether: the Word document went out with no page
 *  properties at all, which is Word's own default of US Letter, and the RTF had
 *  `\paperw12240\paperh15840\margl1440` written into its header by hand. So a reader
 *  on nib's A4 default got Letter, and A5, landscape and a 33 mm margin were dropped
 *  without anything saying so - while the same note printed or exported as HTML
 *  honoured every one of them.
 *
 *  Read back off the real files, the way wrapping.test.ts beside this does: a page
 *  size is a number in a package, and the only way to know it is there is to open the
 *  package and look. */

/** The note under test. Its own front matter says nothing about paper, so what comes
 *  out is what the settings asked for. */
const NOTE = '# A page\n\nWords on it.\n'

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({ ...DEFAULT_PAGE_SETUP, ...over })

/** The page properties of a `.docx`, read out of the section at the end of the body. */
async function docxPage(source: string, page: PageSetup) {
  const doc = documentOf(source, 'Note.md')
  const paper = paperTwips(pageSetupFor(source, page), doc.title, '2026-09-14')
  const zip = await JSZip.loadAsync(await toDocx(doc, [], paper))
  const xml = await zip.file('word/document.xml')!.async('string')

  const size = /<w:pgSz([^>]*)\/>/.exec(xml)?.[1] ?? ''
  const margin = /<w:pgMar([^>]*)\/>/.exec(xml)?.[1] ?? ''
  const attribute = (of: string, name: string) =>
    new RegExp(`w:${name}="(-?\\d+|portrait|landscape)"`).exec(of)?.[1] ?? null

  return {
    width: Number(attribute(size, 'w')),
    height: Number(attribute(size, 'h')),
    orientation: attribute(size, 'orient'),
    top: Number(attribute(margin, 'top')),
    left: Number(attribute(margin, 'left')),
    headers: Object.keys(zip.files).filter((one) => /word\/header\d*\.xml/.test(one)),
    footers: Object.keys(zip.files).filter((one) => /word\/footer\d*\.xml/.test(one)),
    zip,
  }
}

function rtfOf(source: string, page: PageSetup) {
  const doc = documentOf(source, 'Note.md')
  return toRtf(doc, [], paperTwips(pageSetupFor(source, page), doc.title, '2026-09-14'))
}

/** A4 upright is 8.27 by 11.69 inches, and a twip is a fourteen-hundred-and-fortieth
 *  of one: 11,909 by 16,834. The margin nib defaults to is 20 mm, which is 1134. */
describe('the paper a Word document goes out on', () => {
  test('is the A4 the app defaults to, not the Letter Word assumes', async () => {
    const page = await docxPage(NOTE, setup())

    expect(page.width).toBe(11909)
    expect(page.height).toBe(16834)
    expect(page.orientation).toBe('portrait')
    // Letter is 12240 by 15840, which is what came out before this.
    expect(page.width).not.toBe(12240)
    expect(page.height).not.toBe(15840)
  })

  test('carries the margin the settings ask for rather than Word’s inch', async () => {
    const page = await docxPage(NOTE, setup())

    expect(page.top).toBe(1134)
    expect(page.left).toBe(1134)
    expect(page.top).not.toBe(1440)
  })

  test('is A5 turned on its side, with a 33 mm margin, when that is what was asked', async () => {
    const page = await docxPage(
      NOTE,
      setup({ paper: 'A5', orientation: 'landscape', margin: '33mm' }),
    )

    // A5 upright is 5.83 by 8.27 inches: 8395 by 11909. The sheet is handed over
    // upright and the writer turns it, so what lands in the package is the page as
    // it is printed - wider than it is tall - with `orient` saying which way it was
    // turned. That is what OOXML asks for.
    expect(page.width).toBe(11909)
    expect(page.height).toBe(8395)
    expect(page.orientation).toBe('landscape')
    expect(page.top).toBe(1871)
  })

  test('and the note’s own front matter overrules the settings', async () => {
    const over = '---\nexport:\n  paper: Legal\n  margin: 15mm\n---\n\n# A page\n'
    const page = await docxPage(over, setup({ paper: 'A4', margin: '20mm' }))

    // Legal is 8.5 by 14 inches: 12240 by 20160, and 15 mm is 850 twips.
    expect(page.width).toBe(12240)
    expect(page.height).toBe(20160)
    expect(page.top).toBe(850)
  })

  test('writes a header and a footer part only when there is running text', async () => {
    const plain = await docxPage(NOTE, setup())
    expect(plain.headers).toEqual([])
    expect(plain.footers).toEqual([])

    const running = await docxPage(NOTE, setup({ header: '${title}', footer: 'page of ${date}' }))
    expect(running.headers.length).toBeGreaterThan(0)
    expect(running.footers.length).toBeGreaterThan(0)

    const header = await running.zip.file(running.headers[0]!)!.async('string')
    const footer = await running.zip.file(running.footers[0]!)!.async('string')
    // The placeholders are filled by the time a writer sees them, so what is in the
    // part is words and never `${title}`.
    expect(header).toContain('A page')
    expect(header).not.toContain('${title}')
    expect(footer).toContain('page of 2026-09-14')
  })
})

describe('the paper an RTF goes out on', () => {
  test('is the A4 the app defaults to, not the Letter that was written in by hand', () => {
    const rtf = rtfOf(NOTE, setup())

    expect(rtf).toContain('\\paperw11909\\paperh16834')
    expect(rtf).toContain('\\margl1134\\margr1134\\margt1134\\margb1134')
    expect(rtf).not.toContain('\\paperw12240\\paperh15840')
    expect(rtf).not.toContain('\\landscape')
  })

  test('is A5 on its side with a 33 mm margin when that is what was asked', () => {
    const rtf = rtfOf(NOTE, setup({ paper: 'A5', orientation: 'landscape', margin: '33mm' }))

    // RTF says the sheet as it is printed, so a turned page is the wide way round -
    // which is the other way from Word, where the sheet is upright and `orient` turns
    // it. Each format is written the way that format says it.
    expect(rtf).toContain('\\paperw11909\\paperh8395')
    expect(rtf).toContain('\\landscape')
    expect(rtf).toContain('\\margl1871')
  })

  test('and the note’s own front matter overrules the settings', () => {
    const over = '---\nexport:\n  paper: A3\n  orientation: landscape\n---\n\n# A page\n'
    const rtf = rtfOf(over, setup())

    // A3 upright is 11.69 by 16.54 inches: 16834 by 23818, turned.
    expect(rtf).toContain('\\paperw23818\\paperh16834')
    expect(rtf).toContain('\\landscape')
  })

  test('writes a header and a footer group only when there is running text', () => {
    expect(rtfOf(NOTE, setup())).not.toContain('{\\header')
    expect(rtfOf(NOTE, setup())).not.toContain('{\\footer')

    const running = rtfOf(NOTE, setup({ header: '${title}', footer: 'page of ${date}' }))
    expect(running).toContain('{\\header')
    expect(running).toContain('A page')
    expect(running).toContain('{\\footer')
    expect(running).toContain('page of 2026-09-14')
    expect(running).not.toContain('${title}')
  })

  test('and a reader cannot be talked out of the document by the running text', () => {
    // The running text is a note's own words, so it is escaped like any others: a brace
    // in a header would otherwise close the group and the rest would be control words.
    const rtf = rtfOf(NOTE, setup({ header: 'a {brace} and a \\slash' }))

    expect(rtf).toContain('a \\{brace\\} and a \\\\slash')
  })
})

/** The twips both writers count in, and the one place that works them out. */
describe('the setup as a document writer needs it', () => {
  test('is the sheet upright, its margin, and the running text already filled', () => {
    expect(paperTwips(DEFAULT_PAGE_SETUP, 'A page', '2026-09-14')).toEqual({
      width: 11909,
      height: 16834,
      margin: 1134,
      landscape: false,
      header: '',
      footer: '',
    })
  })

  test('fills the placeholders the stylesheet fills, in the same words', () => {
    const said = paperTwips(
      { ...DEFAULT_PAGE_SETUP, header: '${title}', footer: '${date} · ${year}' },
      'A page',
      '2026-09-14',
    )

    expect(said.header).toBe('A page')
    expect(said.footer).toBe('2026-09-14 · 2026')
  })

  test('and falls back to the default margin for a length nothing could read', () => {
    expect(paperTwips({ ...DEFAULT_PAGE_SETUP, margin: 'wide' }, 'A', '2026-09-14').margin).toBe(
      1134,
    )
  })
})
