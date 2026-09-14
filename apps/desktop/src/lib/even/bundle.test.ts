import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { undrawable } from '@nib/glasses'
import manifest from '../../../even.app.json'

/** What the store's review reads, held to what it asks for.
 *
 *  It refused a build twice, and both findings are about the *bundle* rather than
 *  about anything the plugin does:
 *
 *    1. "Bundle contains URLs not covered by `network.whitelist`. (37 unlisted
 *       URL(s): ['https://svelte.dev/e/props_invalid_value', ...])"
 *    2. "`new Function()` is used in the bundle. Heads up: `new Function()`
 *       evaluates dynamic code (same risk class as `eval()`)."
 *
 *  Neither is something a unit test of the app could have caught, because neither
 *  is about the app: they are about which libraries came along. So this builds the
 *  plugin the way a release does and reads the folder that is packed, which is the
 *  only place either question has an answer.
 *
 *  It is slow, and that is the price of the only test that could have prevented a
 *  release from failing at the last step. */

const app = resolve(import.meta.dirname, '../../..')
const staged = join(app, 'dist-even')

/** The origins the manifest allows. Anything else must not be in the package at
 *  all, whether or not it is ever asked for. */
const allowed = manifest.permissions.find((one) => one.name === 'network')?.whitelist ?? []

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }

  return out
}

let files: { name: string; text: string }[] = []

beforeAll(() => {
  // The plugin's own build, not the editor's: what it ships is decided by leaving
  // code out, and only this build leaves it out. See vite.even.config.ts.
  execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'vite.even.config.ts'], {
    cwd: app,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  execFileSync('node', [resolve(app, '../../scripts/even-stage.mjs'), staged, staged], {
    cwd: app,
    stdio: 'pipe',
  })

  files = walk(staged)
    .filter((one) => /\.(js|css|html|json|webmanifest)$/.test(one))
    .map((one) => ({ name: one.slice(staged.length + 1), text: readFileSync(one, 'utf8') }))
}, 300_000)

