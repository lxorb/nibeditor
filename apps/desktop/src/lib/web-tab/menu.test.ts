/** The dots on a web tab's bar: Chrome's rows, in Chrome's order.
 *
 *  Worth a test for two reasons. The order is the whole point - a reader who knows
 *  Chrome's menu should find nib's in the same shape - and the zoom rows are the one
 *  place in the app where a row keeps the menu open and says a number that has to be
 *  true. See menu.ts. */

import { expect, test, vi } from 'vitest'

// The English string is its own key, so the labels read as themselves here.
vi.mock('../i18n.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n.svelte')>()),
  t: (one: string) => one,
}))

const { webRows, zoomed, ZOOMS } = await import('./menu')
const { Page } = await import('./pages.svelte')

/** A tab's page, on a site. */
function page(url: string | null) {
  const made = new Page()
  made.url = url
  return made
}

const actions = {
  newTab: () => undefined,
  bookmarks: () => undefined,
  zoom: () => undefined,
  fullScreen: () => undefined,
  print: () => undefined,
  save: () => undefined,
  share: () => undefined,
  settings: () => undefined,
}

/** Every row's label, with the rules between groups left out. */
function labels(url: string | null, zoom = 1): string[] {
  return webRows(page(url), zoom, actions).flatMap((one) => (one === null ? [] : [one.label]))
}

test('is Chromes own menu, in Chromes own order', () => {
  expect(labels('https://a.example/')).toEqual([
    'New tab',
    'Bookmarks',
    'Zoom out',
    '100%',
    'Zoom in',
    'Full screen',
    'Print…',
    'Save page',
    'Share…',
    'Copy link',
    'Open in the browser',
    'Settings',
  ])
})

test('the middle zoom row says how large the page is being drawn', () => {
  expect(labels('https://a.example/', 1.5)).toContain('150%')
  expect(labels('https://a.example/', 0.67)).toContain('67%')
})

/** A tab nobody has given an address yet has a menu, because New tab and Settings are
 *  still worth having; everything about the page is greyed out. */
test('a tab with nowhere to go has no rows about a page', () => {
  const rows = webRows(page(null), 1, actions).filter((one) => one !== null)
  const off = rows.filter((one) => one.disabled).map((one) => one.label)

  expect(off).toContain('Print…')
  expect(off).toContain('Save page')
  expect(off).toContain('Copy link')
  expect(rows.find((one) => one.label === 'New tab')?.disabled).toBe(undefined)
})

/** The zoom rows are the one kind in the app that keeps the menu open, because a
 *  browser's zoom is pressed two or three times in a row. */
test('the zoom rows keep the menu open and nothing else does', () => {
  const kept = webRows(page('https://a.example/'), 1, actions)
    .filter((one) => one !== null)
    .filter((one) => one.keep)
    .map((one) => one.label)

  expect(kept).toEqual(['Zoom out', '100%', 'Zoom in'])
})

test('steps along the ladder a browser steps along, and stops at both ends', () => {
  expect(zoomed(1, true)).toBe(1.1)
  expect(zoomed(1, false)).toBe(0.9)
  expect(zoomed(0.67, true)).toBe(0.75)
  expect(zoomed(ZOOMS[0]!, false)).toBe(ZOOMS[0])
  expect(zoomed(ZOOMS[ZOOMS.length - 1]!, true)).toBe(ZOOMS[ZOOMS.length - 1])
  // A size somebody arrived at another way still steps to the next rung.
  expect(zoomed(1.13, true)).toBe(1.25)
  expect(zoomed(1.13, false)).toBe(1.1)
})

test('ends the two ends of the ladder where a browser ends them', () => {
  expect(ZOOMS[0]).toBe(0.25)
  expect(ZOOMS.at(-1)).toBe(3)
  expect(ZOOMS).toContain(1)
})
