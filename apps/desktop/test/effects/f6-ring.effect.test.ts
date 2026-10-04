import { afterEach, beforeEach, expect, test } from 'vitest'
import { stepRegionFocus } from '../../src/lib/focus'

/** F6 past a region that is there and cannot hold the keyboard.
 *
 *  access.py found the walk standing still on the status bar: the right side, shut,
 *  keeps its box for the slide back in and waits inert and hidden, and a focus put
 *  there went nowhere while the walk counted it as a step. The ring is regions.ts
 *  and has its own tests; this is the half that touches the page.
 *
 *  In the jsdom project because it is the page's focus. jsdom lays nothing out, so
 *  every box here says it has one. */

Element.prototype.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList

let page: HTMLElement

/** A region with one button in it, the way the sidebar's header is one. */
function region(name: string, ...marks: string[]): HTMLElement {
  const box = document.createElement('div')
  box.dataset.region = name
  for (const mark of marks) box.setAttribute(mark, '')
  const button = document.createElement('button')
  button.textContent = name
  box.append(button)
  page.append(box)
  return box
}

const here = () => document.activeElement?.closest<HTMLElement>('[data-region]')?.dataset.region

beforeEach(() => {
  page = document.createElement('div')
  document.body.append(page)
})

afterEach(() => {
  page.remove()
})

test('a shut right side is stepped over, and the walk goes round', () => {
  region('space')
  region('editor')
  const status = region('status')
  region('right', 'inert').style.visibility = 'hidden'

  status.querySelector('button')?.focus()
  expect(stepRegionFocus(1)).toBe(true)
  expect(here()).toBe('space')
  expect(stepRegionFocus(-1)).toBe(true)
  expect(here()).toBe('status')
})

test.each([
  ['only hidden', (box: HTMLElement) => (box.style.visibility = 'hidden')],
  ['only inert', (box: HTMLElement) => box.setAttribute('inert', '')],
])('one that is %s is stepped over too', (_, shut) => {
  region('editor')
  region('status')
  shut(region('right'))

  page.querySelector<HTMLElement>('[data-region=status] button')?.focus()
  expect(stepRegionFocus(1)).toBe(true)
  expect(here()).toBe('editor')
})

test('an open right side is where F6 goes after the status bar', () => {
  region('editor')
  region('status')
  region('right')

  page.querySelector<HTMLElement>('[data-region=status] button')?.focus()
  expect(stepRegionFocus(1)).toBe(true)
  expect(here()).toBe('right')
})
