import { afterEach, expect, test } from 'vitest'
import { createEditor, type EditorView } from '@nib/editor'

/** The controls that move, add and delete a table's rows, as the first column's
 *  cells are written in.
 *
 *  They used to be drawn inside each row's first cell, and a cell swaps what it
 *  holds as it takes the caret and gives it back - markdown while it is written
 *  in, the rendered text after - which took the row's controls with it. So the
 *  row being worked on in the first column was the one row without them, and it
 *  stayed without them until the table was next drawn again: on a phone, where
 *  a row's controls are only ever up for the row the caret is in, that is every
 *  row whose first cell was tapped.
 *
 *  In the jsdom project because the table is a widget in a real editor. */

/** Laid out the way Nib writes a table back, so a move is the only change. */
const NOTE = '| What  | Where |\n| ----- | ----- |\n| Notes | here  |\n| Ideas | there |\n'

let editor: EditorView | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function mounted() {
  const parent = document.createElement('div')
  document.body.append(parent)
  editor = createEditor({ parent, doc: NOTE })
  const table = parent.querySelector<HTMLElement>('.nib-table-wrap')
  if (!table) throw new Error('no table was drawn')

  return table
}

/** The first cell of a body row. */
const firstCell = (table: HTMLElement, row: number) =>
  table.querySelector<HTMLElement>(`td[data-row="${row}"][data-column="0"]`)

/** The caret going into a cell and out of it, as the events a browser sends:
 *  jsdom does not count a contenteditable cell as something that takes focus. */
function enter(cell: HTMLElement | null) {
  cell?.dispatchEvent(new FocusEvent('focus'))
  cell?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

function leave(cell: HTMLElement | null) {
  cell?.dispatchEvent(new FocusEvent('blur'))
  cell?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
}

/** Something passing over an element, as a browser says so: as a pointer and
 *  then again as a mouse - which a finger's tap is announced as too. */
function pass(over: Element | null | undefined, pointerType: string) {
  over?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType }))
  over?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
}

test('a row has its controls while its first cell is written in', () => {
  const table = mounted()
  enter(firstCell(table, 0))

  const rows = table.querySelector('.nib-table-rows')
  expect(rows?.classList.contains('is-shown')).toBe(true)
  expect(rows?.querySelectorAll('button')).toHaveLength(4)
})

test('and keeps them once the caret has gone again', () => {
  const table = mounted()
  enter(firstCell(table, 0))
  leave(firstCell(table, 0))

  pass(firstCell(table, 0), 'mouse')

  expect(table.querySelector('.nib-table-rows')?.classList.contains('is-shown')).toBe(true)
})

test('what they do lands on the row they were brought up for', () => {
  const table = mounted()
  pass(firstCell(table, 1), 'mouse')

  // On the press rather than the click, so the caret stays in its cell; see
  // `button` in packages/editor/src/table/cells.ts.
  const up = table.querySelector<HTMLButtonElement>('.nib-table-rows button')
  up?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

  expect(editor?.state.doc.toString()).toBe(
    '| What  | Where |\n| ----- | ----- |\n| Ideas | there |\n| Notes | here  |\n',
  )
})

/** A tap on an iPhone or an iPad is announced as something passing over the cell
 *  first, and WebKit takes a tap that brought something new onto the screen to
 *  have been for looking: the cell under it never got the caret, and writing in
 *  any cell of a table took two taps. The bars come up with the caret there. */
test('a finger passing over a cell brings neither bar up', () => {
  const table = mounted()
  pass(firstCell(table, 0), 'touch')
  pass(table.querySelector('th'), 'touch')

  expect(table.querySelector('.nib-table-rows')?.classList.contains('is-shown')).toBe(false)
  expect(table.querySelector('.nib-table-columns')?.classList.contains('is-shown')).toBe(false)
})
