/** A half-typed address, across a switch of windows.
 *
 *  Emil, 2026-09-30, of coming back to nib: the keyboard goes back where it was, and the
 *  address field is one of those places. The engine keeps the field focused while the
 *  window is away and says blur and focus to it all the same; the field used to take
 *  both for the reader leaving it, and came back with the whole address selected over
 *  what they had typed. Chrome's field keeps it, caret and all, while the page stays. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

const AddressField = (await import('../../src/lib/web-tab/AddressField.svelte')).default

const ADDRESS = 'https://example.com/page'

let target: HTMLElement
let app: ReturnType<typeof mount>
let address = ADDRESS

function field(): HTMLInputElement {
  const found = target.querySelector('input')
  if (!found) throw new Error('no field')
  return found
}

/** The field focused and a few letters typed over the address it offers. */
function typed(letters: string) {
  const box = field()
  box.focus()
  flushSync()
  box.value = letters
  box.setSelectionRange(2, 2)
  box.dispatchEvent(new InputEvent('input', { bubbles: true }))
  flushSync()
}

/** The window going away and coming back: the page is told blur and focus while the
 *  field stays the document's focused element throughout. */
function awayAndBack() {
  const box = field()
  box.dispatchEvent(new FocusEvent('blur'))
  flushSync()
  box.dispatchEvent(new FocusEvent('focus'))
  flushSync()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  address = ADDRESS
  app = mount(AddressField, {
    target,
    props: {
      resting: 'Example',
      get address() {
        return address
      },
      book: 'tests',
      onenter: () => undefined,
      ontyping: () => undefined,
    },
  })
  flushSync()
})

afterEach(() => {
  void unmount(app)
  target.remove()
})

test('comes back with what was typed and where the caret was', () => {
  typed('exa')
  awayAndBack()
  expect(field().value).toBe('exa')
  expect(field().selectionStart).toBe(2)
  expect(field().selectionEnd).toBe(2)
})

test('the reader leaving the field still puts its resting face back', () => {
  typed('exa')
  field().blur()
  flushSync()
  expect(field().value).toBe('Example')

  field().focus()
  flushSync()
  expect(field().value).toBe(ADDRESS)
})

test('nothing typed is the whole address again, selected', () => {
  field().focus()
  flushSync()
  awayAndBack()
  expect(field().value).toBe(ADDRESS)
  expect(field().selectionStart).toBe(0)
  expect(field().selectionEnd).toBe(ADDRESS.length)
})
