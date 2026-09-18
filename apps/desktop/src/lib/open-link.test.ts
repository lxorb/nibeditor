import { describe, expect, test } from 'vitest'
import { askOf, type LinkAsk, type LinkPlace, opensLink, placeFor, webHref } from './open-link'

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
const PLAIN: LinkAsk = { middle: false, modifier: false, shift: false }

function place(href: string, ask: Partial<LinkAsk> = {}, holdsPages = true): LinkPlace {
  return placeFor(href, { ...PLAIN, ...ask }, holdsPages)
}

describe('where a pressed link goes', () => {
  test('a plain press opens the page in front of the reader', () => {
    expect(place('https://svelte.dev/docs')).toBe('here')
  })

  test('the modifier opens it behind, the way Ctrl+click does in every browser', () => {
    expect(place('https://svelte.dev/docs', { modifier: true })).toBe('behind')
  })

  test('the modifier and Shift open it in front, the way Ctrl+Shift+click does', () => {
    expect(place('https://svelte.dev/docs', { modifier: true, shift: true })).toBe('here')
  })

  test('the middle button opens it behind, whatever else is held', () => {
    expect(place('https://svelte.dev/docs', { middle: true })).toBe('behind')
    expect(place('https://svelte.dev/docs', { middle: true, shift: true })).toBe('behind')
  })

  test('Shift on its own leaves for the system browser, which is the way out', () => {
    expect(place('https://svelte.dev/docs', { shift: true })).toBe('system')
  })

  test('a bare host address is a page like any other', () => {
    expect(place('http://localhost:5173/')).toBe('here')
    expect(place('//example.com/a')).toBe('here')
  })
})

describe('what never becomes a tab', () => {
  test('an email address is the system\u2019s, whatever is held down', () => {
    expect(place('mailto:emil@example.com')).toBe('system')
    expect(place('mailto:emil@example.com', { modifier: true })).toBe('system')
    expect(place('mailto:emil@example.com', { middle: true })).toBe('system')
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
    expect(place('https://svelte.dev/docs', { modifier: true }, false)).toBe('system')
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

  test('the middle button is read off the press and not off a key', () => {
    expect(askOf({ button: 1, ctrlKey: false, metaKey: false, shiftKey: false }).middle).toBe(true)
    expect(askOf({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false }).middle).toBe(false)
  })

  test('Ctrl is the modifier off a Mac, and Cmd is not', () => {
    expect(askOf({ button: 0, ctrlKey: true, metaKey: false, shiftKey: false }).modifier).toBe(true)
    expect(askOf({ button: 0, ctrlKey: false, metaKey: true, shiftKey: false }).modifier).toBe(
      false,
    )
  })

  test('Shift is carried through as itself', () => {
    expect(askOf({ button: 0, ctrlKey: false, metaKey: false, shiftKey: true }).shift).toBe(true)
  })
})
