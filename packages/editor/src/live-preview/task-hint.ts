/** A date typed in words at the end of a task, offered as the field it could be
 *  (docs/tasks.md 5.7): `- [ ] Call mum tomorrow`, and after the caret, quietly,
 *  `📅 Tomorrow ⇥`. Tab takes it - the words go and `📅 2026-10-08` is written where
 *  the Tasks plugin reads it, one edit - and anything else leaves the words as typed.
 *
 *  A hint after the caret rather than the completion menu, because a menu answers
 *  Enter, and Enter at the end of a task is the next task: a menu would turn every
 *  "tomorrow" somebody ended a line with into a date they did not ask for. The source is
 *  never rewritten without the reader asking.
 *
 *  Arrives with the completions (completing.ts), and carries no reader of its own:
 *  whether a line is a task is the box's one regex, the words are read by the app
 *  (`tasks.dayAtEnd` on the note index), and the writer that puts the field where it
 *  belongs is fetched by the Tab that asks for it. */

import { type EditorState, StateField, type Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { taskAt } from '@nib/markdown/tasks'
import { type DayTyped, noteIndex } from '../wikilink/notes'
import { NibWidget } from './widget'

/** What the caret is after: the date, and where its words are in the document. */
interface Hint {
  day: DayTyped
  /** The words that said it, as a span of the document. */
  from: number
  to: number
}

/** A day or a time the line already has, which a second one would fight with. */
const DATED = /[📅📆🗓⏳⌛]|\[(?:due|scheduled|time)::/u

/** The hint the caret stands after, or null: a single caret at the very end of an
 *  open task with no day of its own yet. */
function hintAt(state: EditorState): Hint | null {
  const help = state.facet(noteIndex).tasks
  const { main } = state.selection
  if (!help || !main.empty || state.selection.ranges.length > 1) return null

  const line = state.doc.lineAt(main.head)
  const task = taskAt(line.text)
  if (!task || task.done || task.mark === '-' || DATED.test(line.text)) return null
  if (main.head - line.from !== line.text.trimEnd().length) return null

  const words = line.text.slice(task.marker, main.head - line.from)
  const day = help.dayAtEnd(words)
  if (!day || day.from <= 0) return null
  return { day, from: line.from + task.marker + day.from, to: main.head }
}

class HintWidget extends NibWidget {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: HintWidget) {
    return other.text === this.text
  }

  toDOM() {
    const hint = document.createElement('span')
    hint.className = 'nib-task-hint'
    hint.textContent = `📅 ${this.text} ⇥`
    return hint
  }
}

const hinted = StateField.define<Hint | null>({
  create: hintAt,
  update: (value, transaction: Transaction) =>
    transaction.docChanged || transaction.selection ? hintAt(transaction.state) : value,
  provide: (field) =>
    EditorView.decorations.from(field, (hint): DecorationSet => {
      if (!hint) return Decoration.none
      const widget = new HintWidget(hint.day.label)
      return Decoration.set([Decoration.widget({ widget, side: 1 }).range(hint.to)])
    }),
})

/** The words out and the field in, as the edit of the characters that change. */
async function write(view: EditorView, hint: Hint) {
  const [{ appliedEdits, oneEdit }, { writeTask }] = await Promise.all([
    import('@nib/markdown/edits'),
    import('@nib/markdown/task-edits'),
  ])
  // Typed over while the writer was on its way: the hint it was is gone.
  if (view.state.field(hinted, false) !== hint) return

  const line = view.state.doc.lineAt(hint.to)
  let start = hint.from - line.from
  while (start > 0 && /[ \t]/.test(line.text.charAt(start - 1))) start--
  const without = line.text.slice(0, start) + line.text.slice(hint.to - line.from)
  const { due, time } = hint.day
  const after = appliedEdits(
    without,
    writeTask(without, time === undefined ? { due } : { due, time }),
  )
  const edit = oneEdit(line.text, after)
  if (!edit) return
  view.dispatch({
    changes: { from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert },
    selection: { anchor: line.from + start },
    userEvent: 'input',
  })
}

/** Tab with a hint up takes it; without one, Tab is whatever it always was. Bound by
 *  completing.ts, beside the rest of the keys the completions bring. */
export function takeHint(view: EditorView): boolean {
  const hint = view.state.field(hinted, false)
  if (!hint) return false
  void write(view, hint)
  return true
}

/** The hint itself; the app's note index decides whether there is ever one. */
export const taskHint = hinted
