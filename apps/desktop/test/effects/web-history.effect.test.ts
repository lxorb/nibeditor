import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'

/** The History page, searched from far down its list.
 *
 *  Two thousand pages are drawn a screenful at a time, at the rows the scroll has
 *  reached (history-list.ts). A search typed with the list scrolled far down kept that
 *  scroll: the found rows were drawn from the bottom of what was found, the oldest
 *  first on screen, and the newest - what a search is for - above it out of sight.
 *  Chrome's starts every search at its top, and so does this.
 *
 *  In the jsdom project because the page is a component; jsdom lays nothing out, so
 *  the list's scroll is a number the test holds. */

/** `bind:clientHeight` listens through a ResizeObserver, which jsdom has not got. */
class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

const { default: WebHistory } = await import('../../src/lib/web-tab/WebHistory.svelte')

const BOOK = 'nib:web-visits:history-test'

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  const now = Date.now()
  const rows = Array.from({ length: 2000 }, (_, at) => ({
    url: `https://site${String(at)}.example.com/`,
    title: `${at % 2 ? 'Zeta' : 'Alpha'} page ${String(at)}`,
    visits: 1,
    typed: 0,
    last: now - at * 45 * 60 * 1000,
  }))
  localStorage.setItem(BOOK, JSON.stringify(rows))
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(WebHistory, {
    target,
    props: { book: BOOK, focused: false, onopen: () => undefined, onclear: () => undefined },
  })
  close = () => void unmount(made)
})

afterEach(() => {
  close?.()
  target.remove()
  localStorage.removeItem(BOOK)
})

const labels = () =>
  [...target.querySelectorAll('.history .page .nib-row-label')].map((one) => one.textContent)

test('a search starts at the top of what it found', async () => {
  const list = target.querySelector<HTMLElement>('.history .list')
  if (!list) throw new Error('no list')
  let top = 0
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => (top = value),
  })

  top = 40_000
  list.dispatchEvent(new Event('scroll'))
  flushSync()
  expect(labels()[0]).not.toBe('Alpha page 0')

  const field = target.querySelector<HTMLInputElement>('.history .find')
  if (!field) throw new Error('no field')
  field.value = 'zeta'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  await tick()
  flushSync()

  expect(top).toBe(0)
  expect(labels()[0]).toBe('Zeta page 1')
})
