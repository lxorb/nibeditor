import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** `window.nibApp`, which is how a drive reads the app.
 *
 *  Every store on it is there because a drive cannot reach what it stands for by
 *  pointing: a sheet with no row that opens it, a picker inside a menu, a stage that
 *  covers the window with nothing of the app left in the page. So a store that is
 *  quietly dropped from the handle takes a drive with it, and the drive fails
 *  somewhere else entirely - `window.nibApp.present is undefined`, in a run that was
 *  about slides.
 *
 *  Not a release, because this object is the whole workspace and the page it sits on
 *  renders other people's HTML. It used to be `import.meta.env.DEV`, which meant the
 *  only build anything could drive was the one nobody ships - and three reported bugs
 *  turned out to be unreproducible in every build a drive could reach. So the guard is
 *  `__DRIVEABLE__`: on while a dev server serves and in `--mode drive`, off in a
 *  release, where the bundler removes the branch and the handle is not there at all.
 *  See App.svelte, env.d.ts and vite.config.ts. */

const APP = readFileSync(fileURLToPath(new URL('../src/App.svelte', import.meta.url)), 'utf8')

/** Where the constant is decided. Read here so the two halves of the rule - what the
 *  guard is, and when it is true - are held by one test rather than by a comment. */
const CONFIG = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8')

/** The object literal assigned as `nibApp`, brace matched. */
function handle(): string {
  const opening = 'nibApp: {'
  const from = APP.indexOf(opening)
  expect(from, 'no nibApp on the window').toBeGreaterThanOrEqual(0)

  let depth = 1
  let at = from + opening.length
  while (depth > 0 && at < APP.length) {
    const character = APP[at]
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    at += 1
  }

  return APP.slice(from, at)
}

describe('the handle a drive reads the app through', () => {
  const listed = handle()

  test('it is behind the constant that says a build may be driven', () => {
    expect(APP).toContain('if (__DRIVEABLE__)')
    expect(APP.indexOf('if (__DRIVEABLE__)')).toBeLessThan(APP.indexOf('nibApp: {'))
    // And never guarded on DEV again: that is what shut every drive out of the
    // build that ships. The guard form, not the bare name, because the comment
    // above the guard in App.svelte says what it used to be.
    expect(APP).not.toContain('if (import.meta.env.DEV)')
  })

  test('and that constant is false in a release', () => {
    expect(CONFIG).toContain(
      "__DRIVEABLE__: JSON.stringify(command === 'serve' || mode === 'drive')",
    )
  })

  /** Named one by one rather than counted, so adding a store is a line here and
   *  taking one away is a failing test rather than a quiet loss. */
  test.each([
    'account',
    'busy',
    'fullscreen',
    'iconChoice',
    'links',
    'modes',
    'pages',
    // The stage has no chrome in the page, so this is the only way to read it.
    'present',
    'pull',
    'rooms',
    'search',
    'settings',
    'share',
    'shortcuts',
    'sync',
    'theme',
    'themeStore',
    'toolbar',
    'viewport',
    'views',
    'workspace',
  ])('%s is on it', (name) => {
    expect(listed).toMatch(new RegExp(`(^|[\\s,])${name},`))
  })

  /** The four that arrive after their module does; see the Promise.all below the
   *  handle in App.svelte. */
  test.each(['ai', 'importing', 'publish', 'rewriting'])('%s arrives on it later', (name) => {
    const later = APP.slice(APP.indexOf('nibApp: {') + listed.length)
    expect(later).toContain(`Object.assign((window as unknown as { nibApp: object }).nibApp`)
    expect(later).toMatch(new RegExp(`${name}[,:]`))
  })
})
