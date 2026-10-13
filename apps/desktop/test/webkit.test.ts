import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What a Mac runs the app in, held to the source: WebKit, which is a Mac's WKWebView
 *  and an iPhone's, and an older one than the reader's Chrome for as long as the Mac
 *  has not been updated (`minimumSystemVersion` is macOS 13.3, which shipped Safari
 *  16.4).
 *
 *  Each rule here is a thing that was green everywhere this repository looks and wrong
 *  on a Mac. `cancelIdleCallback` is not in WebKit at all, and the editor's first
 *  screen called it after every keystroke, so the window stopped drawing after the
 *  first edit. `user-select` without its prefix is a declaration WebKit drops, and so
 *  is `style.userSelect`: a divider dragged on a Mac selected the note behind it. So a
 *  name WebKit lacks is asked about before it is used, in the file that uses it, and a
 *  property WebKit only reads prefixed is written both ways. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** The code that runs in the window: the app and the packages it is built from. */
const SOURCES = [
  'apps/desktop/src',
  'packages/editor/src',
  'packages/markdown/src',
  'packages/themes/src',
  'packages/bases/src',
  'packages/chats/src',
  'packages/glasses/src',
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path)
    return /\.(ts|svelte|css|js)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

const files = SOURCES.flatMap((one) => walk(join(ROOT, one))).map((path) => ({
  name: relative(ROOT, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}))

/** A file's words with its comments taken out, so a sentence about a name is not a use. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/** Each rule block of a stylesheet, or of a component's `<style>`, whole. */
function blocks(text: string): string[] {
  return [...code(text).matchAll(/\{[^{}]*\}/g)].map((one) => one[0])
}

const sheets = files.filter((one) => /\.(css|svelte)$/.test(one.name))

/** The properties WebKit reads only under its own prefix, so a block that sets one
 *  without the other is a rule a Mac never applies. */
const PREFIXED = ['user-select', 'backdrop-filter']

/** Names a Mac's WebKit does not have, each with what a file that uses one says to
 *  ask about it first. */
const MISSING: [string, RegExp, RegExp][] = [
  ['requestIdleCallback', /\brequestIdleCallback\s*\(/, /typeof requestIdleCallback/],
  ['cancelIdleCallback', /\bcancelIdleCallback\s*\(/, /typeof requestIdleCallback|hasIdle/],
  ['scheduler', /(^|[^.\w])scheduler\.(yield|postTask)/m, /globalThis/],
  [
    'showOpenFilePicker',
    /\bshow(Open|Save)FilePicker\s*\(|\bshowDirectoryPicker\s*\(/,
    /in window/,
  ],
  ['navigator.locks', /navigator\.locks\s*\.request/, /navigator\.locks\s*\?|typeof navigator/],
]

describe("a Mac's WebKit", () => {
  test('the scan reads the app', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(sheets.some((one) => one.name.endsWith('base.css'))).toBe(true)
  })

  for (const property of PREFIXED) {
    test(`reads ${property} only with -webkit- beside it`, () => {
      const bare = new RegExp(`(^|[^-\\w])${property}\\s*:`)
      const prefixed = new RegExp(`-webkit-${property}\\s*:`)
      const loose = sheets.flatMap((one) =>
        blocks(one.text)
          .filter((block) => bare.test(block) && !prefixed.test(block))
          .map((block) => `${one.name}: ${block.replace(/\s+/g, ' ').slice(0, 90)}`),
      )
      expect(loose).toEqual([])
    })
  }

  test('has no style.userSelect, so a drag holds selection off through unselectable', () => {
    const written = files.filter((one) => /\.style\.userSelect\b/.test(code(one.text)))
    expect(written.map((one) => one.name)).toEqual([])
  })

  for (const [name, used, asked] of MISSING) {
    test(`lacks ${name}, which is asked about wherever it is used`, () => {
      const unasked = files.filter((one) => {
        const body = code(one.text)
        return used.test(body) && !asked.test(body)
      })
      expect(unasked.map((one) => one.name)).toEqual([])
    })
  }

  test('sizes a field to its words only through grow where it cannot itself', () => {
    const fields = files.filter((one) => /field-sizing:\s*content/.test(code(one.text)))
    expect(fields.length).toBeGreaterThan(0)
    const unsized = fields.filter((one) => !/use:grow\b/.test(one.text))
    expect(unsized.map((one) => one.name)).toEqual([])
  })
})
