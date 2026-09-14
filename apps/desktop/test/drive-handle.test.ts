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
 *  A development build only, which is what the drives are served. See App.svelte. */

const APP = readFileSync(fileURLToPath(new URL('../src/App.svelte', import.meta.url)), 'utf8')

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

  test('it is only in a development build', () => {
    expect(APP).toContain('if (import.meta.env.DEV)')
    expect(APP.indexOf('if (import.meta.env.DEV)')).toBeLessThan(APP.indexOf('nibApp: {'))
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
