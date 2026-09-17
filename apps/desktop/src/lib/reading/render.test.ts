import { describe, expect, test, vi } from 'vitest'

/** The space around the note, stood in for: what the reading view has to get
 *  right is that it asks, and what it does with the answers. */
const NOTES = [
  { path: 'Plan.md', name: 'Plan', headings: ['Why it works'], blocks: [], aliases: [] },
  { path: 'ideas/Later.md', name: 'Later', headings: [], blocks: [], aliases: [] },
]

const bodies: Record<string, string> = {
  'Plan.md': '# Plan\n\nThe plan itself.\n\n## Why it works\n\nBecause.\n',
}

const asked: { embeds: string[]; from: (string | null)[] } = { embeds: [], from: [] }

/** The index stands in for the whole space, and `targetOf` is the one thing the
 *  reading view asks it: which note a link means. Resolved here the way the real
 *  one resolves it - the end of a path, folded - because what this file tests is
 *  that the view asks and what it does with the answer, not the resolver, which is
 *  tested in link-index.test.ts. */
vi.mock('../link-index.svelte', () => ({
  links: {
    targetOf: (from: string | null, link: { target: string }) => {
      asked.from.push(from)
      const wanted = link.target.toLowerCase().replace(/\.md$/, '')
      const found = NOTES.find((note) => {
        const path = note.path.toLowerCase().replace(/\.md$/, '')
        return path === wanted || path.endsWith(`/${wanted}`)
      })

      return found?.path ?? null
    },
    embedSource: (target: string) => {
      asked.embeds.push(target)
      return Promise.resolve(bodies[`${target}.md`] ?? null)
    },
  },
}))

/** Where a picture ends up is images.ts's business and is tested there; here it
 *  only matters that the reading view runs every `src` through it. */
vi.mock('../note-images', () => ({
  notePicture: (src: string) => `asset://${src}`,
}))

const { readingHtml } = await import('./render')

/** The reading view asks for the exporter the first time it renders a note: the
 *  diagram drawers, the syntax parsers, KaTeX, most of what the app can load.
 *  Loaded here rather than by the first test, where it was three seconds on an
 *  idle machine, past a test's five on a busy one, and every test waiting on the
 *  same import timed out with it. See docs/conventions.md. */
await import('../export')

const note = (text: string) => ({ text, path: '/space/Notes/Today.md' })

describe('the space a note is read in', () => {
  test('is what a wikilink is resolved against', async () => {
    const html = await readingHtml(note('Read [[Plan]] first.\n'), 'light', true)

    expect(html).toContain('<a class="wikilink" href="Plan.md">Plan</a>')
    expect(asked.from).toContain('/space/Notes/Today.md')
  })

  test('carries the heading a link names, as the anchor on the page', async () => {
    const html = await readingHtml(note('See [[Plan#Why it works]].\n'), 'light', true)

    expect(html).toContain('href="Plan.md#why-it-works"')
  })

  test('finds a note by the last part of the name it was given', async () => {
    const html = await readingHtml(note('And [[ideas/Later|later]].\n'), 'light', true)

    expect(html).toContain('<a class="wikilink" href="ideas/Later.md">later</a>')
  })

  test('leaves a link nothing answers to as the words it showed', async () => {
    const html = await readingHtml(note('A [[Nowhere]] link.\n'), 'light', true)

    expect(html).toContain('A Nowhere link.')
    expect(html).not.toContain('<a class="wikilink"')
  })

  test('points a link into this very note at its own heading', async () => {
    const html = await readingHtml(note('# One\n\nBack to [[#One]].\n'), 'light', true)

    // Shown as it was written, which is how the editor shows it too.
    expect(html).toContain('<a class="wikilink" href="#one">#One</a>')
  })

  test('is what an embed reads the note it names out of', async () => {
    const html = await readingHtml(note('Before\n\n![[Plan]]\n\nAfter\n'), 'light', true)

    expect(asked.embeds).toContain('Plan')
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('The plan itself.')
    expect(html).toContain('<figcaption>Plan</figcaption>')
  })

  test('embeds one section when the link names one', async () => {
    const html = await readingHtml(note('![[Plan#Why it works]]\n'), 'light', true)

    expect(html).toContain('Because.')
    expect(html).not.toContain('The plan itself.')
  })

  test('leaves an embed of a note it has not got as a link', async () => {
    const html = await readingHtml(note('![[Missing]]\n'), 'light', true)

    expect(html).not.toContain('<figure class="embed">')
  })
})

