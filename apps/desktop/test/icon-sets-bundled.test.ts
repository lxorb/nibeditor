import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Where the icon sets are allowed to be, held to it by reading the source.
 *
 *  Two rules, and both are about weight. The emoji index is 422 KB of JSON, the
 *  coloured set 166 KB and Lucide's tags 256 KB; any one of them imported statically
 *  anywhere lands in the chunk the app loads before it draws anything, which is the
 *  one thing a fast editor cannot afford. And none of them is in the plugin at all:
 *  most of a megabyte of JSON for a picker whose one job on a phone is to put a mark
 *  on a folder, while the glasses draw a row as words with no mark in it.
 *
 *  The emoji's keywords are here for the rule rather than for the weight: `node-emoji`
 *  brings that same file eagerly for the editor's `:shortcode:` completions, so the
 *  picker's own use of it costs nothing today. It is held to the rule anyway, so the
 *  day the editor stops asking for it the picker is not the reason it still arrives
 *  before the first paint.
 *
 *  Read out of the source rather than out of a build, which is what makes it a test
 *  somebody runs. The build itself is held to the same line by the plugin's own bundle
 *  test, which builds and stages the package the way a release does and reads that;
 *  see src/lib/even/bundle.test.ts. */

const APP = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(APP, 'src')

/** The set data, by the specifier that asks for it. The same four names
 *  `vite.even.config.ts` leaves out, which is what the last test holds.
 *
 *  Two of them are the sets themselves and two are what the sets are searched by:
 *  Lucide's tags and the emoji's keywords, neither of any use until somebody has
 *  typed something into the picker. */
const DATA = [
  'unicode-emoji-json/data-by-group.json',
  '@iconify-json/flat-color-icons/icons.json',
  'lucide-static/tags.json',
  'emojilib/emojis.json',
]

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (/\.(ts|svelte)$/.test(name)) found.push(path)
  }

  return found
}

const files = sources(SOURCE).map((path) => ({
  name: path.slice(SOURCE.length).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

describe('the icon sets that are data rather than drawing', () => {
  test('are asked for, so somewhere in the app knows their names', () => {
    for (const one of DATA) {
      expect(
        files.some((file) => file.text.includes(one)),
        one,
      ).toBe(true)
    }
  })

  /** A static import puts a chunk in the first load; `await import(...)` gives it one
   *  of its own, fetched when a tab is opened. The difference is half a megabyte
   *  before the first paint. */
  test('are only ever reached through a dynamic import', () => {
    const offenders: string[] = []

    for (const file of files) {
      for (const one of DATA) {
        if (!file.text.includes(one)) continue

        // Every mention of it has to be inside `import(` rather than after `from`.
        for (const match of file.text.matchAll(new RegExp(`.{0,10}['"]${escaped(one)}['"]`, 'g'))) {
          if (!match[0].includes('import(')) offenders.push(`${file.name}: ${match[0].trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  /** One place asks for them, which is what keeps the rule checkable at all: a set
   *  reached from two files is a set that can be reached statically from one of them
   *  without anybody noticing. */
  test('and one module asks for them', () => {
    for (const one of DATA) {
      expect(
        files.filter((file) => file.text.includes(one)).map((file) => file.name),
        one,
      ).toEqual(['/lib/icon-sets.ts'])
    }
  })

  test('and the plugin build leaves every one of them out', () => {
    const config = readFileSync(join(APP, 'vite.even.config.ts'), 'utf8')
    const left = config.slice(config.indexOf('const LEFT_OUT'), config.indexOf('/** What a module'))

    for (const one of DATA) expect(left, one).toContain(one)
  })
})

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
