import { afterEach, expect, test, vi } from 'vitest'
import { closeFind, createEditor, type EditorView, openFind } from '@nib/editor'

/** The find bar closed, and then a selection.
 *
 *  tabs-hints found it on main af0de762: open the find bar, press Escape, select some
 *  words, and CodeMirror logged `update listener: RangeError: Maximum call stack size
 *  exceeded` and the format bar never came up. The pane answers the editor's word that
 *  the bar has gone by closing its bar, and closing its bar tells the editor the bar
 *  has gone: `closeFind` dispatched, the editor told the pane, the pane closed again,
 *  and so on until the stack ran out - inside Svelte's own flush as often as not,
 *  which is what left the page drawing nothing new.
 *
 *  The pane's wiring is Pane.svelte's, written out here: an ask opens the bar, and
 *  nothing (the bar gone) shuts it, which is `closeFind` and the focus back. */

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
  vi.restoreAllMocks()
})

test('the bar closed by Escape closes once, and a selection after it is heard', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const asked: (string | null)[] = []
  let selections = 0
  let finding = false

  const parent = document.createElement('div')
  document.body.append(parent)

  const shut = () => {
    finding = false
    if (view) closeFind(view)
  }

  view = createEditor({
    parent,
    doc: 'Kestrels hover over the field before they drop.',
    onFind: (ask) => {
      asked.push(ask ? 'open' : 'shut')
      if (ask) finding = true
      else shut()
    },
    onSelection: () => {
      selections++
    },
  })

  openFind(view)
  expect(finding).toBe(true)

  // Escape in the bar: the pane shuts it.
  shut()

  expect(logged.mock.calls.map((one) => String(one[0]))).toEqual([])
  expect(asked).toEqual(['open', 'shut'])

  // And the words selected afterwards reach whoever follows the selection.
  const before = selections
  view.dispatch({ selection: { anchor: 0, head: 8 } })
  expect(selections).toBe(before + 1)
  expect(logged).not.toHaveBeenCalled()
})

test('a close with no bar up asks nothing of anybody', () => {
  const heard: unknown[] = []
  const parent = document.createElement('div')
  document.body.append(parent)

  view = createEditor({ parent, doc: 'Nothing looked for.', onFind: (ask) => heard.push(ask) })
  closeFind(view)

  expect(heard).toEqual([])
})
