import { describe, expect, test } from 'vitest'
import { fill, length, pageCss, pageSetupFor, paperInches, withRunningText } from './page-setup'
import { DEFAULT_PAGE_SETUP } from './paper'

const withMatter = (body: string) => `---\n${body}\n---\n\n# Note\n`

describe('reading page setup from a note', () => {
  test('falls back to the app settings when there is no front matter', () => {
    expect(pageSetupFor('# Note\n')).toEqual(DEFAULT_PAGE_SETUP)
  })

  test('falls back when the front matter says nothing about export', () => {
    expect(pageSetupFor(withMatter('title: Note'))).toEqual(DEFAULT_PAGE_SETUP)
  })

  test('reads paper, orientation and margin', () => {
    const setup = pageSetupFor(
      withMatter('export:\n  paper: Letter\n  orientation: landscape\n  margin: 15mm'),
    )

    expect(setup.paper).toBe('Letter')
    expect(setup.orientation).toBe('landscape')
    expect(setup.margin).toBe('15mm')
  })

  test('matches a paper name whatever its case', () => {
    expect(pageSetupFor(withMatter('export:\n  paper: a5')).paper).toBe('A5')
  })

  test('ignores a paper it cannot print', () => {
    expect(pageSetupFor(withMatter('export:\n  paper: Papyrus')).paper).toBe('A4')
  })

  test('reads a bare margin as millimetres', () => {
    expect(pageSetupFor(withMatter('export:\n  margin: 25')).margin).toBe('25mm')
  })

  test('keeps header and footer templates, quotes stripped', () => {
    const setup = pageSetupFor(withMatter('export:\n  header: "${title}"\n  footer: ${date}'))

    expect(setup.header).toBe('${title}')
    expect(setup.footer).toBe('${date}')
  })

  test('stops at the end of the export block', () => {
    const setup = pageSetupFor(
      withMatter('export:\n  paper: Legal\ntitle: Elsewhere\nmargin: 99mm'),
    )

    expect(setup.paper).toBe('Legal')
    expect(setup.margin).toBe('20mm')
  })

  test('overrides only what the note mentions', () => {
    const base = { ...DEFAULT_PAGE_SETUP, margin: '5mm', header: 'kept' }
    const setup = pageSetupFor(withMatter('export:\n  paper: A3'), base)

    expect(setup).toEqual({ ...base, paper: 'A3' })
  })
})

describe('lengths', () => {
  test('accepts the units a stylesheet understands', () => {
    expect(length('1in')).toBe('1in')
    expect(length('2.5 cm')).toBe('2.5cm')
    expect(length('12')).toBe('12mm')
  })

  test('refuses anything that is not a length', () => {
    expect(length('20mm; } body { display: none')).toBeNull()
    expect(length('auto')).toBeNull()
  })
})

describe('running text', () => {
  test('fills in the placeholders', () => {
    expect(fill('${title} - ${date}', 'Notes', '2026-09-03')).toBe('Notes - 2026-09-03')
    expect(fill('© ${year}', 'Notes', '2026-09-03')).toBe('© 2026')
  })

  test('leaves an unknown placeholder alone', () => {
    expect(fill('${pages}', 'Notes', '2026-09-03')).toBe('${pages}')
  })
})

describe('the print stylesheet', () => {
  test('states the paper and the margin', () => {
    expect(pageCss(DEFAULT_PAGE_SETUP)).toBe('@page { size: A4 portrait; margin: 20mm; }')
  })

  test('falls back to the default margin rather than emitting a bad one', () => {
    expect(pageCss({ ...DEFAULT_PAGE_SETUP, margin: 'red' })).toContain('margin: 20mm')
  })
})

describe('wrapping the body in running text', () => {
  test('leaves a plain document alone', () => {
    expect(withRunningText('<p>x</p>', DEFAULT_PAGE_SETUP, 'Notes', '2026')).toBe('<p>x</p>')
  })

  test('puts the header in a repeating table head', () => {
    const html = withRunningText(
      '<p>x</p>',
      { ...DEFAULT_PAGE_SETUP, header: '${title}' },
      'Notes',
      '2026',
    )

    expect(html).toContain('<table class="sheet">')
    expect(html).toContain('<thead><tr><td><div class="running-header">Notes</div>')
    expect(html).toContain('<tbody><tr><td>\n<p>x</p></td></tr></tbody>')
    expect(html).not.toContain('running-footer')
  })

  test('puts the footer after the table with a spacer in the foot', () => {
    const html = withRunningText(
      '<p>x</p>',
      { ...DEFAULT_PAGE_SETUP, footer: '${date}' },
      'Notes',
      '2026-09-03',
    )

    expect(html).toContain('<tfoot><tr><td></td></tr></tfoot>')
    expect(html).toContain('<div class="running-footer">2026-09-03</div>')
    expect(html).not.toContain('running-header')
  })

  test('escapes the title so it cannot become markup', () => {
    const html = withRunningText(
      '',
      { ...DEFAULT_PAGE_SETUP, header: '${title}' },
      'a <b> & "c"',
      '2026',
    )

    expect(html).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
  })
})

describe('paper in inches', () => {
  test('knows the paper sizes', () => {
    expect(paperInches(DEFAULT_PAGE_SETUP)).toEqual({
      width: 8.27,
      height: 11.69,
      margin: 0.787,
      landscape: false,
    })
    expect(paperInches({ ...DEFAULT_PAGE_SETUP, paper: 'Letter', margin: '1in' })).toMatchObject({
      width: 8.5,
      height: 11,
      margin: 1,
    })
  })

  test('converts every unit a margin can use', () => {
    expect(paperInches({ ...DEFAULT_PAGE_SETUP, margin: '2.54cm' }).margin).toBe(1)
    expect(paperInches({ ...DEFAULT_PAGE_SETUP, margin: '72pt' }).margin).toBe(1)
    expect(paperInches({ ...DEFAULT_PAGE_SETUP, margin: '48px' }).margin).toBe(0.5)
  })

  test('keeps the sheet upright and flags landscape', () => {
    const inches = paperInches({ ...DEFAULT_PAGE_SETUP, orientation: 'landscape' })

    expect(inches.landscape).toBe(true)
    expect(inches.width).toBeLessThan(inches.height)
  })

  test('falls back to the default margin when the setting is not a length', () => {
    expect(paperInches({ ...DEFAULT_PAGE_SETUP, margin: 'wide' }).margin).toBe(0.787)
  })
})
