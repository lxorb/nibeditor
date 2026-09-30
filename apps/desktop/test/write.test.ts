import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { everySurface } from '@nib/themes/write'

/** One `#write` to a document, and every page a note is on reached anyway.
 *
 *  The app shows several pages at once - panes side by side, a column of stacked
 *  notes, the card over a link, this slide and the next in the presenter's window -
 *  and each of them used to carry `id="write"`, because that is the id every theme
 *  is written against. Every page wears the class now, the page in the focused pane
 *  wears the id as well, and the rules reach all of them as `:is(#write, .nib-write)`.
 *  See write.ts in @nib/themes. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const EDITOR = fileURLToPath(new URL('../../../packages/editor/src/', import.meta.url))
const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

function files(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

describe('every page a note is on', () => {
  test('is reached by a rule about `#write`, at the id’s own weight', () => {
    expect(everySurface('#write h1, #write > p')).toBe(
      ':is(#write, .nib-write) h1, :is(#write, .nib-write) > p',
    )
    // `:is()` weighs what its heaviest argument weighs, whichever of them matched.
    expect(everySurface('.editor #write')).toBe('.editor :is(#write, .nib-write)')
  })

  test('and widening it twice is widening it once', () => {
    const once = everySurface('#write .hl-keyword { color: red; }')
    expect(everySurface(once)).toBe(once)
  })

  test('and only `#write` itself is widened', () => {
    expect(everySurface('#write-later, #writer')).toBe('#write-later, #writer')
  })

  test('and the app’s build reads its stylesheets that way', () => {
    const config = readFileSync(CONFIG, 'utf8')
    expect(config).toContain("from '@nib/themes/write'")
    expect(config).toContain('postcss: { plugins: [everyPage] }')
  })

  test('and nothing in the app writes the id onto a page for good', () => {
    // A document written out has one page and keeps `#write`: an export, an ePub, a
    // published note. What the app draws gives the id to the page in front only.
    const written = [...files(SOURCE), ...files(EDITOR)]
      .filter((path) => !/[\\/](export|site)[\\/]|export\.ts$/.test(path))
      .filter((path) => /id="write"|id: 'write'|\.id = 'write'/.test(readFileSync(path, 'utf8')))
      .map((path) => path.replace(/\\/g, '/').split('/src/').pop())

    expect(written).toEqual([])
  })
})
