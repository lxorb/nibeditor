import { describe, expect, test } from 'vitest'
import { atEdge, EDGE, escapeLeaves, type Holder, mayFill, mayHide, stillFills } from './rules'

/** The rules of a tab filling the window, apart from any window. See rules.ts. */

describe('filling the window', () => {
  test('is for a pane that shows something, on a desktop', () => {
    expect(mayFill('tab', false)).toBe(true)
    expect(mayFill(null, false)).toBe(false)
    // A phone and a tablet show one document and nothing beside it already.
    expect(mayFill('tab', true)).toBe(false)
  })
})

describe('a fill', () => {
  const filled = { fills: 'left', focusedId: 'left', showing: 'one' }

  test('holds while its pane is worked in and shows something', () => {
    expect(stillFills(filled)).toBe(true)
  })

  /** VS Code's maximized group: the tabs of the group change under it. */
  test('holds through another tab of the same pane coming to the front', () => {
    expect(stillFills({ ...filled, showing: 'two' })).toBe(true)
  })

  test('ends when another pane is worked in', () => {
    expect(stillFills({ ...filled, focusedId: 'right' })).toBe(false)
  })

  /** The last tab closed, or put down with Ctrl+D: a window with no strip, no list and
   *  no document is the one nobody finds their way out of. */
  test('ends when its pane shows nothing', () => {
    expect(stillFills({ ...filled, showing: null })).toBe(false)
  })

  test('is not one where nothing fills', () => {
    expect(stillFills({ ...filled, fills: null })).toBe(false)
  })
})

/** Something the keyboard can be on, as the rule reads it: inside a pane or not, and a
 *  field or not. */
function on(inPane: boolean, tagName = 'DIV', isContentEditable = false): Holder {
  return {
    tagName,
    isContentEditable,
    closest: (selector: string) => (selector === '[data-pane]' && inPane ? {} : null),
  }
}

describe('Escape', () => {
  test('leaves where the keyboard is on nothing', () => {
    expect(escapeLeaves(null)).toBe(true)
    expect(escapeLeaves(on(false, 'BODY'))).toBe(true)
  })

  test('leaves from the bar a filled window keeps', () => {
    expect(escapeLeaves(on(false, 'BUTTON'))).toBe(true)
  })

  /** A note, a terminal, a canvas, a PDF, a page's bar: each has an Escape of its own. */
  test('is the document’s inside it', () => {
    expect(escapeLeaves(on(true))).toBe(false)
    expect(escapeLeaves(on(true, 'TEXTAREA'))).toBe(false)
  })

  test('is a field’s wherever the field is', () => {
    expect(escapeLeaves(on(false, 'INPUT'))).toBe(false)
    expect(escapeLeaves(on(false, 'SELECT'))).toBe(false)
    expect(escapeLeaves(on(false, 'DIV', true))).toBe(false)
  })
})

describe('the bar a filled window keeps', () => {
  test('comes back at the top edge and nowhere else', () => {
    expect(atEdge(0)).toBe(true)
    expect(atEdge(EDGE - 1)).toBe(true)
    expect(atEdge(EDGE)).toBe(false)
    expect(atEdge(400)).toBe(false)
    // Above the window: a pointer on another screen or on the title of a system frame.
    expect(atEdge(-1)).toBe(false)
  })

  test('goes only once nothing holds it', () => {
    expect(mayHide({ pointer: false, keyboard: false, layers: 0 })).toBe(true)
    expect(mayHide({ pointer: true, keyboard: false, layers: 0 })).toBe(false)
    expect(mayHide({ pointer: false, keyboard: true, layers: 0 })).toBe(false)
    // A menu opened from it, which sits outside it while the pointer is on the menu.
    expect(mayHide({ pointer: false, keyboard: false, layers: 1 })).toBe(false)
  })
})
