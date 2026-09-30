import { describe, expect, test, vi } from 'vitest'
import { readCanvas } from './canvas/format'
import { scanCanvas } from './scan-canvas'
import { scanNote, scanShortcut } from './scan-note'

describe('reading a note for the index', () => {
  test('finds its headings, its blocks and its links', () => {
    const note = scanNote(
      'ideas/Plan.md',
      '# Plan\n\nSee [[Other]] and [x](../notes/Third.md). ^abc123\n\n## Later\n',
    )

    expect(note.name).toBe('Plan')
    expect(note.headings).toEqual(['Plan', 'Later'])
    expect(note.blocks).toEqual(['abc123'])
    expect(note.links.map((link) => link.target)).toEqual(['Other', '../notes/Third.md'])
  })

  /** The shape the Rust pass hands back, read by the browser build here. Every
   *  case has its twin in `front_matter_list`'s tests at the bottom of
   *  `apps/desktop/src-tauri/src/links.rs`: two languages cannot share one
   *  reader, so what keeps them from drifting is that both are asked the same
   *  questions. */
  test('reads the other names the note gives itself, whichever way they are written', () => {
    const aliases = (body: string) => scanNote('Plan.md', body).aliases

    expect(aliases('---\naliases: [Roadmap, The plan]\n---\n')).toEqual(['Roadmap', 'The plan'])
    expect(aliases('---\naliases:\n  - Roadmap\n  - The plan\n---\n')).toEqual([
      'Roadmap',
      'The plan',
    ])
    expect(aliases('---\naliases:\n- Roadmap\n---\n')).toEqual(['Roadmap'])
    expect(aliases('---\naliases: Roadmap\n---\n')).toEqual(['Roadmap'])
    expect(aliases('---\naliases: ["One", \'Two\']\n---\n')).toEqual(['One', 'Two'])
  })

  test('gives a note that names none an empty list rather than nothing at all', () => {
    expect(scanNote('Plan.md', '# Plan\n').aliases).toEqual([])
    expect(scanNote('Plan.md', '---\ntitle: Plan\n---\n').aliases).toEqual([])
    expect(scanNote('Plan.md', '---\nexport:\n  aliases: [One]\n---\n').aliases).toEqual([])
  })
})

