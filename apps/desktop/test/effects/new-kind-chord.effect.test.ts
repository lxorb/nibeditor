/** Ctrl held, T pressed, Ctrl let go - all the way from the window to a new tab.
 *
 *  Emil, 2026-09-17: *"When we press Ctrl + T, release T and hold Ctrl, there should
 *  be a modal open where there are the different options. [...] While holding Ctrl, we
 *  can switch to the next one by pressing T. When we let go of Ctrl, then the current
 *  one is chosen."* And 2026-09-27: *"Ctrl + T should always open a webpage by
 *  default. And that should always be the selected option in the modal when holding
 *  the Ctrl."*
 *
 *  Every piece of this has a test of its own - the steps and the default are arithmetic
 *  in new-kind-choice.test.ts, the modifier is a word in keys.test.ts, the list is
 *  new-kinds.test.ts - and not one of them would have caught the gesture being wrong,
 *  because a gesture is the pieces in order. That is the lesson list-chords.effect.ts
 *  was written for and this file is the same shape: the real window handler as
 *  App.svelte writes it, the real registry, the real dialog mounted and drawn, and
 *  real `keydown` and `keyup` events with the modifiers on them.
 *
 *  In the jsdom project because focus, a dialog and a keystroke need a document.
 *  Nothing here asks about layout or paint. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { newKindChord } from '../../src/lib/new-kind-chord'
import { newKindSheet } from '../../src/lib/new-kind-sheet.svelte'
import NewKindSheet from '../../src/lib/NewKindSheet.svelte'
import { overlays } from '../../src/lib/overlays'
import { shortcuts } from '../../src/lib/shortcuts.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { replay } from '../../src/lib/web-tab/keys'
import { workspace } from '../../src/lib/workspace.svelte'

/** Svelte plays its transitions through the Web Animations API, which jsdom has
 *  not got. Nothing here asks how the dialog arrives. */
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

/** The beat the dialog waits out before it draws itself; see BEAT in
 *  new-kind-chord.ts. The timer is the one the app sets, on a clock these tests move
 *  by hand: a real one let a busy machine decide which of two timers went first, and
 *  cost every test a quarter of a second of nothing. */
const BEAT = 200

let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'

/** App.svelte's own window handler, in the order it is written there: Escape closes
 *  the layer on top, then the chord gets its look at the press, then the registry. The
 *  app reaches the chord through surfaces.svelte.ts, which holds it once it has landed;
 *  this calls the landed thing itself, which is the same function. */
function windowHandler() {
  const handler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && overlays.escape(event)) return
    if (newKindChord(event)) return
    shortcuts.handle(event, {
      view: undefined,
      palette: () => undefined,
      fullscreen: () => undefined,
    })
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

let unhandle: () => void

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  was = viewport.device
  viewport.device = 'desktop'
  target = document.createElement('div')
  document.body.append(target)
  close = (() => {
    const drawn = mount(NewKindSheet, { target })
    return () => void unmount(drawn, { outro: false })
  })()
  unhandle = windowHandler()
})

afterEach(() => {
  // Anything still held goes, so one test's hand is never on the next one's keyboard.
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
  newKindSheet.dismiss()
  flushSync()
  unhandle()
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** A press of the chord, as a keyboard sends one. `code` as well as `key`, which is
 *  what the matcher reads on a layout that needs Shift for the character. */
function pressT(held: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 't',
    code: 'KeyT',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...held,
  })
  window.dispatchEvent(event)
  flushSync()
  return event
}

/** A key pressed where the keyboard is, which once the dialog is up is its card: the
 *  press reaches the dialog first and the window after, the way a real one does. */
function press(key: string, held: Partial<KeyboardEventInit> = {}) {
  const on = document.activeElement ?? document.body
  on.dispatchEvent(
    new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...held }),
  )
  flushSync()
}

function letGo() {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
  flushSync()
}

/** Long enough for the beat to go off and the dialog to be drawn. */
async function settle() {
  await vi.advanceTimersByTimeAsync(BEAT)
  flushSync()
}

