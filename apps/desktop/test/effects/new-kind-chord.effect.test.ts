/** Ctrl held, T pressed, Ctrl let go - all the way from the window to a new tab.
 *
 *  Emil, 2026-09-17: *"When we press Ctrl + T, release T and hold Ctrl, there should
 *  be a modal open where there are the different options. The last chosen one should
 *  be selected already. While holding Ctrl, we can switch to the next one by pressing
 *  T. When we let go of Ctrl, then the current one is chosen."*
 *
 *  Every piece of this has a test of its own - the step is arithmetic in
 *  last-kind.test.ts, the modifier is a word in keys.test.ts, the list is
 *  new-kinds.test.ts - and not one of them would have caught the gesture being wrong,
 *  because a gesture is the pieces in order. That is the lesson list-chords.effect.ts
 *  was written for and this file is the same shape: the real window handler as
 *  App.svelte writes it, the real registry, the real chooser mounted and drawn, and
 *  real `keydown` and `keyup` events with the modifiers on them.
 *
 *  In the jsdom project because focus, a menu and a keystroke need a document. Nothing
 *  here asks about layout or paint. */

import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ContextMenu from '../../src/lib/ContextMenu.svelte'
import { menu } from '../../src/lib/menu.svelte'
import { newKindChord } from '../../src/lib/new-kind-chord'
import { overlays } from '../../src/lib/overlays'
import { shortcuts } from '../../src/lib/shortcuts.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** Svelte plays its transitions through the Web Animations API, which jsdom has
 *  not got. Nothing here asks how the menu arrives. */
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

Element.prototype.scrollIntoView = () => undefined

/** `CSS.escape` is in every browser and in the webview the app ships in, and is not
 *  in jsdom at all. The chooser asks for a pane by id through it; see paneBox in
 *  focus.ts. Nothing here has an id that needs escaping, so the plain string will do
 *  for what is being asked. */
if (typeof CSS === 'undefined') {
  vi.stubGlobal('CSS', { escape: (text: string) => text })
}

/** The beat the chooser waits out before it draws itself; see BEAT in
 *  new-kind-chord.ts. Waited through for real rather than faked, because the chooser
 *  is fetched when its key is pressed and a fake clock does not resolve an import. */
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
  was = viewport.device
  viewport.device = 'desktop'
  localStorage.clear()
  target = document.createElement('div')
  document.body.append(target)
  close = (() => {
    const drawn = mount(ContextMenu, { target })
    return () => void unmount(drawn, { outro: false })
  })()
  unhandle = windowHandler()
})

afterEach(() => {
  // Anything still held goes, so one test's hand is never on the next one's keyboard.
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
  menu.hide()
  unhandle()
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
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
  return event
}

function letGo() {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
}

/** Long enough for the chooser to be fetched, drawn and stood on. */
async function settle(ms = BEAT + 120) {
  await new Promise((done) => setTimeout(done, ms))
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.menu [role="menuitem"]')]
const standing = () => document.activeElement?.textContent.trim() ?? null

test('holding the modifier opens the chooser, on the kind that was chosen last', async () => {
  makers()
  localStorage.setItem('nib:new-kind', 'canvas')

  pressT()
  await settle()

  expect(rows().map((one) => one.textContent.trim())).toEqual([
    'New note',
    'New canvas',
    'New web note',
    'New page note',
  ])
  expect(standing()).toBe('New canvas')

  letGo()
})

test('each further press steps one along, and the release makes that one', async () => {
  const made = makers()

  pressT()
  await settle()
  expect(standing()).toBe('New note')

  pressT()
  pressT()
  await settle(60)
  expect(standing()).toBe('New web note')

  letGo()
  expect(made).toEqual(['web'])
  // The chooser goes with the hand that was holding it.
  expect(menu.open).toBe(false)
})

/** The one thing a switcher has to get right that nothing else does. A key held down
 *  repeats, and those keystrokes are the same press arriving again: stepping on them
 *  would spin the selection under a finger that has simply not lifted. Nothing but
 *  `event.repeat` can tell them from a fast second press. */
test('a repeat is not a second press', async () => {
  makers()

  pressT()
  await settle()
  expect(standing()).toBe('New note')

  pressT({ repeat: true })
  pressT({ repeat: true })
  pressT({ repeat: true })
  await settle(60)

  expect(standing()).toBe('New note')
  letGo()
})

test('it wraps round the end', async () => {
  const made = makers()

  pressT()
  await settle()
  for (let step = 0; step < 4; step++) pressT()
  await settle(60)

  expect(standing()).toBe('New note')
  letGo()
  expect(made).toEqual(['note'])
})

/** Which is what Alt+Tab does, and the hand is already on the modifier. While the
 *  chooser is up it is a layer over the app and its own keys win, so the Reopen
 *  closed tab this shadows is only shadowed for as long as somebody is holding it. */
test('Shift steps back', async () => {
  const made = makers()

  pressT()
  await settle()
  pressT({ shiftKey: true })
  await settle(60)

  expect(standing()).toBe('New page note')
  letGo()
  expect(made).toEqual(['pages'])
})

test('Escape closes it and makes nothing, and the release that follows makes nothing either', async () => {
  const made = makers()

  pressT()
  await settle()
  expect(menu.open).toBe(true)

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await settle(60)

  expect(menu.open).toBe(false)
  letGo()
  expect(made).toEqual([])
})

/** A tap of the chord, which is what a browser answers with a new tab. Down and up
 *  inside the beat: nothing is drawn at all, and the kind that stands is made. */
test('a tap makes the kind that stands and never draws the chooser', async () => {
  const made = makers()
  localStorage.setItem('nib:new-kind', 'pages')

  pressT()
  await settle(40)
  expect(menu.open).toBe(false)

  // The list is fetched rather than carried in front of the first paint, so a tap
  // makes its tab a tick later; see the budget in test/weight.test.ts.
  letGo()
  await settle()

  expect(made).toEqual(['pages'])
  // And the beat that was armed does not go off behind it.
  expect(menu.open).toBe(false)
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
