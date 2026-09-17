import { afterEach, beforeEach, expect, test } from 'vitest'
import { roving } from '../../src/lib/roving'

/** What a list does with a press that has a chord on it.
 *
 *  Every `.nib-row` list in the app walks with the arrows, opens with Enter and Space
 *  and deletes with Delete - the four keys `fixed.lists` in the shortcut registry says
 *  nobody may rebind, and so the four the list reads straight off the event rather
 *  than through the registry. Which meant a chord ending in one of them was answered
 *  by the list and went no further: pressing Ctrl+Shift+Space with the keyboard in the
 *  file list opened the row it was on instead of the space switcher.
 *
 *  Shift on its own is not a chord here. Shift+F10 is the context-menu key, which
 *  every list answers.
 *
 *  In the jsdom project because a keydown needs a document and the action needs a
 *  node to attach to. */

let host: HTMLElement
let stop: (() => void) | undefined

/** The rows a press landed on, as the list answered them. */
let opened: (string | null)[]
let peeked: (string | null)[]
let removed: (string | null)[]
let menued: (string | null)[]

function list() {
  host = document.createElement('div')
  host.innerHTML = '<button class="nib-row">one</button><button class="nib-row">two</button>'
  document.body.append(host)

  const action = roving(host, {
    rows: '.nib-row',
    open: (row) => opened.push(row.textContent),
    peek: (row) => peeked.push(row.textContent),
    remove: (row) => removed.push(row.textContent),
    menu: (row) => menued.push(row.textContent),
  })
  stop = () => action.destroy?.()

  const first = host.querySelector('.nib-row')
  if (!(first instanceof HTMLElement)) throw new Error('the list drew no rows')

  return first
}

/** A press on a row, with whatever is held down. */
function press(row: HTMLElement, key: string, held: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held })
  row.dispatchEvent(event)
  return event
}

beforeEach(() => {
  opened = []
  peeked = []
  removed = []
  menued = []
})

afterEach(() => {
  stop?.()
  stop = undefined
  host.remove()
})

test('a plain press is the list’s own', () => {
  const row = list()

  press(row, 'Enter')
  press(row, ' ')
  press(row, 'Delete')

  expect(opened).toEqual(['one'])
  expect(peeked).toEqual(['one'])
  expect(removed).toEqual(['one'])
})

test('and a chord is the app’s, so the list neither answers it nor stops it', () => {
  const row = list()

  const chords = [
    press(row, ' ', { ctrlKey: true, shiftKey: true }),
    press(row, 'Enter', { ctrlKey: true }),
    press(row, 'Delete', { altKey: true }),
    press(row, 'Backspace', { metaKey: true }),
  ]

  expect(opened).toEqual([])
  expect(peeked).toEqual([])
  expect(removed).toEqual([])
  expect(chords.map((one) => one.defaultPrevented)).toEqual([false, false, false, false])
})

test('but Shift is not a chord: Shift+F10 is still the menu key', () => {
  const row = list()

  press(row, 'F10', { shiftKey: true })

  expect(menued).toEqual(['one'])
})