const dialog = () => document.querySelector('[role="dialog"]')
const cards = () =>
  [...document.querySelectorAll('[role="dialog"] .nib-row-label')].map((one) =>
    one.textContent.trim(),
  )
/** The card the keyboard is on, by its name. */
const standing = () =>
  document.activeElement?.querySelector('.nib-row-label')?.textContent.trim() ?? null
/** The card that is lit, which has to be the same one. */
const lit = () => document.querySelector('.is-on .nib-row-label')?.textContent.trim() ?? null

test('holding the modifier opens the dialog, on the web page', async () => {
  makers()

  pressT()
  await settle()

  expect(cards()).toEqual([
    'New note',
    'New canvas',
    'New web note',
    'New page note',
    'Online terminal',
  ])
  expect(standing()).toBe('New web note')
  expect(lit()).toBe('New web note')

  letGo()
})

/** Every time, whatever was made before: the chord no longer remembers. */
test('and on the web page again after something else was made', async () => {
  const made = makers()

  pressT()
  await settle()
  pressT()
  letGo()
  expect(made).toEqual(['pages'])

  pressT()
  await settle()
  expect(standing()).toBe('New web note')
  letGo()
})

test('each further press steps one along, and the release makes that one', async () => {
  const made = makers()

  pressT()
  await settle()

  pressT()
  expect(standing()).toBe('New page note')
  pressT()
  expect(standing()).toBe('Online terminal')
  pressT()
  expect(standing()).toBe('New note')
  expect(lit()).toBe('New note')

  letGo()
  expect(made).toEqual(['note'])
  // The dialog goes with the hand that was holding it. Asked of the store rather than
  // the page, where it is still playing its way out.
  expect(newKindSheet.open).toBe(false)
})

/** The one thing a switcher has to get right that nothing else does. A key held down
 *  repeats, and those keystrokes are the same press arriving again: stepping on them
 *  would spin the selection under a finger that has simply not lifted. Nothing but
 *  `event.repeat` can tell them from a fast second press. */
test('a repeat is not a second press', async () => {
  makers()

  pressT()
  await settle()
  pressT({ repeat: true })
  pressT({ repeat: true })
  pressT({ repeat: true })

  expect(standing()).toBe('New web note')
  letGo()
})

/** Which is what Alt+Tab does, and the hand is already on the modifier. While the
 *  dialog is up it is a layer over the app and its own keys win, so the Reopen closed
 *  tab this shadows is only shadowed for as long as somebody is holding it. */
test('Shift steps back', async () => {
  const made = makers()

  pressT()
  await settle()
  pressT({ shiftKey: true })

  expect(standing()).toBe('New canvas')
  letGo()
  expect(made).toEqual(['canvas'])
})

test('the arrows step too, with the modifier still down', async () => {
  const made = makers()

  pressT()
  await settle()
  press('ArrowLeft')
  press('ArrowLeft')
  expect(standing()).toBe('New note')
  press('ArrowRight')
  expect(lit()).toBe('New canvas')

  letGo()
  expect(made).toEqual(['canvas'])
})

/** A second press before the beat is somebody looking rather than tapping: the dialog
 *  comes up at once, and already one along. */
test('a second press inside the beat draws it at once, one along', () => {
  makers()

  pressT()
  expect(dialog()).toBeNull()
  pressT()

  expect(dialog()).not.toBeNull()
  expect(standing()).toBe('New page note')
  letGo()
})

/** A card's own letter makes it outright, and the release that follows is a hand
 *  letting go of nothing. */
test('a letter makes its kind, and the release makes nothing more', async () => {
  const made = makers()

  pressT()
  await settle()
  press('c')

  expect(made).toEqual(['canvas'])
  expect(newKindSheet.open).toBe(false)
  letGo()
  expect(made).toEqual(['canvas'])
})

