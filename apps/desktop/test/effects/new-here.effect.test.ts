import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import NewHere from '../../src/lib/NewHere.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** A pane with nothing open, and a new tab, and the cards that fill both.
 *
 *  Emil, 2026-09-14: *"it should be possible to have no note open (there should not
 *  always open a new one). Cause then there should just be options between the
 *  different note types which would then create the corresponding note if clicked
 *  (the corresponding button)."* workspace.test.ts asks whether anything is made when
 *  the last note closes; this asks what is then on screen, and whether a hand with no
 *  pointer can use it: the keyboard lands on the first button, so Enter is still the
 *  new note this used to make on its own, and the arrows walk the rest.
 *
 *  And issue #213: the same cards in a new tab under its address field, in three lines,
 *  each made by its letter - but never while the keyboard is in a field.
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
  // A pane, as Pane.svelte marks one: a letter is the cards' anywhere in it.
  target = document.createElement('div')
  target.dataset.pane = workspace.panes.focusedId
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
  vi.spyOn(workspace, 'newCanvas').mockImplementation(async () => void made.push('canvas'))
  vi.spyOn(workspace, 'openWebsite').mockImplementation(() => void made.push('web'))
  vi.spyOn(workspace, 'newPages').mockImplementation(async () => void made.push('pages'))
  vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

  return made
}

/** The empty state, in the pane that has the keyboard - or, with `chosenOn`, a new
 *  tab's. */
function here(chosenOn?: string) {
  const paneId = workspace.panes.focusedId
  const made = mount(NewHere, {
    target,
    props: chosenOn === undefined ? { paneId } : { paneId, chosenOn },
  })
  flushSync()
  close = () => void unmount(made, { outro: false })
}

const buttons = () => [...target.querySelectorAll<HTMLButtonElement>('button')]
const names = (within: ParentNode) =>
  [...within.querySelectorAll('.nib-row-label')].map((one) => one.textContent.trim())

/** A key pressed wherever the keyboard is, as a hand presses it. */
function press(key: string, held: KeyboardEventInit = {}) {
  const at = document.activeElement ?? document.body
  at.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }))
  flushSync()
}

test('offers every kind a new tab can be, in the lines Emil gave them', () => {
  makers()
  here()

  expect(names(target)).toEqual([
    'New note',
    'New canvas',
    'New page note',
    'Online terminal',
    'New web note',
  ])
  // A browser has no shell of its own, so the middle line is the online terminal alone.
  expect([...target.querySelectorAll('.line')].map(names)).toEqual([
    ['New note', 'New canvas', 'New page note'],
    ['Online terminal'],
    ['New web note'],
  ])
})

test('each wearing its letter, which a screen reader is told as its key', () => {
  makers()
  here()

  expect(buttons().map((one) => one.querySelector('kbd')?.textContent)).toEqual([
    'N',
    'C',
    'P',
    'O',
    'W',
  ])
  expect(buttons().map((one) => one.getAttribute('aria-keyshortcuts'))).toEqual([
    'N',
    'C',
    'P',
    'O',
    'W',
  ])
})

/** So Enter is the new note an empty pane used to make outright, and a hand that
 *  never touches the pointer is not slower than it was. */
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

  expect(made).toEqual(['note', 'canvas', 'pages', 'web'])
})

test('makes a kind by its letter, with the keyboard on a card', () => {
  const made = makers()
  here()

  expect(document.activeElement).toBe(buttons()[0])
  press('c')

  expect(made).toEqual(['canvas'])
})

test('and with the keyboard on nothing at all', () => {
  const made = makers()
  here()

  ;(document.activeElement as HTMLElement | null)?.blur()
  press('p')
  press('W', { shiftKey: true })

  expect(made).toEqual(['pages', 'web'])
})

/** *"these shortcuts should only work if you first click out of the url input"*: a
 *  letter typed into a field is the field's. And a chord is on its way to the window. */
test('but never in a field, nor under a modifier', () => {
  const made = makers()
  here()

  const field = document.createElement('input')
  target.prepend(field)
  field.focus()
  press('n')
  field.remove()

  buttons()[0]?.focus()
  press('n', { ctrlKey: true })
  press('n', { altKey: true })

  expect(made).toEqual([])
})

/** A new tab: its address field has the keyboard, and the kind chosen on it takes its
 *  place. See `chosenOn` in workspace.svelte.ts. */
test('in a new tab, leaves the keyboard where it was and says which tab the choice is on', () => {
  const made = makers()
  const chosen: string[] = []
  vi.spyOn(workspace, 'chosenOn').mockImplementation((id) => void chosen.push(id))
  vi.spyOn(workspace, 'showing').mockReturnValue({ id: 'new-tab' } as ReturnType<
    typeof workspace.showing
  >)
  here('new-tab')

  expect(target.contains(document.activeElement)).toBe(false)
  press('c')

  expect(made).toEqual(['canvas'])
  expect(chosen).toEqual(['new-tab'])
})

test('and hears no letter once that tab is not the one in front', () => {
  const made = makers()
  vi.spyOn(workspace, 'showing').mockReturnValue(null)
  here('new-tab')

  press('c')

  expect(made).toEqual([])
})

/** One tab stop for the group, which is what every other list in the app is: four
 *  buttons are not four stops between the strip and the note. See roving.ts. */
test('is one stop for Tab, whichever button the keyboard is on', () => {
  makers()
  here()

  expect(buttons().map((one) => one.tabIndex)).toEqual([0, -1, -1, -1, -1])
})
