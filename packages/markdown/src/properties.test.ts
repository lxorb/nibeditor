import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'
import { PROPERTIES_MODES, propertiesMode, propertiesTable, readProperties } from './properties'

const said = (source: string) =>
  readProperties(source)?.map((one) => ({
    key: one.key,
    kind: one.kind,
    value: one.value,
    items: one.items,
  }))

describe('a note read as rows', () => {
  test('the shapes a note actually holds', () => {
    expect(
      said(
        [
          '---',
          'title: A plan',
          'count: 12',
          'weight: 1.5',
          'date: 2025-09-08',
          'done: true',
          'draft: false',
          'tags: [one, two]',
          'aliases:',
          '  - First',
          '  - Second',
          'empty:',
          '---',
          '',
          'Words.',
        ].join('\n'),
      ),
    ).toEqual([
      { key: 'title', kind: 'text', value: 'A plan', items: [] },
      { key: 'count', kind: 'number', value: '12', items: [] },
      { key: 'weight', kind: 'number', value: '1.5', items: [] },
      { key: 'date', kind: 'date', value: '2025-09-08', items: [] },
      { key: 'done', kind: 'checkbox', value: 'true', items: [] },
      { key: 'draft', kind: 'checkbox', value: 'false', items: [] },
      { key: 'tags', kind: 'list', value: '', items: ['one', 'two'] },
      { key: 'aliases', kind: 'list', value: '', items: ['First', 'Second'] },
      { key: 'empty', kind: 'text', value: '', items: [] },
    ])
  })

  test('a date with a time is still a date', () => {
    expect(said('---\nwhen: 2025-09-08T14:30\n---\n')?.[0]?.kind).toBe('date')
    expect(said('---\nwhen: 2025-09-08 14:30:00\n---\n')?.[0]?.kind).toBe('date')
  })

  test('quotes come off, whichever kind they are', () => {
    expect(said('---\ntitle: "A plan"\n---\n')?.[0]?.value).toBe('A plan')
    expect(said('---\ntags: [\'one\', "two"]\n---\n')?.[0]?.items).toEqual(['one', 'two'])
  })

  test('an empty list is a list', () => {
    expect(said('---\ntags: []\n---\n')?.[0]).toEqual({
      key: 'tags',
      kind: 'list',
      value: '',
      items: [],
    })
  })

  test('yes and no are words, not a checkbox', () => {
    // YAML 1.1 reads them as booleans. A `status: no` that came back as a
    // cleared checkbox would be a note lied to about itself.
    expect(said('---\nstatus: no\n---\n')?.[0]?.kind).toBe('text')
  })

  test('a note with no block has no rows', () => {
    expect(readProperties('# Just a note\n')).toBe(null)
    expect(readProperties('')).toBe(null)
  })

  test('and an empty block reads as no rows rather than as unreadable', () => {
    expect(readProperties('---\n---\n')).toEqual([])
  })

  test('a list at the key’s own margin, which is YAML too', () => {
    // `frontMatterList` has always read this shape, so the reading view drawing
    // the source instead of rows for the same block was the two disagreeing.
    expect(said('---\naliases:\n- One\n- Two\n---\n\nWords.\n')).toEqual([
      { key: 'aliases', kind: 'list', value: '', items: ['One', 'Two'] },
    ])
  })
})

describe('a block this cannot draw', () => {
  test('is left as source, whole', () => {
    for (const block of [
      // A line that is not a key at all.
      '---\njust some words\n---\n',
      // A comment somebody is keeping notes in.
      '---\n# why this is here\ntitle: A plan\n---\n',
      // A list under a key that also has a value.
      '---\ntags: one\n  - two\n---\n',
      // Items and pairs under one key, which is not something YAML means.
      '---\nexport:\n  - one\n  paper: A4\n---\n',
      // Something indented that is neither.
      '---\nexport:\n  ???\n---\n',
    ]) {
      expect(readProperties(block), block).toBe(null)
    }
  })

  test('a block longer than any note’s metadata is source, whichever rows it holds', () => {
    // The ceiling used to sit after the two shapes that read their value off the
    // key's own line, so a thousand of those drew a thousand rows.
    const many = (line: (at: number) => string) =>
      ['---', ...Array.from({ length: 200 }, (_, at) => line(at)), '---', ''].join('\n')

    expect(readProperties(many((at) => `k${at}: value`))).toBe(null)
    expect(readProperties(many((at) => `k${at}: [one, two]`))).toBe(null)
    expect(readProperties(many((at) => `k${at}:`))).toBe(null)
  })

  test('rather than a table with a row missing', () => {
    // The whole point: half a table is a table that lies about the file.
    expect(readProperties('---\ntitle: A plan\nweird:\n  ~ what\n---\n')).toBe(null)
  })

  test('but nib’s own page setup is a shape it knows, so those notes keep rows', () => {
    // `export:` with a paper size under it is what page-setup.ts reads. Without
    // this every note that prints on anything but the default went back to YAML.
    expect(said('---\ntitle: A plan\nexport:\n  paper: A4\n  margin: 15mm\n---\n')).toEqual([
      { key: 'title', kind: 'text', value: 'A plan', items: [] },
      { key: 'export', kind: 'map', value: '', items: ['paper: A4', 'margin: 15mm'] },
    ])
  })
})

