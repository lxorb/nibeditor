import JSZip from 'jszip'
import { setHardBreaks } from '@nib/markdown'
import { afterEach, describe, expect, test } from 'vitest'
import { documentOf } from './document'
import { toDocx } from './docx'
import { toRtf } from './rtf'
import { toPlainText } from './text'

/** A paragraph hard wrapped in the file is one paragraph. A single newline in
 *  the middle of it is a space, which is what CommonMark says, what the reading
 *  view and every published page already do, and what the glasses do.
 *
 *  The blocks these exports are written from used to keep the newline, so a note
 *  wrapped at eighty columns arrived in Word, in RTF and in plain text broken at
 *  eighty columns. A hard break, which the writer asked for with two spaces or a
 *  backslash, is a `br` token and still breaks. */
describe('a paragraph wrapped in the file', () => {
  const words = (source: string) => {
    const doc = documentOf(source, 'Note.md')
    const first = doc.blocks.find((block) => block.kind === 'paragraph')
    return first && 'spans' in first ? first.spans.map((span) => span.text).join('') : ''
  }

  test('is one line of words, not the lines it was typed on', () => {
    expect(words('one\ntwo\nthree\n')).toBe('one two three')
  })

  test('keeps a hard break the writer asked for', () => {
    expect(words('one  \ntwo\n')).toBe('one\ntwo')
    expect(words('one\\\ntwo\n')).toBe('one\ntwo')
  })

  test('reads the same way in plain text', () => {
    expect(toPlainText(documentOf('one\ntwo\n', 'Note.md'))).toContain('one two')
  })

  test('leaves a fence exactly as it was written', () => {
    const doc = documentOf('```\none\ntwo\n```\n', 'Note.md')
    const fence = doc.blocks.find((block) => 'code' in block)
    expect(fence && 'code' in fence ? fence.code : '').toBe('one\ntwo')
  })
})

/** The other answer to the same switch. "A single newline breaks the line" on, and
 *  the note reads the way it was typed - on every surface, which is the whole
 *  point of the switch being asked once. The reading view, the HTML export, a
 *  card on a canvas and a published page went through the one renderer and broke
 *  the line; Word, RTF and plain text are written from the blocks in
 *  document.ts, which flowed the newline away whatever the switch said.
 *
 *  The setting is read where every other reader of it reads it, so these set it
 *  the way the app does and put it back afterwards. */
describe('a single newline, when the switch says it breaks the line', () => {
  const WRAPPED = 'one\ntwo\n'

  afterEach(() => {
    setHardBreaks(false)
  })

  test('is a break in the blocks every document format is written from', () => {
    setHardBreaks(true)
    const doc = documentOf(WRAPPED, 'Note.md')
    const first = doc.blocks.find((block) => block.kind === 'paragraph')

    expect(first && 'spans' in first ? first.spans.map((span) => span.text).join('') : '').toBe(
      'one\ntwo',
    )
  })

  test('is asked of the caller when the caller has an answer of its own', () => {
    expect(
      documentOf(WRAPPED, 'Note.md', { hardBreaks: true })
        .blocks.flatMap((block) => ('spans' in block ? block.spans : []))
        .map((span) => span.text)
        .join(''),
    ).toBe('one\ntwo')
  })

  test('is two lines in the plain text file', () => {
    expect(toPlainText(documentOf(WRAPPED, 'Note.md', { hardBreaks: true }))).toContain('one\ntwo')
  })

  test('is a \\line in the RTF file', () => {
    const rtf = toRtf(documentOf(WRAPPED, 'Note.md', { hardBreaks: true }), [])

    expect(rtf).toContain('one\\line two')
    expect(rtf).not.toContain('one two')
  })

  test('is a real break in the Word document', async () => {
    const bytes = await toDocx(documentOf(WRAPPED, 'Note.md', { hardBreaks: true }), [])
    const zip = await JSZip.loadAsync(bytes)
    const file = zip.file('word/document.xml')
    expect(file).not.toBeNull()
    // Asserted on the line above.
    const xml = await file!.async('string')

    expect(xml).toContain('<w:br/>')
    expect(xml).not.toContain('one two')
  })

  test('leaves the fence and the wrapped paragraph alone when the switch is off', async () => {
    const bytes = await toDocx(documentOf(WRAPPED, 'Note.md', { hardBreaks: false }), [])
    const zip = await JSZip.loadAsync(bytes)
    const file = zip.file('word/document.xml')
    expect(file).not.toBeNull()
    // Asserted on the line above.
    expect(await file!.async('string')).toContain('one two')
  })
})
