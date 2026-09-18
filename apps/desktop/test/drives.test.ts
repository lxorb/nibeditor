import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The drives in `test/e2e`, held to the app they steer.
 *
 *  Eighty-nine Python files point at this app and nothing in the repository
 *  connected the two, so the app moved and they did not. Nine of them were found
 *  drifted in one week, every one the same way: a component renamed a class, a
 *  bridge method grew a parameter, a build mode stopped carrying the handles the
 *  drives open the app through - and each time the unit test beside the change was
 *  updated while the drive went on saying what used to be true. A drive only says so
 *  when somebody runs it by hand, which for most of them is months.
 *
 *  These read the drives as text and hold three of their claims to the app itself.
 *  None opens a browser, so they run here rather than in the one gate that pays for
 *  one; see e2e/smoke.py and check.yml.
 *
 *  What they cannot do is run a drive, and they are no substitute for it. A class
 *  that still exists on something else, a count that moved from two to three, a
 *  click that landed on a control rather than on the row under it: those are drives
 *  failing against an app these tests are perfectly happy with. What is here is the
 *  part that is a fact about two files rather than about a running app - which is
 *  the part that costs nothing to keep true. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const E2E = join(ROOT, 'apps', 'desktop', 'test', 'e2e')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

/** One capture of a match. A group is typed as possibly absent even where the
 *  pattern cannot match without it, and every pattern here is one of those. */
const caught = (found: RegExpMatchArray, at = 1): string => found[at] ?? ''

/** Every drive, by name. Read off the folder, so one written tomorrow is covered by
 *  being written. */
const drives = readdirSync(E2E)
  .filter((name) => name.endsWith('.py'))
  .sort()

/** Every file of the app a name a drive points at could be written in: the desktop
 *  app, the packages it renders a note with, and the Worker that serves a published
 *  page, which is the third surface the drives look at. */
function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourcesUnder(path, found)
    else if (/\.(ts|svelte|css|html)$/.test(entry.name)) found.push(path)
  }

  return found
}

const sources = [
  ...sourcesUnder(join(ROOT, 'apps', 'desktop', 'src')),
  ...sourcesUnder(join(ROOT, 'packages')),
  ...sourcesUnder(join(ROOT, 'services')),
]

/** A class where a stylesheet writes one. Anywhere in a `.css` file and inside a
 *  component's `<style>`, where a dot in front of a word is a class and nothing else
 *  - unlike the script beside it, where `one.look` is a property. */
const IN_CSS = /\.(-?[A-Za-z_][\w-]*)/g
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/g

/** The ways the app names a class outside a stylesheet: the attribute and the same
 *  word as an object key, which is how a CodeMirror decoration carries one; the
 *  `class:on` a component toggles with; and the DOM's own two spellings. */
