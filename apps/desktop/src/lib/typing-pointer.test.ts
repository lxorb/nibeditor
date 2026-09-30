import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The three kinds of element the rule tells apart, stood in for: this project has
 *  no page, and what is read off an element here is four fields. */
class FakeElement {
  isContentEditable = false
}
class FakeInput extends FakeElement {
  type = 'text'
  readOnly = false
  disabled = false
}
class FakeTextArea extends FakeElement {
  readOnly = false
  disabled = false
}
vi.stubGlobal('HTMLElement', FakeElement)
vi.stubGlobal('HTMLInputElement', FakeInput)
vi.stubGlobal('HTMLTextAreaElement', FakeTextArea)

const { HIDDEN, TypingPointer, takesWords, writes } = await import('./typing-pointer')

/** A note's writing surface: editable text. */
const note = Object.assign(new FakeElement(), { isContentEditable: true })

interface Key {
  key: string
  target?: unknown
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  altGraph?: boolean
}

function key({ key, target = note, altGraph = false, ...held }: Key): KeyboardEvent {
  const event = {
    type: 'keydown',
    key,
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...held,
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
  }
  // The fields the rule reads, which is all a key is to it.
  return event as unknown as KeyboardEvent
}

function pointer(type: string, fields: Partial<PointerEvent> = {}): PointerEvent {
  // The same, for a pointer.
  return { type, pointerType: 'mouse', movementX: 0, movementY: 0, ...fields } as PointerEvent
}

/** The root the class goes on, and the window the move is listened on, both kept
 *  as what was done to them. */
const classes = new Set<string>()
const root = {
  classList: {
    add: (name: string) => classes.add(name),
    remove: (name: string) => classes.delete(name),
  },
}
const listened = new Set<string>()
const listening = {
  addEventListener: (type: string) => listened.add(type),
  removeEventListener: (type: string) => listened.delete(type),
}

let typing: InstanceType<typeof TypingPointer>

const hidden = () => classes.has(HIDDEN)

beforeEach(() => {
  classes.clear()
  listened.clear()
  // Stood in for, like the elements: only `classList` is ever touched.
  typing = new TypingPointer(root as unknown as Element, listening, false)
})

describe('a key that writes', () => {
  test('a character, Enter, Backspace, Delete, a composition and a dead key', () => {
    for (const one of [
      'a',
      'Z',
      ' ',
      'é',
      '😀',
      'Enter',
      'Backspace',
      'Delete',
      'Process',
      'Dead',
    ]) {
      expect(writes(key({ key: one }), false), one).toBe(true)
    }
  })

  test('not a key that moves or commands', () => {
    for (const one of [
      'ArrowLeft',
      'Home',
      'PageDown',
      'Tab',
      'Escape',
      'F5',
      'Shift',
      'Control',
    ]) {
      expect(writes(key({ key: one }), false), one).toBe(false)
    }
    expect(writes(key({ key: 's', ctrlKey: true }), false)).toBe(false)
    expect(writes(key({ key: 'c', metaKey: true }), true)).toBe(false)
    expect(writes(key({ key: '1', altKey: true }), false)).toBe(false)
  })

  test('AltGr writes, and so does Option on a Mac', () => {
    expect(writes(key({ key: '@', ctrlKey: true, altKey: true, altGraph: true }), false)).toBe(true)
    expect(writes(key({ key: '€', altKey: true }), true)).toBe(true)
  })
})

describe('what takes words', () => {
  test('a note, a field, a text area', () => {
    expect(takesWords(note as unknown as EventTarget)).toBe(true)
    expect(takesWords(new FakeInput() as unknown as EventTarget)).toBe(true)
    expect(takesWords(new FakeTextArea() as unknown as EventTarget)).toBe(true)
  })

  test('not a locked field, a checkbox, a button or plain page', () => {
    const locked = Object.assign(new FakeInput(), { readOnly: true })
    const box = Object.assign(new FakeInput(), { type: 'checkbox' })
    const off = Object.assign(new FakeTextArea(), { disabled: true })

    for (const one of [locked, box, off, new FakeElement(), null]) {
      expect(takesWords(one as unknown as EventTarget)).toBe(false)
    }
  })
})

describe('the pointer', () => {
  test('hides on a key that writes into a note, and listens for the move only then', () => {
    expect(listened.has('pointermove')).toBe(false)

    typing.handleEvent(key({ key: 'a' }))

    expect(hidden()).toBe(true)
    expect(listened.has('pointermove')).toBe(true)
  })

  test('comes back on the first move that moves, and stops listening for it', () => {
    typing.handleEvent(key({ key: 'a' }))

    // The engine re-reading a still pointer after the page moved under it.
    typing.handleEvent(pointer('pointermove'))
    expect(hidden()).toBe(true)

    typing.handleEvent(pointer('pointermove', { movementX: 1 }))
    expect(hidden()).toBe(false)
    expect(listened.has('pointermove')).toBe(false)
  })

  test('comes back on a press, and on the window losing the keyboard', () => {
    typing.handleEvent(key({ key: 'a' }))
    typing.handleEvent(pointer('pointerdown'))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerup'))
    typing.handleEvent(key({ key: 'b' }))
    typing.handleEvent({ type: 'blur' } as Event)
    expect(hidden()).toBe(false)
  })

  test('stays while a shortcut, an arrow or a key outside anything typable is pressed', () => {
    typing.handleEvent(key({ key: 's', ctrlKey: true }))
    typing.handleEvent(key({ key: 'ArrowDown' }))
    typing.handleEvent(key({ key: 'a', target: new FakeElement() }))

    expect(hidden()).toBe(false)
  })

  test('never while a button is held', () => {
    typing.handleEvent(pointer('pointerdown'))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerup'))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(true)
  })

  test('never after a touch or a pen, until the mouse is back', () => {
    typing.handleEvent(pointer('pointerdown', { pointerType: 'touch' }))
    typing.handleEvent(pointer('pointerup', { pointerType: 'touch' }))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerdown', { pointerType: 'pen' }))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerdown'))
    typing.handleEvent(pointer('pointerup'))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(true)
  })

  test('costs a hundred keys in a row one change to the page', () => {
    let changes = 0
    const counting = {
      classList: {
        add: () => changes++,
        remove: () => changes++,
      },
    }
    // Stood in for, as above.
    const counted = new TypingPointer(counting as unknown as Element, listening, false)

    for (let n = 0; n < 100; n++) counted.handleEvent(key({ key: 'a' }))

    expect(changes).toBe(1)
  })
})