describe('reading a canvas for the index', () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '# not a link' },
      { id: 'b', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'ideas/Plan.md' },
      {
        id: 'c',
        type: 'file',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        file: 'Notes.md',
        subpath: '#Later',
      },
      { id: 'd', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'x.md', subpath: '#^abc123' },
      { id: 'e', type: 'link', x: 0, y: 0, width: 1, height: 1, url: 'https://example.com' },
    ],
    edges: [],
  })

  test('keeps its whole name, the way a link has to write it', () => {
    expect(scanCanvas('boards/Board.canvas', canvas).name).toBe('Board.canvas')
  })

  test('reads each file node as one link out of it', () => {
    const links = scanCanvas('Board.canvas', canvas).links

    expect(links.map((link) => link.target)).toEqual(['ideas/Plan.md', 'Notes.md', 'x.md'])
    expect(links.every((link) => link.kind === 'wikilink')).toBe(true)
  })

  test('reads a subpath as the heading or the block it names', () => {
    const links = scanCanvas('Board.canvas', canvas).links

    expect(links[0]).toMatchObject({ heading: null, block: null })
    expect(links[1]).toMatchObject({ heading: 'Later', block: null })
    expect(links[2]).toMatchObject({ heading: null, block: 'abc123' })
  })

  /** Nothing points into a canvas, only at it, so there is nothing to point at
   *  inside one. */
  test('has no headings and no blocks of its own', () => {
    const read = scanCanvas('Board.canvas', canvas)

    expect(read.headings).toEqual([])
    expect(read.blocks).toEqual([])
  })

  test('is an empty reading of a file that is not a canvas at all', () => {
    const read = scanCanvas('Board.canvas', 'not json')

    expect(read.links).toEqual([])
    expect(read.path).toBe('Board.canvas')
  })

  /** JSON has no front matter, so a canvas says what it wears under the one key
   *  the spec leaves for us. Every case here has its twin in the Rust scan; see
   *  `canvas_note` in src-tauri/src/links.rs. */
  test('wears what its own file says, under the key that carries the ink', () => {
    const marked = JSON.stringify({ nodes: [], edges: [], nib: { version: 1, icon: 'rocket' } })
    expect(scanCanvas('Board.canvas', marked).icon).toBe('rocket')
  })

  test('and an emoji a vault brought in from Iconize, as written', () => {
    const marked = JSON.stringify({ nodes: [], edges: [], nib: { icon: '🚀' } })
    expect(scanCanvas('Board.canvas', marked).icon).toBe('🚀')
  })

  test('nothing where it says nothing, or says something that is not a name', () => {
    expect(scanCanvas('Board.canvas', canvas).icon).toBeNull()
    expect(scanCanvas('Board.canvas', '{"nib":{"icon":"  "}}').icon).toBeNull()
    expect(scanCanvas('Board.canvas', '{"nib":{"icon":7}}').icon).toBeNull()
    expect(scanCanvas('Board.canvas', 'not json').icon).toBeNull()
  })

  /** A canvas has no other name for itself: an alias is something a link is
   *  written with, and nothing writes `[[Board]]` for a canvas. */
  test('and never an alias', () => {
    expect(scanCanvas('Board.canvas', '{"nib":{"icon":"rocket"}}').aliases).toEqual([])
  })

  /** A plane of ten thousand strokes is megabytes of ink, and the scan of a space
   *  read all of it into strokes to find a row's icon: the chunk holding a plane of
   *  seven megabytes was a third of a second in one task. What is counted is what
   *  was handed to `JSON.parse`, which is what building the plane costs. */
  test('reads the cards and the icon of a plane without reading its ink', () => {
    const ink = Array.from({ length: 10_000 }, (_, one) => ({
      id: `s${one}`,
      tool: 'pen',
      color: 'ink',
      size: 3,
      points: Array.from({ length: 60 }, (_, at) => Math.round((one + at) * 13.7) / 10),
    }))
    const plane = JSON.stringify({
      nodes: [
        {
          id: 'a',
          type: 'file',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          file: 'Plan.md',
          subpath: '#Later',
        },
        { id: 'b', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'a card with [[words]]' },
      ],
      edges: [],
      nib: { version: 1, ink, icon: 'rocket', iconColor: 'violet' },
    })

    const parse = vi.spyOn(JSON, 'parse')
    const read = scanCanvas('Board.canvas', plane)
    const parsed = parse.mock.calls.reduce((sum, [text]) => sum + text.length, 0)
    parse.mockRestore()

    expect(parsed).toBeLessThan(plane.length / 1000)

    // And it is the reading the whole plane gives.
    const whole = readCanvas(plane)
    expect(read.icon).toBe(whole.icon)
    expect(read.iconColor).toBe(whole.iconColor)
    expect(read.links.map((link) => [link.target, link.heading])).toEqual([['Plan.md', 'Later']])
  })
})

/** A website is a shortcut file, and the one thing the file list wants off it that
 *  its name cannot give is the site's own mark. Emil, 2026-09-13: *"the website
 *  favicon should also be used in the sidebar."* The twin of `shortcut_note`'s tests
 *  in links.rs. */
describe('reading a website for the index', () => {
  const url =
    '[InternetShortcut]\nURL=https://svelte.dev/docs\nNib-Icon=https://svelte.dev/favicon.png\n'

  test('carries the favicon out of its Nib-Icon key', () => {
    const site = scanShortcut('Reading/Svelte docs.url', url)
    expect(site.name).toBe('Svelte docs.url')
    expect(site.favicon).toBe('https://svelte.dev/favicon.png')
    // And where it points, which this device's own sight of the site is kept under;
    // see `favicons` in web-tab/pages.svelte.ts.
    expect(site.address).toBe('https://svelte.dev/docs')
    // A shortcut is a name, a mark and an address, and nothing else the index reads.
    expect(site.url).toBeNull()
    expect(site.icon).toBeNull()
    expect(site.links).toEqual([])
  })

  test('and the plain globe where there is no mark yet', () => {
    const bare = scanShortcut('A.url', '[InternetShortcut]\nURL=https://a.example/\n')
    expect(bare.favicon).toBeNull()
    // A .webloc carries no such key either.
    expect(scanShortcut('A.webloc', '<plist><dict></dict></plist>').favicon).toBeNull()
  })

  test('and where a .webloc points, and nothing for a note or a canvas', () => {
    const webloc = '<plist><dict><key>URL</key><string>https://a.example/?x=1&amp;y=2</string>'
    expect(scanShortcut('A.webloc', `${webloc}</dict></plist>`).address).toBe(
      'https://a.example/?x=1&y=2',
    )
    expect(scanNote('Plan.md', '# Plan').address).toBeNull()
    expect(scanCanvas('Board.canvas', '{}').address).toBeNull()
  })
})
