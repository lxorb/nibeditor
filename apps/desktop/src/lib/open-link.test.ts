import { describe, expect, test } from 'vitest'
import { type Press, tabAsk } from './new-tab'
import { type LinkPlace, opensLink, placeFor, webHref } from './open-link'

/** Which press on a link goes where.
 *
 *  The decision is the whole of the feature - the rest is a tab being made - and it
 *  is the part somebody will one day be tempted to change on one surface only, so it
 *  lives in one pure function with these around it. Two things are being held down:
 *  that the browser's own modifiers keep their browser meanings, and that nothing a
 *  tab may not hold is ever handed to one.
 *
 *  `holdsPages` is passed rather than read, so every case here says which build it is
 *  about: a desktop that has somewhere to put a page, or a phone that does not. */

/** Nothing held down, the main button: what a reader does without thinking. */
const PLAIN: Press = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false }

/** A press read the way `followHref` reads it - Shift on its own means something on
 *  a link - and then placed. */
function place(href: string, press: Partial<Press> = {}, holdsPages = true): LinkPlace {
  return placeFor(href, tabAsk({ ...PLAIN, ...press }, true), holdsPages)
}

describe('where a pressed link goes', () => {
  test('a plain press opens the page in front of the reader', () => {
    expect(place('https://svelte.dev/docs')).toBe('here')
  })

  test('the modifier opens it behind, the way Ctrl+click does in every browser', () => {
    expect(place('https://svelte.dev/docs', { ctrlKey: true })).toBe('behind')
  })

  test('the modifier and Shift open it in front, the way Ctrl+Shift+click does', () => {
    expect(place('https://svelte.dev/docs', { ctrlKey: true, shiftKey: true })).toBe('here')
  })

  test('the middle button opens it behind, and in front with Shift, as in Chrome', () => {
    expect(place('https://svelte.dev/docs', { button: 1 })).toBe('behind')
    expect(place('https://svelte.dev/docs', { button: 1, shiftKey: true })).toBe('here')
  })

  test('Shift on its own opens it in front, since a nib window holds no one page', () => {
    expect(place('https://svelte.dev/docs', { shiftKey: true })).toBe('here')
  })

  test('a bare host address is a page like any other', () => {
    expect(place('http://localhost:5173/')).toBe('here')
    expect(place('//example.com/a')).toBe('here')
  })
})

describe('what never becomes a tab', () => {
  test('an email address is the system\u2019s, whatever is held down', () => {
    expect(place('mailto:emil@example.com')).toBe('system')
    expect(place('mailto:emil@example.com', { ctrlKey: true })).toBe('system')
    expect(place('mailto:emil@example.com', { button: 1 })).toBe('system')
  })

  test('a telephone number is the system\u2019s too', () => {
    expect(place('tel:+41441234567')).toBe('system')
  })

  test('a note asking for this machine gets nothing at all', () => {
    expect(place('file:///C:/Windows/System32/cmd.exe')).toBe('nowhere')
    expect(place('javascript:alert(1)')).toBe('nowhere')
    expect(place('smb://server/share')).toBe('nowhere')
    expect(place('data:text/html,<p>hi')).toBe('nowhere')
    expect(place('nib://open?path=x')).toBe('nowhere')
  })

  test('the app\u2019s own origins are not somewhere a tab may go', () => {
    expect(place('http://tauri.localhost/index.html')).toBe('system')
    expect(place('https://ipc.localhost/notes')).toBe('system')
    expect(place('http://asset.localhost/a.png')).toBe('system')
  })

  test('a build with nowhere to put a page hands every page to the system', () => {
    expect(place('https://svelte.dev/docs', {}, false)).toBe('system')
    expect(place('https://svelte.dev/docs', { ctrlKey: true }, false)).toBe('system')
    expect(place('file:///C:/notes/Idea.md', {}, false)).toBe('nowhere')
  })
})

describe('the address a link means', () => {
  test('a protocol-relative address is https, which is what a browser makes of it', () => {
    expect(webHref('//example.com/a')).toBe('https://example.com/a')
  })

  test('an address that is already a page is handed back unchanged', () => {
    expect(webHref('http://example.com/a')).toBe('http://example.com/a')
  })

  test('anything that is not a page is not one', () => {
    expect(webHref('mailto:emil@example.com')).toBe(null)
    expect(webHref('./Other note.md')).toBe(null)
    expect(webHref('')).toBe(null)
  })
})

describe('reading the press', () => {
  test('the main button and the middle one open links; the right button does not', () => {
    expect(opensLink({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true)
    expect(opensLink({ button: 1, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true)
    expect(opensLink({ button: 2, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(false)
  })
})