test('Escape closes it and makes nothing, and the release that follows makes nothing either', async () => {
  const made = makers()

  pressT()
  await settle()
  expect(dialog()).not.toBeNull()

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  flushSync()

  expect(newKindSheet.open).toBe(false)
  letGo()
  expect(made).toEqual([])
})

test('a click chooses the card it lands on, and the release after it makes nothing', async () => {
  const made = makers()

  pressT()
  await settle()
  const card = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')][3]
  card?.click()
  flushSync()

  expect(made).toEqual(['pages'])
  letGo()
  expect(made).toEqual(['pages'])
})

/** A tap of the chord, which is what a browser answers with a new tab. Down and up
 *  inside the beat: nothing is drawn at all, and a web page is made. */
test('a tap makes a web page and never draws the dialog', async () => {
  const made = makers()

  pressT()
  letGo()

  expect(made).toEqual(['web'])
  expect(dialog()).toBeNull()
  // And the beat that was armed does not go off behind it.
  await settle()
  expect(dialog()).toBeNull()
})

/** A website is a bookmark on a phone, opened in the phone's own browser, so there is
 *  no web tab to make: a note is what a tap makes there, and where the dialog opens. */
test('a phone makes a note, and opens the dialog on one', async () => {
  const made = makers()
  viewport.device = 'phone'

  pressT()
  letGo()
  expect(made).toEqual(['note'])

  pressT()
  await settle()
  expect(cards()).toEqual(['New note', 'New canvas', 'New page note', 'Online terminal'])
  expect(standing()).toBe('New note')
  letGo()
})

/** The palette and a Mac's File menu have no modifier to hold: the same dialog, on the
 *  same card, chosen with a key or a click. */
test('opened by a command it waits for a choice', () => {
  const made = makers()

  newKindSheet.show()
  flushSync()
  expect(standing()).toBe('New web note')

  press('ArrowRight', { ctrlKey: false })
  press('Enter', { ctrlKey: false })

  expect(made).toEqual(['pages'])
  expect(newKindSheet.open).toBe(false)
})

/** A dialog already up - the palette's, or one a press opened before the chord had
 *  landed - is found rather than started again: the press steps it, and letting go
 *  makes what stands, rather than the dialog jumping back to the web page under the
 *  hand. */
test('over a dialog that is already up, the chord steps it and the release chooses', () => {
  const made = makers()

  newKindSheet.show()
  flushSync()
  pressT()
  expect(standing()).toBe('New page note')

  letGo()
  expect(made).toEqual(['pages'])
})

/** Emil, 2026-09-27: *"if I press Ctrl+T right now while I'm in a browser window,
 *  nothing happens."* The crate takes the chord from the page and the window plays it
 *  on itself, and the release of Ctrl the same way when it happened in the page; see
 *  web-tab/keys.ts. Nothing about the chord knows where the key came from. */
test('a chord pressed inside a web page is the same chord', async () => {
  const made = makers()
  const inPage = (key: string, code: string, ctrl: boolean, down: boolean) => {
    replay({ key, code, ctrl, shift: false, alt: false, repeat: false, down })
    flushSync()
  }

  inPage('t', 'KeyT', true, true)
  inPage('Control', 'ControlLeft', false, false)
  expect(made).toEqual(['web'])

  inPage('t', 'KeyT', true, true)
  await settle()
  expect(standing()).toBe('New web note')
  inPage('t', 'KeyT', true, true)
  expect(standing()).toBe('New page note')
  inPage('Control', 'ControlLeft', false, false)
  expect(made).toEqual(['web', 'pages'])
})

/** The window's own handler gives way to a press something else has spent, and so
 *  does this: the rule the whole app follows. See `handle` in shortcuts.svelte.ts. */
test('a press another surface has answered is not this chord', () => {
  makers()

  const event = new KeyboardEvent('keydown', {
    key: 't',
    code: 'KeyT',
    ctrlKey: true,
    cancelable: true,
  })
  event.preventDefault()

  expect(newKindChord(event)).toBe(false)
})
