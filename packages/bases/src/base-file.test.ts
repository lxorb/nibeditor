import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readBase, writeBase } from './base-file'

const here = join(import.meta.dirname, 'fixtures')
const fixture = (name: string) => readFileSync(join(here, name), 'utf8')

/** Bases Obsidian itself wrote (kepano/kepano-obsidian, MIT, see fixtures/kepano/LICENSE),
 *  the help page's example, and the design's example with nib's key. */
const FILES = [
  ...readdirSync(join(here, 'kepano'))
    .filter((name) => name.endsWith('.base'))
    .map((name) => `kepano/${name}`),
  'obsidian-help.base',
  'nib-example.base',
]

describe('a base read and written unchanged', () => {
  test.each(FILES)('%s comes back byte for byte', (name) => {
    const source = fixture(name)
    expect(writeBase(readBase(source), source)).toBe(source)
  })

  test.each(FILES)('%s comes back the same through a copy of its base', (name) => {
    const source = fixture(name)
    const copy = structuredClone(readBase(source))
    expect(writeBase(copy, source)).toBe(source)
  })
})

describe('reading', () => {
  test("the help page's example, every part", () => {
    const base = readBase(fixture('obsidian-help.base'))
    expect(base.filters).toEqual({
      or: [
        'file.hasTag("tag")',
        { and: ['file.hasTag("book")', 'file.hasLink("Textbook")'] },
        { not: ['file.hasTag("book")', 'file.inFolder("Required Reading")'] },
      ],
    })
    expect(base.formulas).toEqual({
      formatted_price: 'if(price, price.toFixed(2) + " dollars")',
      ppu: '(price / age).toFixed(2)',
    })
    expect(base.properties['formula.formatted_price']?.displayName).toBe('Price')
    expect(base.summaries).toEqual({ customAverage: 'values.mean().round(3)' })
    expect(base.views[0]).toMatchObject({
      type: 'table',
      name: 'My table',
      limit: 10,
      groupBy: { property: 'note.age', direction: 'DESC' },
      order: ['file.name', 'file.ext', 'note.age', 'formula.ppu', 'formula.formatted_price'],
      summaries: { 'formula.ppu': 'Average' },
    })
  })

  test("a layout's own keys are kept as options", () => {
    const base = readBase(fixture('kepano/Map.base'))
    expect(base.views[1]?.options).toMatchObject({
      coordinates: 'note.coordinates',
      defaultZoom: 10.6,
      markerIcon: 'formula.Icon',
      columnSize: { 'file.name': 162 },
    })
    expect(base.views[0]?.sort).toEqual([
      { property: 'last', direction: 'DESC' },
      { property: 'type', direction: 'ASC' },
      { property: 'loc', direction: 'ASC' },
    ])
  })

  test("nib's key, at the top and in a view", () => {
    const base = readBase(fixture('nib-example.base'))
    expect(base.nib.template).toBe('[[Templates/Bug]]')
    expect(base.nib.id).toEqual({ property: 'id', prefix: 'BUG' })
    expect(base.nib.properties.status?.options).toEqual([
      { value: 'To do', group: 'todo', tone: 'neutral' },
      { value: 'Doing', group: 'doing', tone: 'info' },
      { value: 'Review', group: 'doing', tone: 'warning' },
      { value: 'Done', group: 'done', tone: 'success' },
    ])
    expect(base.views[0]?.nib).toMatchObject({
      subGroupBy: { property: 'note.assignee', direction: 'ASC' },
      order: { 'To do': ['Bugs/Sync loses a rename.md', 'Bugs/Glass on Linux.md'] },
    })
    expect(base.views[2]?.nib.date).toBe('note.due')
    expect(base.views[3]?.nib.rows).toBe('tasks')
    expect(base.views[3]?.filters).toEqual({ and: ['!task.done'] })
  })

  test('an empty file is an empty base, and a broken one an error', () => {
    expect(readBase('').views).toEqual([])
    expect(() => readBase('views: [\n')).toThrow()
  })

  test('keys nobody knows are kept, at every level', () => {
    const base = readBase(
      'plugin: 1\nviews:\n  - type: chart\n    name: C\n    nib:\n      bars: 3\nnib:\n  later: true\n',
    )
    expect(base.kept).toEqual({ plugin: 1 })
    expect(base.views[0]?.nib.kept).toEqual({ bars: 3 })
    expect(base.nib.kept).toEqual({ later: true })
  })
})

