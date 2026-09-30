import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Every string a person can read has to come from `t()`, or the app is only
 *  translated where somebody remembered to translate it. This walks the source
 *  and fails on any that does not. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Folders the walk never goes into.
 *
 *  Build output above all, which is not source, and which need not hold still
 *  while this runs: a `pnpm build` in the same checkout rewrites `dist`, and
 *  `pnpm build:even` rewrites `dist-even`, so a walk that went in could ask about
 *  a file that had been replaced between the listing and the question, and fall
 *  over on a name that was true a moment ago. The rest is generated, vendored, or
 *  the dictionaries themselves, which are nothing but the words this looks for. */
const SKIP = /^(?:node_modules|target|coverage|gen|locales)$|^\.|^dist/

/** Whether the walk goes into a folder of this name. Its own function so the
 *  rule can be asked about rather than inferred from a walk. */
function skipped(name: string): boolean {
  return SKIP.test(name)
}

/** Attributes a screen reader or a tooltip shows. */
const SPOKEN = ['title', 'aria-label', 'placeholder', 'alt']

/** Dashes and the multiplication sign, spelled by code point so this file does
 *  not trip the check that forbids an em dash in the source. */
const MARKS = [0x2014, 0x2013, 0x00d7, 0x00b7].map((one) => String.fromCharCode(one)).join('')

/** Text that is not prose: shortcuts, examples, technical values, and marks. */
const EXEMPT = [
  new RegExp(`^[\\s\\d.,:;!?/|<>${MARKS}-]*$`), // punctuation and numbers only
  /^(Ctrl|Alt|Shift|Cmd|Meta|F\d)\b/, // keyboard hints
  /^[a-z0-9-]+$/, // identifiers and css-ish values
  /^\{/, // an expression, already dynamic
  /@example\.com$/, // sample addresses
  /^notes\.example\.com$/,
  /^your-name$/,
  // An example of an address somebody pastes, which is a URL rather than prose.
  /^https:\/\//,
  /^example\.com$/,
  /^\.?nibeditor\.com$/,
  /^(B|I|S|M|H|<>|#|"|×)$/, // the format bar's single-glyph labels
  /^(A3|A4|A5|Letter|Legal|PDF|HTML|MCP|LLM|CSS|DNS|JSON)$/,
  // Product and file-format names, which read the same in every language.
  /^(Word|OpenOffice|RTF|ePub|LaTeX|MediaWiki|reStructuredText|Textile|OPML)$/,
  /^(Markdown|TextBundle|JPG|PNG|SVG)$/,
  /^(Claude|Claude Code|ChatGPT|Codex|OAuth)$/,
]

const exempt = (text: string) => EXEMPT.some((pattern) => pattern.test(text.trim()))

/** Walked once: every test below reads the same list, and walking the tree per
 *  test would be the slowest thing in the file. */
const files = sources(ROOT)

/** Every source file under `dir`, build output and the generated left out.
 *
 *  The listing says what each entry is, so nothing is asked about twice: one
 *  call per folder rather than a call per folder and a question per name, and no
 *  window between the two for a file to go out of. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name
    if (entry.isDirectory()) {
      if (!skipped(name)) sources(join(dir, name), found)
      continue
    }

    if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) found.push(join(dir, name))
  }

  return found
}

/** A `.svelte` file with its `<script>` and `<style>` blocks blanked out, so
 *  only what the reader sees is left. */
function template(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

function relative(path: string): string {
  return path.slice(ROOT.length).replace(/\\/g, '/')
}

interface Finding {
  where: string
  text: string
}

/** Words sitting straight in the markup, outside any expression. */
function loosePhrases(path: string, source: string): Finding[] {
  const found: Finding[] = []
  const body = template(source)

  for (const [, phrase = ''] of body.matchAll(/>([^<>{}]+)</g)) {
    const text = phrase.trim()
    // Needs at least one letter and one word to be prose worth translating.
    if (!/[A-Za-z]/.test(text) || exempt(text)) continue

    found.push({ where: relative(path), text })
  }

  return found
}

/** Attributes a person reads, given a bare string instead of `t(...)`. */
function looseAttributes(path: string, source: string): Finding[] {
  const found: Finding[] = []
  const body = template(source)

  for (const name of SPOKEN) {
    for (const [, written = ''] of body.matchAll(new RegExp(`\\b${name}="([^"{}]+)"`, 'g'))) {
      const text = written.trim()
      if (!/[A-Za-z]/.test(text) || exempt(text)) continue

      found.push({ where: `${relative(path)} (${name})`, text })
    }
  }

  return found
}

/** Menu and command labels, which are built in TypeScript rather than markup. */
function looseLabels(path: string, source: string): Finding[] {
  const found: Finding[] = []

  for (const [, , written = ''] of source.matchAll(/\blabel:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    const text = written.trim()
    if (!/[A-Za-z]/.test(text) || exempt(text)) continue

    found.push({ where: `${relative(path)} (label)`, text })
  }

  return found
}

describe('the walk', () => {
  test('never goes into build output', () => {
    for (const name of ['dist', 'dist-even', 'dist-anything', 'node_modules', 'target']) {
      expect(skipped(name), name).toBe(true)
    }

    // Asked of the path below ROOT, not the whole of it: a checkout that sits in a
    // folder called `dist-something` of its own is not build output.
    expect(files.some((path) => /(?:^|\/)dist/.test(relative(path)))).toBe(false)
  })

  test('goes into the folders the source is actually in', () => {
    for (const name of ['src', 'lib', 'test', 'export', 'even']) {
      expect(skipped(name), name).toBe(false)
    }

    expect(files.some((path) => path.endsWith('.svelte'))).toBe(true)
    // Below ROOT for the same reason: a checkout that sits under a `src/lib` of its
    // own would find one in every path, whatever the walk had left out.
    expect(files.some((path) => /(?:^|\/)src\/lib\//.test(relative(path)))).toBe(true)
  })
})

describe('everything the reader sees is translated', () => {
  test('no loose phrases in the markup', () => {
    const found = files
      .filter((p) => p.endsWith('.svelte'))
      .flatMap((p) => loosePhrases(p, readFileSync(p, 'utf8')))
    expect(found).toEqual([])
  })

  test('no loose titles, labels or placeholders', () => {
    const found = files
      .filter((p) => p.endsWith('.svelte'))
      .flatMap((p) => looseAttributes(p, readFileSync(p, 'utf8')))

    expect(found).toEqual([])
  })

  test('no loose menu or command labels', () => {
    const found = files.flatMap((p) => looseLabels(p, readFileSync(p, 'utf8')))
    expect(found).toEqual([])
  })
})
