import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { EditorView } from '@nib/editor'
import FormatBar from '../../src/lib/FormatBar.svelte'
import { viewport } from '../../src/lib/viewport.svelte'

/** The bar a phone docks on its keys, and what it docks for.
 *
 *  Only the note it writes into: the keys come up for a name being changed in the
 *  file list or a card on a plane as well, and the bar acts on the note alone. It
 *  learns where the keyboard is from the page's focus events, and reads the answer
 *  a microtask later - a focus lost because Svelte took an element away is
 *  announced in the middle of Svelte's own update, where a rune may not be written,
 *  and Chromium threw there on every switch away from a note.
 *
 *  In the jsdom project because it mounts a component. */

// jsdom does no layout, so it has no observer for a box changing size. The bar asks
// for one to say how tall it stands over the note; here it never fires.
class NoLayout {
  observe() {
    // Said above.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

let target: HTMLElement
let note: HTMLElement
let field: HTMLInputElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  target = document.createElement('div')
  note = document.createElement('div')
  note.tabIndex = 0
  field = document.createElement('input')
  document.body.append(target, note, field)

  viewport.device = 'phone'
  viewport.typing = true
  shown = mount(FormatBar, {
    target,
    // The editor as much as the bar reads of it before a button is pressed.
    props: { view: { contentDOM: note } as EditorView },
  })
  flushSync()
})

afterEach(async () => {
  if (shown) await unmount(shown)
  shown = undefined
  viewport.device = 'desktop'
  viewport.typing = false
  document.body.replaceChildren()
})

/** A microtask for the bar's own reading, and a flush for what it draws. */
async function settled() {
  await Promise.resolve()
  await tick()
  flushSync()
}

const docked = () => target.querySelector('.nib-bar.docked') !== null

test('docks while the note has the keyboard', async () => {
  note.focus()
  await settled()

  expect(docked()).toBe(true)
})

test('and not for another field the keys came up for', async () => {
  note.focus()
  await settled()
  field.focus()
  await settled()

  expect(docked()).toBe(false)
})