describe('writing a change', () => {
  test('touches only the lines that change', () => {
    const source = fixture('kepano/Books.base')
    const base = readBase(source)
    const first = base.views[0]
    if (!first) throw new Error('no view')
    first.limit = 5
    const written = writeBase(base, source)
    const before = source.split('\n')
    const after = written.split('\n')
    expect(after.length).toBe(before.length + 1)
    expect(after.filter((line) => !before.includes(line))).toEqual(['    limit: 5'])
  })

  test('a new view is added at the end and the rest stays as written', () => {
    const source = fixture('kepano/Map.base')
    const base = readBase(source)
    base.views.push({
      type: 'calendar',
      name: 'Visits',
      order: ['file.name'],
      sort: [],
      summaries: {},
      nib: { date: 'note.last', kept: {} },
      options: {},
    })
    const written = writeBase(base, source)
    expect(written.startsWith(source.trimEnd())).toBe(true)
    expect(written.slice(source.trimEnd().length)).toBe(
      '\n  - type: calendar\n    name: Visits\n    order:\n      - file.name\n    nib:\n      date: note.last\n',
    )
    expect(readBase(written).views.at(-1)?.nib.date).toBe('note.last')
  })

  test('a quoted filter keeps its quotes when another one changes', () => {
    const source = fixture('kepano/Books.base')
    const base = readBase(source)
    base.filters = {
      and: ['categories.contains(link("Books"))', '!file.name.contains("Templates")'],
    }
    const written = writeBase(base, source)
    expect(written).toContain(`    - '!file.name.contains("Templates")'`)
    expect(written).toContain('    - categories.contains(link("Books"))\n')
  })

  test('a removed view goes, and its neighbours stay', () => {
    const source = fixture('kepano/Books.base')
    const base = readBase(source)
    base.views.splice(1, 1)
    const written = writeBase(base, source)
    expect(written).not.toContain('Top rated')
    expect(readBase(written).views.map((view) => view.name)).toEqual(['Books', 'Author', 'Genre'])
  })

  test("nib's key is written where Obsidian leaves it alone", () => {
    const base = readBase('views:\n  - type: table\n    name: All\n')
    base.nib.template = '[[Templates/Bug]]'
    const first = base.views[0]
    if (!first) throw new Error('no view')
    first.nib.rows = 'tasks'
    first.nib.showCompleted = true
    expect(writeBase(base, 'views:\n  - type: table\n    name: All\n')).toBe(
      [
        'views:',
        '  - type: table',
        '    name: All',
        '    nib:',
        '      rows: tasks',
        '      showCompleted: true',
        'nib:',
        "  template: '[[Templates/Bug]]'",
        '',
      ].join('\n'),
    )
  })

  test('a new file from nothing', () => {
    const base = readBase('')
    base.filters = { and: ['file.inFolder("Bugs")'] }
    base.views.push({
      type: 'table',
      name: 'All',
      order: [],
      sort: [{ property: 'file.name', direction: 'ASC' }],
      summaries: {},
      nib: { kept: {} },
      options: {},
    })
    const written = writeBase(base)
    expect(written).toBe(
      [
        'filters:',
        '  and:',
        '    - file.inFolder("Bugs")',
        'views:',
        '  - type: table',
        '    name: All',
        '    sort:',
        '      - property: file.name',
        '        direction: ASC',
        '',
      ].join('\n'),
    )
    expect(readBase(written)).toEqual(base)
  })

  test('comments in the file survive a change', () => {
    const source = '# my bugs\nviews:\n  - type: table # the main one\n    name: All\n'
    const base = readBase(source)
    const first = base.views[0]
    if (!first) throw new Error('no view')
    first.name = 'Everything'
    expect(writeBase(base, source)).toBe(
      '# my bugs\nviews:\n  - type: table # the main one\n    name: Everything\n',
    )
  })
})