const ATTRIBUTE = /\bclass\s*[=:]\s*["'`]([^"'`]*)["'`]/g
const DIRECTIVE = /\bclass:(-?[A-Za-z_][\w-]*)/g
const ELEMENT = /\b(?:classList\.(?:add|remove|toggle|contains)|addLineClass)\(([^)]*)\)/g
const PROPERTY = /\bclassName\s*=\s*["'`]([^"'`]*)["'`]/g

/** Everything the app writes that a selector can select on.
 *
 *  Vocabularies rather than a map of which file writes what, because a class is
 *  written in one place and styled in another and a drive cares about neither: what
 *  it asks the app is whether this word still means anything at all. A name built
 *  out of pieces - `nib-callout-${look}` - is in here through the stylesheet that
 *  colours it, which is the one place such a name is ever written whole. */
const classes = new Set<string>()
const ids = new Set<string>()
const data = new Set<string>()

function split(text: string, into: Set<string>): void {
  for (const one of text.split(/[\s${}()?:+\\]+/)) if (one) into.add(one.replace(/^\./, ''))
}

for (const path of sources) {
  const text = read(path)

  if (path.endsWith('.css')) for (const found of text.matchAll(IN_CSS)) classes.add(caught(found))
  else
    for (const block of text.matchAll(STYLE))
      for (const found of caught(block).matchAll(IN_CSS)) classes.add(caught(found))

  for (const found of text.matchAll(ATTRIBUTE)) split(caught(found), classes)
  for (const found of text.matchAll(DIRECTIVE)) classes.add(caught(found))
  for (const found of text.matchAll(PROPERTY)) split(caught(found), classes)
  for (const found of text.matchAll(ELEMENT))
    for (const one of caught(found).matchAll(/["'`]([^"'`]+)["'`]/g)) split(caught(one), classes)

  // An id as the attribute, as the property, and as a stylesheet's own selector.
  for (const found of text.matchAll(/\bid\s*[=:]\s*["'`]([^"'`${}]*)["'`]/g))
    split(caught(found), ids)
  for (const found of text.matchAll(/#(-?[A-Za-z_][\w-]*)/g)) ids.add(caught(found))

  // A data attribute as markup writes it, and as the DOM spells the same thing
  // back: `dataset.calloutFold` is `data-callout-fold`.
  for (const found of text.matchAll(/\bdata-([a-z][\w-]*)/g)) data.add(caught(found))
  for (const found of text.matchAll(/\bdataset\.([A-Za-z]\w*)/g))
    data.add(caught(found).replace(/[A-Z]/g, (one) => `-${one.toLowerCase()}`))
}

/** Where a drive hands a selector to the browser: the DOM's own, and the Playwright
 *  calls that take one. */
const ASKED =
  /(?:querySelectorAll|querySelector|closest|matches|locator|click|hover|wait_for_selector|eval_on_selector(?:_all)?|is_visible|fill|dblclick|scroll_to)\s*\(\s*f?(["'`])((?:\\.|(?!\1).)*)\1/g

/** A class asked for by name rather than through a selector. */
const HELD = /classList\.contains\(\s*f?(["'`])((?:\\.|(?!\1).)*)\1/g

/** Names that are somebody else's markup, so the app writes none of them and should
 *  not have to: CodeMirror's, and the two video players a drive opens to find out
 *  what an embedded page is allowed to do. Prefixes, because a drive reaches several
 *  of each. */
const NOT_OURS = /^(?:cm-|ytp-|vp-)/

/** Everything in one piece of a selector that the app no longer writes anywhere. */
function strangers(part: string): string[] {
  const gone: string[] = []

  for (const found of part.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
    const name = caught(found)
    if (!NOT_OURS.test(name) && !classes.has(name)) gone.push(`.${name}`)
  }
  for (const found of part.matchAll(/#(-?[A-Za-z_][\w-]*)/g))
    if (!ids.has(caught(found))) gone.push(`#${caught(found)}`)
  for (const found of part.matchAll(/\[data-([a-z][\w-]*)/g))
    if (!data.has(caught(found))) gone.push(`[data-${caught(found)}]`)

  return gone
}

/** What one selector asks for that is not there, or nothing.
 *
 *  Commas first, because a drive asking for `.canvas-bar, .bar` is asking for either
 *  and is right as long as one of them is there. Whatever a Python f-string
 *  interpolates is cut out before the names are read: `[aria-pressed="{on}"]` names
 *  nothing this can check. */
function forgotten(selector: string): string[] {
  let worst: string[] = []

  for (const part of selector.replace(/\{[^}]*\}/g, '').split(',')) {
    const gone = strangers(part)
    if (!gone.length) return []
    if (!worst.length || gone.length < worst.length) worst = gone
  }

  return worst
}

describe('the names a drive points at', () => {
  test('the app writes names at all', () => {
    // Vocabularies that came out empty would pass every test below them.
    expect(classes.size).toBeGreaterThan(500)
    expect(ids).toContain('write')
    expect(data).toContain('callout')
  })

  test.each(drives)('%s points at names the app still writes', (name) => {
    const text = read(E2E, name)
    const selectors = new Set<string>()
    for (const found of text.matchAll(ASKED)) selectors.add(caught(found, 2))
    for (const found of text.matchAll(HELD)) selectors.add(`.${caught(found, 2)}`)

    const stale = [...selectors]
      .map((one) => ({ one, gone: forgotten(one) }))
      .filter((found) => found.gone.length)
      .map((found) => `${found.one} → ${found.gone.join(' ')}`)
      .sort()

    expect(stale, `${name} asks for names nothing in the app writes`).toEqual([])
  })
})

describe('the build a drive steers', () => {
  const CONFIG = read(ROOT, 'apps', 'desktop', 'vite.config.ts')

  /** The build modes that leave `window.nibApp` and `window.nib` on the page, read
   *  off the line in vite.config.ts that decides it rather than written down again
   *  here - which is what makes this a question about two files rather than about a
   *  constant somebody has to remember to change in both. See env.d.ts. */
  const driveable = [...CONFIG.matchAll(/mode === '([^']+)'/g)].map((found) => caught(found))

  /** Every `--mode` one drive names: the argument it builds with, and the command in
   *  its own documentation that tells a person how to build it by hand. */
  function modesIn(text: string): string[] {
    return [
      ...[...text.matchAll(/"--mode",\s*"([^"]+)"/g)].map((found) => caught(found)),
      ...[...text.matchAll(/--mode ([a-z][\w-]*)/g)].map((found) => caught(found)),
    ]
  }

  test('the config still says which modes may be driven', () => {
    expect(CONFIG).toContain('__DRIVEABLE__')
    expect(driveable).toContain('drive')
  })

  /** Most drives build the app for themselves, and a build with the handles compiled
   *  out is a drive that gets as far as "gave up waiting for the app" and no further.
   *  That is not a thought experiment: for a few hours every one of them built a mode
   *  the constant had stopped covering, and nothing in the repository said so. */
  test.each(drives)('%s builds a build a drive may steer', (name) => {
    for (const mode of modesIn(read(E2E, name))) {
      expect(driveable, `${name} builds --mode ${mode}, which carries no handle`).toContain(mode)
    }
  })
})

describe('the activity a drive stands in for', () => {
  const BRIDGE = read(ROOT, 'apps', 'desktop', 'src', 'lib', 'mobile', 'bridge.ts')

  /** What `NibSystem` declares, as each method's parameter names in order. The
   *  interface is the page's side of the Android bridge: `android.test.ts` holds it
   *  to the Kotlin behind it, and this holds it to the drives in front of it. */
  const declared = new Map<string, string[]>()
  const block = BRIDGE.slice(BRIDGE.indexOf('export interface NibSystem {'))
  for (const found of block.slice(0, block.indexOf('\n}')).matchAll(/^\s*(\w+)\(([^)]*)\)/gm)) {
    declared.set(
      caught(found),
      caught(found, 2)
        .split(',')
        .map((one) => (one.split(':')[0] ?? '').trim())
        .filter(Boolean),
    )
  }

  /** The stand-in a drive hangs on the window in place of the activity, if it has
   *  one: everything from `__NIB_SYSTEM__ =` onwards, which is as much as reading a
   *  file as text can honestly claim. */
  function shimIn(text: string): string | null {
    const at = text.indexOf('__NIB_SYSTEM__ = {')
    return at === -1 ? null : text.slice(at)
  }

  const standIns = drives.filter((name) => shimIn(read(E2E, name)))

  test('the two sides are both there to be read', () => {
    expect([...declared.keys()]).toContain('listen')
    expect(standIns.length).toBeGreaterThan(0)
  })

  /** A shim is written by hand out of the interface beside it, which is how one came
   *  to answer `listen(on)` after the bridge had grown a word in front of it: the
   *  drive passed a boolean where a string was wanted, wrote down the empty string,
   *  and reported that the phone had never been asked to listen.
   *
   *  Names rather than how many, and a prefix rather than the whole list, because a
   *  stub that ignores the arguments it does not care about is a stub doing its job -
   *  `bars: () => undefined` stands in perfectly for `bars(dark)`. What it may not do
   *  is take them under another name or in another order, which is the one way a shim
   *  can be wrong while still looking right. */
  test.each(standIns)('%s stands in for the bridge the app talks over', (name) => {
    const shim = shimIn(read(E2E, name)) ?? ''
    const wrong: string[] = []

    for (const found of shim.matchAll(/^\s{4}(\w+):\s*\(([^)]*)\)\s*=>/gm)) {
      const method = caught(found)
      const taken = caught(found, 2)
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean)
      const wanted = declared.get(method)

      if (!wanted) {
        wrong.push(`${method} is not on the bridge any more`)
        continue
      }

      if (wanted.slice(0, taken.length).join() !== taken.join()) {
        wrong.push(`${method}(${taken.join(', ')}) stands in for ${method}(${wanted.join(', ')})`)
      }
    }

    expect(wrong, `${name} stands in for an activity the app no longer talks to`).toEqual([])
  })
})
