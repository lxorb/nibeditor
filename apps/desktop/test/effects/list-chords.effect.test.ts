/** A chord pressed while the keyboard is in a list, all the way to its command.
 *
 *  The bug this file is here to keep from coming back. Ctrl+Shift+Space opens the
 *  space switcher, and from the file tree it opened nothing at all: focus stayed on
 *  the row, Tab walked away, Escape did nothing. Every piece of it tested clean on its
 *  own - the parser reads `Mod-Shift-Space`, the matcher answers a real
 *  Ctrl+Shift+Space, the registry binds it to `space.switcher` - because no test ever
 *  put the two ends together.
 *
 *  What was between them is roving.ts, the action every `.nib-row` list in the app is
 *  drawn with. It answered `case ' ':` off `event.key` alone and called
 *  `preventDefault`, and App.svelte's window handler gives way to a press something
 *  else has already spent. So the list ate the chord. Not only that one: the same
 *  switch claims Enter, Delete, Backspace and Escape the same way, and a list with no
 *  `keyOf` of its own read the arrows off the event too, which is Alt+Left - back -
 *  dead in every panel the app has.
 *
 *  So this drives the real path: the real action on a real list, the real registry,
 *  and App.svelte's own rule about a spent press. The command it lands on opens the
 *  tree panel on its way to the sidebar's switcher, and that is what is asserted; see
 *  `openSpaces` in focus.ts. */

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { roving } from '../../src/lib/roving'
import { shortcuts } from '../../src/lib/shortcuts.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** What a thing this test does not care about does. */
function nothing() {
  return undefined
}

/** A list of rows, drawn the way every panel in the app draws one. */
function list(options: Parameters<typeof roving>[1] = {}) {
  const node = document.createElement('ul')
  for (const name of ['Kestrel', 'Read me']) {
    const row = document.createElement('button')
    row.className = 'nib-row'
    row.textContent = name
    node.append(row)
  }

  document.body.append(node)
  const action = roving(node, options)

  return {
    node,
    row: node.querySelector('button')!,
    stop: () => {
      action.destroy?.()
      node.remove()
    },
  }
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

function pressOn(row: HTMLElement, key: string, held: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...held,
  })
  row.dispatchEvent(event)
  return event
}

let unhandle: () => void

beforeEach(() => {
  // The walk keeps the row it lands on in view, and jsdom does no layout and so has
  // no way to scroll. Nothing here asks where a row ended up.
  HTMLElement.prototype.scrollIntoView = nothing
  workspace.panel = null
  unhandle = windowHandler()
})

afterEach(() => {
  unhandle()
  workspace.panel = null
})

test('a list hands Ctrl+Shift+Space on, and the space switcher opens', () => {
  const peek = vi.fn()
  const { row, stop } = list({ peek })
  row.focus()

  const event = pressOn(row, ' ', { ctrlKey: true, shiftKey: true, code: 'Space' })

  // The list left it alone: it is not the list's Space.
  expect(peek).not.toHaveBeenCalled()
  // And so the window's handler saw an unspent press and ran the command. The
  // switcher is in the sidebar's header, so the command asks for the tree first.
  expect(workspace.panel).toBe('tree')
  // The registry stopped it, which is the sign that something answered at all.
  expect(event.defaultPrevented).toBe(true)

  stop()
})

test('and the bare space bar is still the list opening the row it is on', () => {
  const peek = vi.fn()
  const { row, stop } = list({ peek })
  row.focus()

  const event = pressOn(row, ' ', { code: 'Space' })

  expect(peek).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
  expect(workspace.panel).toBeNull()

  stop()
})

/** The other half of the same rule, and the one nobody would have noticed: a list
 *  with no walk of its own in the registry read the arrows off the event, so it took
 *  Alt+Up and Alt+Down - which are the two keys that move a line - with them. */
test('a list walks on its own arrows and not on a chord that holds one', () => {
  const { node, row, stop } = list()
  const [first, second] = [...node.querySelectorAll<HTMLElement>('button')]
  row.focus()

  pressOn(row, 'ArrowDown')
  expect(document.activeElement).toBe(second)

  // The chord goes past the list to the window, which is what its own handler is
  // there to answer; the list itself does not move.
  pressOn(second!, 'ArrowUp', { altKey: true })
  expect(document.activeElement).toBe(second)
  expect(document.activeElement).not.toBe(first)

  stop()
})

/** Shift is not one of the modifiers that makes a chord, because a list's own menu
 *  key is Shift+F10. */
test('the menu key still belongs to the list', () => {
  const menu = vi.fn()
  const { row, stop } = list({ menu })
  row.focus()

  pressOn(row, 'F10', { shiftKey: true })
  expect(menu).toHaveBeenCalledOnce()

  stop()
})