describe('the bundle a package is made of', () => {
  test('is there at all, and is the plugin under both names', () => {
    expect(files.length).toBeGreaterThan(10)
    const both = files.filter((one) => one.name === 'even.html' || one.name === 'index.html')
    expect(both).toHaveLength(2)
    expect(both[0]?.text).toBe(both[1]?.text)
  })

  /** The review's first finding. */
  test('carries no URL the manifest does not allow', () => {
    const off: string[] = []

    for (const file of files) {
      for (const found of file.text.matchAll(/https?:\/\/[^\s"'`)\\<>]*/g)) {
        const url = found[0]
        if (allowed.some((one) => url.startsWith(one))) continue
        off.push(`${url}   [${file.name}]`)
      }
    }

    expect(off.slice(0, 12).join('\n')).toBe('')
  })

  /** The other half of the first finding, and the one that cost something.
   *
   *  An XML namespace looks exactly like a URL and is not one: `createElementNS` and
   *  an `xmlns` attribute name a language by it, nothing ever fetches it, and a
   *  browser compares it character for character. Taking the scheme off made every
   *  `<path>` Svelte creates for a shape it was handed an unknown element in a
   *  namespace that does not exist - drawn as nothing - and did the same to the
   *  chevron on every select and to every equation KaTeX draws as MathML. Emil, on
   *  his phone: *"I don't see the icons of the spaces on the Even Realities plugin
   *  right now."*
   *
   *  So they stay, spelled with the escape their own file reads as a slash. Which is
   *  a rule about spelling, and a rule about spelling wants a test. */
  test('keeps the XML namespaces exactly, in whatever the file spells them with', () => {
    const spellings = ['http:\\/\\/www.w3.org', 'http%3A//www.w3.org', 'http&#58;//www.w3.org']
    const wrong: string[] = []
    let held = 0

    for (const file of files) {
      for (const found of file.text.matchAll(/.{0,12}www\.w3\.org/g)) {
        held++
        if (!spellings.some((one) => found[0].endsWith(one))) {
          wrong.push(`${file.name}: ...${found[0]}`)
        }
      }
    }

    expect(wrong.slice(0, 6).join('\n')).toBe('')
    // Svelte's own runtime carries the SVG one, and so does anything that draws a
    // shape it was handed. A build with none at all means this stopped looking where
    // they are rather than that they are gone.
    expect(held).toBeGreaterThan(5)
  })

  test('holds the whitelist to the manifest, so the two cannot drift', () => {
    expect(allowed.length).toBeGreaterThan(0)
    for (const one of allowed) expect(one).toMatch(/^https:\/\//)
  })

  /** The review's second finding, and Emil's answer to it: "JavaScript execution
   *  is not needed by the Even Realities plugin, so for the plugin it can be
   *  disabled." So this is not about how a construct is written; it is about the
   *  plugin having no way to evaluate a string at all. */
  test('turns no string into code, by any of the ways there are', () => {
    const ways = [
      /new\s+Function\s*\(/,
      /[^.\w$]Function\s*\(/,
      // Not only `eval(`: the sandbox this replaces called it as `(0, eval)(CODE)`
      // to get the global one, and a name that is only ever mentioned to be called
      // is worth failing on however it is written. Not a bare `eval` though -
      // Clojure's highlighting mode lists it among that language's own words, and a
      // word in a list of words is not a call.
      /[^.\w$]eval\s*[()]/,
      // A timer given a string is `eval` with a delay in front of it.
      /set(?:Timeout|Interval)\s*\(\s*['"`]/,
    ]

    const found: string[] = []
    for (const file of files) {
      for (const way of ways) {
        const at = way.exec(file.text)
        if (at)
          found.push(
            `${file.name}: ...${file.text.slice(Math.max(0, at.index - 60), at.index + 40)}`,
          )
      }
    }

    expect(found.slice(0, 6).join('\n\n')).toBe('')
  })

  /** The play button and everything under it: the panel that draws it, the
   *  protocol it speaks and the sandbox that would run the code.
   *
   *  Asked of the code rather than of the whole folder, because the stylesheet
   *  still carries the panel's own rules: they come from the theme's stylesheet
   *  rather than from the module, and a rule for an element nothing makes styles
   *  nothing. The button is what a reader can press, and the button is not here. */
  test('has no way to run a fence, and no button offering to', () => {
    const runner = files.filter(
      (one) =>
        one.name.endsWith('.js') &&
        (one.text.includes('nib-run-panel') || one.text.includes('nib-run-output')),
    )

    expect(runner.map((one) => one.name)).toEqual([])
  })

  test('and none of the sandbox that would have run it', () => {
    // The runner marks every message between the page and its sandboxed frame with
    // this, and nothing else in the app uses it. That frame is where the
    // `new Function` and the `eval` the review found lived.
    for (const file of files) {
      if (!file.name.endsWith('.js')) continue
      expect(file.text, file.name).not.toContain('nib-run')
    }
  })

  test('leaves out the libraries a pair of glasses cannot use', () => {
    // Each of these was a finding of its own: mermaid and its parser stack, the
    // document exporters, the PDF viewer. Named by a string only they carry.
    const gone: Record<string, string> = {
      mermaid: 'mermaid-js/mermaid',
      chevrotain: 'chevrotain',
      cytoscape: 'cytoscape',
      docx: 'wordprocessingml',
      jszip: 'JSZip',
      'flowchart.js': 'raphaeljs',
      // A fifth of the package on its own, and the one that was hardest to see:
      // `openEntry` declines to open a PDF here, but the viewer is a component of a
      // pane, so the library came along anyway.
      'pdfjs-dist': 'pdfjs_internal',
    }

    const here = Object.entries(gone)
      .filter(([, mark]) => files.some((one) => one.text.includes(mark)))
      .map(([name]) => name)

    expect(here).toEqual([])
  })

  /** Emil, on his phone: *"I don't see the icons of the spaces on the Even Realities
   *  plugin right now."* It was not this - the shapes were in the package all along,
   *  and the cause was the storage the chosen name is read from; see
   *  lib/even/first.ts. But it was the first thing worth ruling out, and a build that
   *  shook the library down to the handful the interface itself draws would look
   *  exactly the same to a reader: every space back to a letter, and a picker with
   *  nothing in it. */
  test('brings the icons a space can wear, shapes and names both', () => {
    const code = files.filter((one) => one.name.endsWith('.js'))

    // Lucide's own helper. Nothing else in the package has one by that name, so it
    // says the library itself is here rather than a few shapes copied out of it.
    expect(code.some((one) => one.text.includes('createIcons'))).toBe(true)

    // The shapes, in bulk: about six thousand paths as this is written. Written to
    // read a minified `{d:` and a quoted `"d":` alike, because which one a build
    // writes is the minifier's business.
    const shapes = code.reduce(
      (sum, one) => sum + (one.text.match(/[{,]\s*"?d"?\s*:\s*['"`]M/g)?.length ?? 0),
      0,
    )
    expect(shapes).toBeGreaterThan(2000)

    // And reachable by the name a space stores, which is what the rail looks up.
    // These four are the ones on Emil's own account.
    for (const name of ['GraduationCap', 'Book', 'SquareCheck', 'Newspaper']) {
      const held = code.some((one) => new RegExp(`\\b${name}\\b`).test(one.text))
      expect(held, name).toBe(true)
    }
  })

  test('is small enough for the platform to be comfortable with', () => {
    const bytes = walk(staged).reduce((sum, one) => sum + statSync(one).size, 0)
    // 7.53 MB as this is written, measured on 2026-09-13, against 8.80 with every
    // catalogue in: the sixteen the firmware has no glyphs for are left out, which is
    // 1.27 MB. The ceiling is a quarter of a megabyte over it, which is room for the
    // app to grow and not room for those catalogues to come back. The ceiling is close to
    // it on purpose: this number went from 11.8 MB to 6.0 by leaving libraries out,
    // and a megabyte back is a library that crept in again. Speed is the selling
    // point, and on a phone the download is part of it.
    //
    // What is left that is not the app, and what to weigh if this has to come down
    // again: node-emoji's table, 1.1 MB, which `insteadOf` in
    // packages/glasses/src/firmware.ts uses to write an emoji the firmware cannot
    // draw as its own `:name:` rather than as a box; and the 23 catalogues that are
    // shipped, about 1.3 MB between them.
    expect(bytes).toBeLessThan(7.8 * 1024 * 1024)
  })

  /** The catalogues, held to what the font can draw.
   *
   *  The app has 40 of them, one lazily loaded chunk each, and the package is fetched
   *  whole: a reader loads one and pays for all 40. The firmware's one font draws
   *  Latin, Cyrillic, Greek, CJK and emoji, so fifteen scripts among those 40 would
   *  put a row of boxes on the glass - and `undrawable` in the glasses package is
   *  what says which, by measuring rather than by listing. The build carries the list
   *  because a Vite config cannot import the metrics; this is what keeps the two
   *  saying the same thing.
   *
   *  Measured, the answer is two groups and nothing between them: every Latin,
   *  Cyrillic, Greek and CJK catalogue is at 0.0% undrawable, and the fifteen scripts
   *  are at 31% and more. */
  test('ships the catalogues the firmware can draw, and only those', () => {
    const where = resolve(app, 'src/locales')
    const catalogues = readdirSync(where).filter((one) => one.endsWith('.ts'))
    expect(catalogues.length).toBeGreaterThan(30)

    // By the file's own name rather than by its path: `walk` joins with the
    // platform's separator, and on Windows that is a backslash.
    const chunks = files.map((one) => one.name.split(/[\\/]/).at(-1) ?? '')
    const wrong: string[] = []

    for (const name of catalogues) {
      const id = name.replace('.ts', '')
      const share = undrawable(readFileSync(resolve(where, name), 'utf8'))
      // The chunk is named after the module it came from, with a hash after it.
      const shipped = chunks.some((one) => new RegExp(`^${id}-[\\w-]+\\.js$`).test(one))

      if (share > 0.1 && shipped) wrong.push(`${id} is ${(share * 100).toFixed(1)}% boxes, shipped`)
      if (share <= 0.1 && !shipped) wrong.push(`${id} is drawable and is not in the package`)
    }

    expect(wrong.join('\n')).toBe('')
  })
})