describe('where each row came from', () => {
  test('is the line the key is written on', () => {
    const source = '---\ntitle: A plan\ntags: [one]\n---\n'
    const rows = readProperties(source) ?? []

    expect(source.slice(rows[0]!.from, rows[0]!.to)).toBe('title: A plan')
    expect(source.slice(rows[1]!.from, rows[1]!.to)).toBe('tags: [one]')
  })

  test('and a list written under its key reaches to its last item', () => {
    const source = '---\naliases:\n  - One\n  - Two\n---\n'
    const rows = readProperties(source) ?? []

    expect(source.slice(rows[0]!.from, rows[0]!.to)).toBe('aliases:\n  - One\n  - Two')
  })
})

describe('the rows as markup', () => {
  const table = (source: string) => propertiesTable(readProperties(source) ?? [])

  test('one row per key, wearing the row every list in the app wears', () => {
    const html = table('---\ntitle: A plan\ntags: [one, two]\n---\n')
    expect(html.match(/class="property nib-row is-short"/g)).toHaveLength(2)
    expect(html).toContain('>title<')
    expect(html).toContain('class="property-chip">one<')
    expect(html).toContain('class="property-chip">two<')
  })

  test('a checkbox says which way it is', () => {
    expect(table('---\ndone: true\n---\n')).toContain('property-check is-on')
    expect(table('---\ndone: false\n---\n')).not.toContain('is-on')
  })

  test('every row carries the line it was drawn from', () => {
    expect(table('---\ntitle: A plan\n---\n')).toContain('data-from="4" data-to="17"')
  })

  test('nothing a note wrote can end an attribute or open a tag', () => {
    const html = table('---\ntitle: "a\\"><script>alert(1)</script>"\n---\n')
    expect(html).not.toContain('<script')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  test('and a hostile key cannot either', () => {
    expect(table('---\ntags: ["<b>bold</b>"]\n---\n')).not.toContain('<b>')
  })
})

/** The three answers a surface gives about a note's front matter, which is one
 *  setting read by the editor and by the reading view. */
describe('the three answers', () => {
  const NOTE = '---\ntitle: A note\ntags: [one]\n---\n\n# Head\n'

  test('are the words every reader of the setting knows', () => {
    expect(PROPERTIES_MODES).toEqual(['properties', 'source', 'hidden'])
  })

  test('read a saved or shared answer, and the rows for anything else', () => {
    expect(propertiesMode('source')).toBe('source')
    expect(propertiesMode('hidden')).toBe('hidden')
    for (const said of [undefined, null, '', 'rows', true]) {
      expect(propertiesMode(said), String(said)).toBe('properties')
    }
  })

  test('draw the rows, the block as typed, or neither', () => {
    expect(renderMarkdown(NOTE, { properties: 'properties' })).toContain('class="property ')
    expect(renderMarkdown(NOTE, { properties: 'source' })).toContain(
      '<pre class="properties-source">',
    )
    const nothing = renderMarkdown(NOTE, { properties: 'hidden' })
    expect(nothing).not.toContain('property')
    expect(nothing).not.toContain('properties-source')
  })

  test('draw nothing at all where the caller did not ask', () => {
    expect(renderMarkdown(NOTE)).not.toContain('property')
  })

  test('fall back to the source for a block the rows cannot read', () => {
    // Which is the answer the editor already gives, and the reason the reading view
    // has a source of its own to fall back to now rather than nothing.
    const query = '---\ntitle: A note\n# a comment\n---\n\n# Head\n'
    expect(readProperties(query)).toBeNull()
    expect(renderMarkdown(query, { properties: 'properties' })).toContain(
      '<pre class="properties-source">',
    )
  })

  test('escape the block, because a note may hold anything', () => {
    const hostile = '---\ntitle: <script>bad()</script>\n---\n\n# Head\n'
    expect(renderMarkdown(hostile, { properties: 'source' })).not.toContain('<script>')
  })

  test('leave the block out of the note either way', () => {
    for (const mode of PROPERTIES_MODES) {
      expect(renderMarkdown(NOTE, { properties: mode }), mode).toContain('<h1>Head</h1>')
    }
  })
})
