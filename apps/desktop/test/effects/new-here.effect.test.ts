import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import NewHere from '../../src/lib/NewHere.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** A pane with nothing open, and the buttons that fill it.
 *
 *  Emil, 2026-09-14: *"it should be possible to have no note open (there should not
 *  always open a new one). Cause then there should just be options between the
 *  different note types which would then create the corresponding note if clicked
 *  (the corresponding button)."* workspace.test.ts asks whether anything is made when
 *  the last note closes; this asks what is then on screen, and whether a hand with no
 *  pointer can use it: the keyboard lands on the first button, so Enter is still the
 *  new note this used to make on its own, and the arrows walk the rest.
 *
 *  In the jsdom project because buttons, focus and a keydown need a document. Nothing
 *  here asks about layout or paint, which is the one thing jsdom cannot do. */

/** The buttons rise as the pane empties, and Svelte plays that through the Web
 *  Animations API, which jsdom does not implement. Nothing here asks how they move. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

/** The row the keyboard lands on is kept in view, and jsdom has no view. */
Element.prototype.scrollIntoView = () => undefined

let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
})

/** Every maker stood in for, so nothing here writes a file. */
function makers(): string[] {
  const made: string[] = []

  vi.spyOn(workspace, 'openBlank').mockImplementation(() => void made.push('note'))
  vi.spyOn(workspace, 'createCanvas').mockImplementation(async () => void made.push('canvas'))
  vi.spyOn(workspace, 'createWebsite').mockImplementation(async () => void made.push('web'))
  vi.spyOn(workspace, 'createPages').mockImplementation(async () => void made.push('pages'))
  vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

  return made
}

/** The empty state, in the pane that has the keyboard. */
function here() {
  const made = mount(NewHere, { target, props: { paneId: workspace.panes.focusedId } })
  flushSync()
  close = () => void unmount(made, { outro: false })
}

const buttons = () => [...target.querySelectorAll<HTMLButtonElement>('button')]

test('offers every kind a new tab can be, in the order the plus offers them', () => {
  makers()
  here()

  expect(buttons().map((one) => one.textContent?.trim())).toEqual([
    'New note',
    'New canvas',
    'New web note',
    'New page note',
  ])
})

/** So Ctrl+T, Enter is the new note it used to make outright, and a hand that never
 *  touches the pointer is not slower than it was. */
test('lands the keyboard on the first of them', () => {
  makers()
  here()

  expect(document.activeElement).toBe(buttons()[0])
})

test('and the arrows walk the rest', () => {
  makers()
  here()

  const first = buttons()[0]
  first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  flushSync()

  expect(document.activeElement).toBe(buttons()[1])
})

test('makes its own kind when one is pressed', () => {
  const made = makers()
  here()

  for (const one of buttons()) one.click()
  flushSync()

  expect(made).toEqual(['note', 'canvas', 'web', 'pages'])
})

/** One tab stop for the group, which is what every other list in the app is: four
 *  buttons are not four stops between the strip and the note. See roving.ts. */
test('is one stop for Tab, whichever button the keyboard is on', () => {
  makers()
  here()

  expect(buttons().map((one) => one.tabIndex)).toEqual([0, -1, -1, -1])
})
