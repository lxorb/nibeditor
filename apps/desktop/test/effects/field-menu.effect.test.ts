/** A text field's own menu: what it offers, and that the field keeps the keyboard
 *  while it is up.
 *
 *  The second half is the one that matters. Every other menu in the app takes the
 *  keyboard when it opens and hands it back when it closes, and three of the fields
 *  this menu is for act on losing it: a name being renamed commits, the address field
 *  puts the page's own address back, the find bar's matches go. So this menu is walked
 *  from the field instead - the arrows light a row, Enter chooses it, Escape closes -
 *  and a row pressed with the mouse does not take the focus either. See field-menu.ts
 *  and ContextMenu.svelte.
 *
 *  In the jsdom project because it mounts the menu and presses real keys. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import ContextMenu from '../../src/lib/ContextMenu.svelte'
import { fieldEntries, textFieldOf } from '../../src/lib/field-menu'
import { menu, type MenuItem } from '../../src/lib/menu.svelte'

/** jsdom has no animations, and the menu grows out of its corner. */
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

let field: HTMLInputElement
let host: HTMLElement
let shown: ReturnType<typeof mount> | undefined

/** What `document.execCommand` was asked for, since jsdom carries out none of it. */
let commands: string[]

beforeEach(() => {
  commands = []
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- standing in for the command the app calls
  document.execCommand = (command: string) => {
    commands.push(command)
    return command !== 'insertText'
  }

  field = document.createElement('input')
  field.value = 'hello world'
  document.body.append(field)
  field.focus()
  field.setSelectionRange(0, 5)

  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  menu.hide()
  flushSync()
  if (shown) void unmount(shown)
  shown = undefined
  field.remove()
  host.remove()
})

function rows(entries = fieldEntries(field)): MenuItem[] {
  return entries.filter((one): one is MenuItem => one !== null)
}

function open() {
  shown = mount(ContextMenu, { target: host })
  menu.show(new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }), fieldEntries(field), {
    keepFocus: true,
  })
  flushSync()
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  field.dispatchEvent(event)
  flushSync()
  return event
}

describe('which targets are text fields', () => {
  test('a line, a search, an address, a password and a paragraph are', () => {
    for (const type of ['text', 'search', 'url', 'password', 'email']) {
      const one = document.createElement('input')
      one.type = type
      expect(textFieldOf(one)).toBe(one)
    }
    const area = document.createElement('textarea')
    expect(textFieldOf(area)).toBe(area)
  })

  test('a checkbox, a slider, a button and a plain element are not', () => {
    for (const type of ['checkbox', 'range', 'color', 'button']) {
      const one = document.createElement('input')
      one.type = type
      expect(textFieldOf(one)).toBeNull()
    }
    expect(textFieldOf(document.createElement('div'))).toBeNull()
    expect(textFieldOf(null)).toBeNull()
  })
})

describe('the rows', () => {
  test('cut, copy, paste and select all, in that order', () => {
    expect(rows().map((one) => one.label)).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
    expect(rows().every((one) => !one.disabled)).toBe(true)
  })

  test('nothing selected is nothing to cut or copy', () => {
    field.setSelectionRange(3, 3)
    const [cut, copy, paste, all] = rows()
    expect([cut?.disabled, copy?.disabled, paste?.disabled, all?.disabled]).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  test('a field that may not be changed is copied from and nothing else', () => {
    field.readOnly = true
    const [cut, copy, paste] = rows()
    expect([cut?.disabled, copy?.disabled, paste?.disabled]).toEqual([true, false, true])
  })

  test('a password is never cut or copied', () => {
    field.type = 'password'
    const [cut, copy] = rows()
    expect([cut?.disabled, copy?.disabled]).toEqual([true, true])
  })

  test('an empty field has nothing to select', () => {
    field.value = ''
    expect(rows().at(-1)?.disabled).toBe(true)
  })

  test('select all selects the field', () => {
    rows().at(-1)?.run()
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 11])
  })

  test('cut and copy are the browser’s own commands', () => {
    const [cut, copy] = rows()
    cut?.run()
    copy?.run()
    expect(commands).toEqual(['cut', 'copy'])
  })

  /** Written over the selection, and heard by the field as typing. jsdom refuses the
   *  command, which is the path written by hand. */
  test('paste writes the clipboard over the selection', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve('bye') } })
    let heard = 0
    field.addEventListener('input', () => (heard += 1))

    rows()[2]?.run()
    await vi.waitFor(() => expect(field.value).toBe('bye world'))
    expect(commands).toEqual(['insertText'])
    expect(heard).toBe(1)
    vi.unstubAllGlobals()
  })
})

describe('the field keeps the keyboard', () => {
  test('opening the menu leaves the focus in the field', () => {
    open()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(document.activeElement).toBe(field)
  })

  test('the arrows light a row without taking the caret', () => {
    open()
    const first = press('ArrowDown')
    expect(first.defaultPrevented).toBe(true)
    expect(document.querySelector('.lit')?.textContent).toContain('Cut')

    press('ArrowUp')
    expect(document.querySelector('.lit')?.textContent).toContain('Select all')
    expect(document.activeElement).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5])
  })

  test('Enter chooses the lit row and goes no further', () => {
    let reached = false
    field.addEventListener('keydown', () => (reached = true))
    open()
    press('ArrowUp')
    press('Enter')

    expect(menu.open).toBe(false)
    expect(reached).toBe(false)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 11])
  })

  test('Escape closes it and nothing else', () => {
    let reached = false
    field.addEventListener('keydown', () => (reached = true))
    open()
    press('Escape')

    expect(menu.open).toBe(false)
    expect(reached).toBe(false)
  })

  test('typing closes it and reaches the field', () => {
    let reached = ''
    field.addEventListener('keydown', (event) => (reached = event.key))
    open()
    const typed = press('a')

    expect(menu.open).toBe(false)
    expect(reached).toBe('a')
    expect(typed.defaultPrevented).toBe(false)
  })

  test('a row pressed with the mouse does not take the focus', () => {
    open()
    const row = document.querySelector<HTMLButtonElement>('.nib-row')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })
})
