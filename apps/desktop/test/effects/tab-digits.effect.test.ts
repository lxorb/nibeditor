/** Alt and a digit, from a press to the tab in front.
 *
 *  Emil, 2026-09-30: *"Add shortcuts alt + 1, alt + 2, ... where alt + x opens the tab
 *  at position x and alt + 0 opens the last tab."* The registry holds the keys and
 *  shortcuts.test.ts the matching; what only this can show is the whole road - a press
 *  in a real editor that CodeMirror lets by, App.svelte's rule about a spent press, the
 *  registry, and the strip of the pane being worked in.
 *
 *  In the jsdom project because the editor is a real one, and the press has to get past
 *  it the way it does in the window. */

import { createEditor, type EditorView } from '@nib/editor'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const NAMES = ['One', 'Two', 'Three', 'Four', 'Five']

// Windows, where AltGr is Ctrl and Alt: the one platform that question is asked on.
// Before anything is imported, because the store asks once, as it is made.
vi.hoisted(() => {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  })
})

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'read_note') return Promise.resolve(`# ${path}`)
    return Promise.resolve(undefined)
  },
}))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { roving } = await import('../../src/lib/roving')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')

/** What a thing this test does not care about does. */
function nothing() {
  return undefined
}

/** App.svelte's window handler, as it is written there: a press a surface has
 *  already answered is spent, and everything else goes to the registry. */
function windowHandler() {
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    shortcuts.handle(event, { view: undefined, palette: nothing, fullscreen: nothing })
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

/** A key pressed where the keyboard is, as the window would hear it. */
function pressOn(target: Element, key: string, held: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held })
  target.dispatchEvent(event)
  return event
}

/** Alt and a digit on the top row. */
const altDigit = (target: Element, digit: number) =>
  pressOn(target, String(digit), { altKey: true, code: `Digit${digit}` })

/** Which note is in front, by its name. */
const inFront = () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId)?.shown

let editor: EditorView | undefined
let unhandle: () => void

/** A note being written in, which is where a hand mostly is when it reaches for a tab. */
function writing() {
  const parent = document.createElement('div')
  document.body.append(parent)
  editor = createEditor({ parent, doc: 'Words' })
  return editor.contentDOM
}

beforeEach(async () => {
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.panes.collapse()
  for (const name of NAMES) await workspace.open(`/space/${name}.md`)
  unhandle = windowHandler()
})

afterEach(() => {
  unhandle()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  workspace.tabs = []
})

test('Alt+3 is the third tab and Alt+0 the last, from inside a note', () => {
  const note = writing()
  expect(inFront()).toBe('Five')

  const third = altDigit(note, 3)
  expect(inFront()).toBe('Three')
  expect(third.defaultPrevented).toBe(true)

  altDigit(note, 0)
  expect(inFront()).toBe('Five')

  altDigit(note, 1)
  expect(inFront()).toBe('One')

  // The note heard a chord, not a character.
  expect(editor?.state.doc.toString()).toBe('Words')
})

/** The file list walks on letters and answers Space, and a list that took a chord
 *  along with them made that chord dead there; see list-chords.effect.test.ts. */
test('Alt+2 is the second tab from the file list too', () => {
  const list = document.createElement('ul')
  const row = document.createElement('button')
  row.className = 'nib-row'
  row.textContent = 'Two'
  list.append(row)
  document.body.append(list)
  const action = roving(list)
  row.focus()

  const second = altDigit(row, 2)
  expect(inFront()).toBe('Two')
  expect(second.defaultPrevented).toBe(true)

  action.destroy?.()
})

test('a place past the end is nothing, as it is in Chrome', () => {
  const note = writing()
  altDigit(note, 2)

  const ninth = altDigit(note, 9)
  expect(inFront()).toBe('Two')
  // Still the app's key, so nothing else has it either.
  expect(ninth.defaultPrevented).toBe(true)
})

test('the ninth is the ninth, not the last', async () => {
  for (const name of ['Six', 'Seven', 'Eight', 'Nine', 'Ten']) {
    await workspace.open(`/space/${name}.md`)
  }

  altDigit(document.body, 9)
  expect(inFront()).toBe('Nine')
  altDigit(document.body, 0)
  expect(inFront()).toBe('Ten')
})

test('a pinned tab counts, where the strip puts it', () => {
  const five = workspace.tabs.find((tab) => tab.shown === 'Five')
  if (five) workspace.togglePin(five.id)

  altDigit(document.body, 1)
  expect(inFront()).toBe('Five')
  altDigit(document.body, 2)
  expect(inFront()).toBe('One')
})

test('AltGr typing a character is the character, not a tab', () => {
  const note = writing()
  altDigit(note, 1)

  // A Swiss `@`, which Windows says as Ctrl, Alt and the 2.
  const at = pressOn(note, '@', { ctrlKey: true, altKey: true, code: 'Digit2' })
  expect(inFront()).toBe('One')
  expect(at.defaultPrevented).toBe(false)
})

test('a press an input method is composing is its own', () => {
  const note = writing()
  altDigit(note, 1)

  pressOn(note, '3', { altKey: true, code: 'Digit3', isComposing: true })
  expect(inFront()).toBe('One')
})

test('Ctrl+Alt and a digit are still there beside it', () => {
  pressOn(document.body, '4', { ctrlKey: true, altKey: true, code: 'Digit4' })
  expect(inFront()).toBe('Four')
})
