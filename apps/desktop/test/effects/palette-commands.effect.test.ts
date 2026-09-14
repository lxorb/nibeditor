import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { overlays } from '../../src/lib/overlays'
import Palette from '../../src/lib/Palette.svelte'

/** The palette opened on the commands, which is what Ctrl+Shift+P does.
 *
 *  Emil asked for the key: "Ctrl + P is very very handy, I really like it. There
 *  should be another shortcut that is for commands (so you don't have to type > all
 *  the time, maybe Ctrl + Shift + P?)". shortcuts.test.ts asks whether the chord
 *  reaches the palette; this asks what the reader is then looking at, which is the
 *  whole of the design: a `>` in the field with the caret after it, exactly as if it
 *  had been typed, so deleting it is the way back to the notes and there is nothing
 *  new to learn.
 *
 *  In the jsdom project because a field, a value and a caret need a document.
 *  Nothing here asks about layout or paint, which is the one thing jsdom cannot do. */

/** The palette arrives with a transition, and Svelte plays one through the Web
 *  Animations API, which jsdom does not implement. Nothing here asks how it moves -
 *  that is paint, and a drive with a real browser is what looks at that - so the call
 *  answers something inert and the palette is simply there. */
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

/** The row the arrows are on is kept in view, and jsdom has no view to keep it in. */
Element.prototype.scrollIntoView = () => undefined

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

/** The palette, mounted shut, and the one thing the app calls on it. */
function palette(): { showCommands(): Promise<void> } {
  const made = mount(Palette, { target, props: { open: false } })
  flushSync()
  close = () => void unmount(made, { outro: false })

  return made as unknown as { showCommands(): Promise<void> }
}

const field = () => target.querySelector('input')

/** What somebody typing into it does, which is the only road the field's value
 *  travels: `bind:value` reads the input event. */
function type(text: string) {
  const input = field()
  if (!input) throw new Error('the palette has no field')

  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

test('opens on the commands, with the caret after the mark', async () => {
  const made = palette()
  expect(field()).toBeNull()

  await made.showCommands()
  flushSync()

  expect(field()?.value).toBe('>')
  // After the `>`, so the next keystroke is the search and not a second mark.
  expect(field()?.selectionStart).toBe(1)
  expect(field()?.selectionEnd).toBe(1)
})

test('puts the mark in front of what is already typed, and keeps the caret at the end', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  type('fold')
  await made.showCommands()
  flushSync()

  expect(field()?.value).toBe('>fold')
  expect(field()?.selectionStart).toBe(5)
})

test('puts it there once, however often the key is pressed', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  type('>fold')
  await made.showCommands()
  flushSync()
  await made.showCommands()
  flushSync()

  expect(field()?.value).toBe('>fold')
  expect(field()?.selectionStart).toBe(5)
})

/** A palette that was closed opens on an empty command search rather than on
 *  whatever was typed the time before, which is what dismissing it already
 *  promises. */
test('starts empty after it has been closed', async () => {
  const made = palette()
  await made.showCommands()
  flushSync()

  type('>fold')
  // Escape, the way the window hands one over: the palette closes through the overlay
  // stack like everything else the app puts over a note. See overlays.ts.
  overlays.escape()
  flushSync()

  await made.showCommands()
  flushSync()
  expect(field()?.value).toBe('>')
})