describe('the page a note is read on', () => {
  test('gives every heading the id the export gives it', async () => {
    const html = await readingHtml(note('# One\n\n## Two words\n'), 'light', true)

    expect(html).toContain('<h1 id="one">One</h1>')
    expect(html).toContain('<h2 id="two-words">Two words</h2>')
  })

  test('turns a `[toc]` line into the contents', async () => {
    const html = await readingHtml(note('[toc]\n\n# One\n\n## Two\n'), 'light', true)

    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<a href="#one">One</a>')
  })

  test('gathers the footnotes at the end', async () => {
    const html = await readingHtml(note('Text[^1].\n\n[^1]: The note.\n'), 'light', true)

    expect(html).toContain('<sup class="footnote-ref" id="fnref-1">')
    expect(html).toContain('<section class="footnotes">')
  })

  test('shows a task box, and it is inert', async () => {
    const html = await readingHtml(note('- [ ] one\n- [x] two\n'), 'light', true)

    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('class="task-list-item is-done"')
    // Every one of them: a reading view is not a place where a note is changed.
    expect(html.match(/<input/g)).toHaveLength(2)
    expect(html.match(/disabled/g)).toHaveLength(2)
  })

  test('sets its maths', async () => {
    const html = await readingHtml(note('Inline $a^2$ and\n\n$$\nb^2\n$$\n'), 'light', true)

    expect(html).toContain('<span class="math-inline"')
    expect(html).toContain('<div class="math-block"')
    expect(html).toContain('katex')
  })

  test('leaves no front matter and no block names on the page', async () => {
    const html = await readingHtml(note('---\ntitle: x\n---\n\nA line. ^abc123\n'), 'light', true)

    expect(html).not.toContain('title: x')
    expect(html).not.toContain('^abc123')
    expect(html).toContain('A line.')
  })

  test('sends every picture through the resolver', async () => {
    const html = await readingHtml(note('![a](pictures/one.png)\n'), 'light', true)

    expect(html).toContain('src="asset://pictures/one.png"')
  })

  test('leaves a picture from the web where it is', async () => {
    const html = await readingHtml(note('![a](https://example.com/one.png)\n'), 'light', true)

    // The resolver is still asked; it is the one that knows a remote path.
    expect(html).toContain('asset://https://example.com/one.png')
  })

  test('renders a definition list, an abbreviation and a callout', async () => {
    const html = await readingHtml(
      note('Term\n: Meaning\n\n*[HTML]: HyperText\n\nHTML here.\n\n> [!note]\n> Mind this.\n'),
      'light',
      true,
    )

    expect(html).toContain('<dl>')
    expect(html).toContain('<abbr title="HyperText">HTML</abbr>')
    expect(html).toContain('<div class="callout callout-note" data-callout="note">')
  })

  test('says how long it took, under a name a profiler can read', async () => {
    performance.clearMeasures('nib:reading')
    await readingHtml(note('# One\n\nWords.\n'), 'light', true)

    expect(performance.getEntriesByName('nib:reading')).toHaveLength(1)
  })
})

/** Whose note it is decides whether the HTML in it is markup or is words; the
 *  rule is trust.ts and the reading view is handed the answer. */
describe('the HTML in a note', () => {
  const HOSTILE = '<img src=x onerror="alert(1)">\n\n<u>underlined</u>\n'

  test('runs, for a note the reader wrote', async () => {
    const html = await readingHtml(note(HOSTILE), 'light', true)

    expect(html).toContain('<img src=x onerror="alert(1)">')
    expect(html).toContain('<u>underlined</u>')
  })

  test('is the characters it is made of, for a note from anywhere else', async () => {
    const html = await readingHtml(note(HOSTILE), 'light', false)

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<u>underlined</u>')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;u&gt;underlined&lt;/u&gt;')
  })

  test('is still markdown, whoever wrote it', async () => {
    const html = await readingHtml(note('# A heading\n\n- one\n- two\n'), 'light', false)

    expect(html).toContain('<h1')
    expect(html).toContain('<li>')
  })

  /** An embed is another note pulled into this one, and it is rendered with the
   *  outer note's options; see `inside` in @nib/markdown. */
  test('is escaped inside an embedded note as well', async () => {
    bodies['Plan.md'] = '# Plan\n\n<script>alert(1)</script>\n'
    const html = await readingHtml(note('![[Plan]]\n'), 'light', false)
    bodies['Plan.md'] = '# Plan\n\nThe plan itself.\n\n## Why it works\n\nBecause.\n'

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
