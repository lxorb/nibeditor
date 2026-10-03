import { afterEach, expect, test } from 'vitest'
import { createEditor, type EditorView, loadLineCommands, SharedDoc } from '@nib/editor'

/** A paste answered a moment late, and a pane that moved on in that moment.
 *
 *  An address pasted over words is a link of them, and the rule that writes it is
 *  fetched with the first such paste; a web page pasted in is markdown, and the
 *  converter is fetched with the first page. drive-harness found what that moment
 *  costs (line-commands.py): the pane switched to another note before the rule
 *  landed, and the address went into the other note at the first note's offsets
 *  while the note it was pasted into never got it. A paste belongs to the note it was
 *  made in.
 *
 *  In the jsdom project because a paste is a DOM event on the editor.
 *
 *  Each test waits for the fetch itself rather than for a while: the paste is written
 *  when the rule lands, and the rule is one promise every caller shares, so whatever
 *  awaits it after the paste resumes after the paste was written. A wait by the clock
 *  was a race with the first transform of the rule, which a loaded machine lost. */

/** Until the rule the paste waits for has landed, and the paste with it. */
const landed = () => loadLineCommands()

/** A paste scrolls to where it landed, which measures text; jsdom has no layout. */
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

/** A paste of plain text, the way a browser hands one to the editor. */
function paste(into: EditorView, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (kind: string) => (kind === 'text/plain' ? text : ''), files: [] },
  })
  into.contentDOM.dispatchEvent(event)
}

test('an address pasted over words is linked in that note though the pane moved on', async () => {
  const first = new SharedDoc('Read the field notes today.')
  const second = new SharedDoc('A different note entirely.')
  const parent = document.createElement('div')
  document.body.append(parent)

  view = createEditor({ parent, doc: first.text.toString() })
  first.join(view)
  view.dispatch({ selection: { anchor: 9, head: 20 } })

  paste(view, 'https://example.com/notes')
  // The pane is handed the next note before the rule that writes the link has landed.
  second.join(view)

  await landed()
  expect(first.text.toString()).toBe('Read the [field notes](https://example.com/notes) today.')
  expect(second.text.toString()).toBe('A different note entirely.')
  expect(view.state.doc.toString()).toBe('A different note entirely.')
})

test('a paste that lands on the note it was made in is written where the caret is', async () => {
  const note = new SharedDoc('Read the field notes today.')
  const parent = document.createElement('div')
  document.body.append(parent)

  view = createEditor({ parent, doc: note.text.toString() })
  note.join(view)
  view.dispatch({ selection: { anchor: 9, head: 20 } })

  paste(view, 'https://example.com/notes')

  await landed()
  expect(note.text.toString()).toBe('Read the [field notes](https://example.com/notes) today.')
  expect(view.state.doc.toString()).toBe(note.text.toString())
})
