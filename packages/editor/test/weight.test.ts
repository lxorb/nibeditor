import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the editor loads in order to show a note at all.
 *
 *  `isDeck` is asked about every note a pane opens - it decides whether the deck
 *  affordances are there - and it answers by scanning lines for rules. It used to
 *  be reached through a module that imported the markdown package's entry point
 *  for its lexer, so opening any note pulled in the renderer, KaTeX, KaTeX's
 *  chemistry pack and the emoji table: about a megabyte of bundle, none of which a
 *  line scan uses. Checked here rather than remembered, because nothing about that
 *  import looked expensive from the editor's side. */

const MARKDOWN = fileURLToPath(new URL('../../markdown/src/', import.meta.url))

/** The door the HTML grammar comes through, which is the other thing showing a note
 *  used to load: a raw block or an inline tag in it is coloured by
 *  `@codemirror/lang-html`, and `@codemirror/lang-markdown` imports that outright - with
 *  the CSS and JavaScript grammars nested inside it, and the LR parser runtime under all
 *  three. What that package is handed instead is this, said once in the root manifest;
 *  see packages/lang-html for the whole of the reasoning, and the last two tests in
 *  apps/desktop/test/weight.test.ts for the edge itself. */
const DOOR = fileURLToPath(new URL('../../lang-html/src/index.ts', import.meta.url))

/** Every module reached from a file, and every package any of them asks for.
 *
 *  Read off the source rather than out of a bundle, so the answer is the same
 *  whichever bundler the app is built with and needs no build to ask. */
function graphOf(entry: string): { files: string[]; packages: Set<string> } {
  const files: string[] = []
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (file === undefined || files.includes(file)) continue
    files.push(file)

    const source = readFileSync(file, 'utf8')
    for (const found of source.matchAll(/(?:from|import)\s*'([^']+)'/g)) {
      const asked = found[1] ?? ''
      if (asked.startsWith('.')) queue.push(resolve(dirname(file), `${asked}.ts`))
      else packages.add(asked)
    }
  }

  return { files, packages }
}

const names = (files: readonly string[]) =>
  files.map((one) => one.split(/[\\/]/).pop() ?? one).sort()

describe('what showing a note loads', () => {
  test('the deck reader is five modules and the markdown lexer', () => {
    const { files, packages } = graphOf(resolve(MARKDOWN, 'slides.ts'))

    expect([...packages].sort()).toEqual(['marked'])
    expect(names(files)).toEqual([
      'blocks.ts',
      'fences.ts',
      'slide-breaks.ts',
      'slides.ts',
      'starts.ts',
    ])
  })

  /** And the question every note is asked needs none of it: whether a note is a deck
   *  is a scan of its lines, and the lexer is for rendering the slides, which only a
   *  deck being presented or exported does. */
  test('while whether a note is a deck is a line scan and no lexer', () => {
    const { files, packages } = graphOf(resolve(MARKDOWN, 'slide-breaks.ts'))

    expect([...packages]).toEqual([])
    expect(names(files)).toEqual(['fences.ts', 'slide-breaks.ts'])
  })

  test('and no formula engine, no chemistry pack and no emoji table', () => {
    const { packages } = graphOf(resolve(MARKDOWN, 'slides.ts'))

    for (const heavy of ['katex', 'katex/contrib/mhchem', 'node-emoji']) {
      expect(packages, heavy).not.toContain(heavy)
    }
  })

  /** And nor does the renderer, which is the change batch 109 made: both are asked
   *  for when a note turns out to want one, out of the one module that holds them.
   *
   *  The renderer used to import them outright, which put KaTeX, its chemistry pack
   *  and the emoji table - three quarters of a megabyte - in front of the app's
   *  first paint, for the sake of the notes that have a formula or a `:shortcode:`
   *  in them. Most have neither, and a window that is not open yet has neither. */
  test('and the renderer asks for them rather than importing them', () => {
    const { packages, files } = graphOf(resolve(MARKDOWN, 'index.ts'))

    for (const heavy of ['katex', 'katex/contrib/mhchem', 'node-emoji']) {
      expect(packages, heavy).not.toContain(heavy)
    }
    expect(names(files)).toContain('engines.ts')
  })

  test('and the one module that does import them is not reached from either', () => {
    // `maths.ts` is KaTeX with the chemistry pack applied and `eager.ts` is both
    // engines handed over outright, which is what the Worker that publishes a note
    // imports. Either in the graph of the renderer or of the deck reader would put
    // the libraries back in front of the first paint.
    for (const entry of ['index.ts', 'slides.ts']) {
      const { files } = graphOf(resolve(MARKDOWN, entry))

      expect(names(files), entry).not.toContain('maths.ts')
      expect(names(files), entry).not.toContain('eager.ts')
    }
  })

  /** And the HTML grammar is asked for rather than imported: one module, whose only
   *  mention of the grammar is inside a `import(...)`. A static import here would put
   *  five packages back in front of the first paint, for the notes that have a tag in
   *  them - which is exactly what it is here to stop. */
  test('and the HTML grammar is a door, not an import', () => {
    const { files, packages } = graphOf(DOOR)

    expect(names(files)).toEqual(['index.ts'])
    expect(packages).not.toContain('@codemirror/lang-html')
    expect([...packages].sort()).toEqual([
      '@codemirror/autocomplete',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/common',
    ])
  })

  test('while the eager pair still holds both, for the Worker that has no wait', () => {
    const { packages } = graphOf(resolve(MARKDOWN, 'eager.ts'))

    expect(packages).toContain('katex')
    expect(packages).toContain('katex/contrib/mhchem')
    expect(packages).toContain('node-emoji')
  })
})
