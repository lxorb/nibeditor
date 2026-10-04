/** A box ticked in the note, the way every other surface ticks it: the done date
 *  written, the open sub-tasks under it ticked with it, and a recurring task's next
 *  occurrence written above it, all one transaction so one Ctrl+Z takes it back
 *  (docs/tasks.md 5.2, 5.7). The engine that knows how is the app's (`taskHelp.tick`);
 *  this is the editor's half: which lines, and the one dispatch.
 *
 *  The engine is asked once per line, against the note as it stood when the box was
 *  pressed. A line a tick above already reached - a sub-task ticked with its parent -
 *  is not ticked a second time, and the whole of it is dropped if the note changed
 *  while the engine was being asked, rather than applied to words it was not worked out
 *  against. */

import type { ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { TextEdit } from '@nib/markdown/edits'
import type { TaskHelp } from './wikilink/notes'

/** Ticks the task on each of these lines (numbered from one), together with any other
 *  changes worked out against the same note. */
export async function tickLines(
  view: EditorView,
  help: TaskHelp,
  lines: readonly number[],
  also: readonly ChangeSpec[] = [],
): Promise<void> {
  const before = view.state.doc
  const note = before.toString()
  const edits: TextEdit[] = []

  for (const number of lines) {
    const line = before.line(number)
    const reached = edits.some((edit) => edit.from <= line.to && edit.to >= line.from)
    if (reached) continue
    edits.push(...(await help.tick(note, number - 1)))
  }

  if (view.state.doc !== before || (!edits.length && !also.length)) return
  const changes = view.state.changes([
    ...also,
    ...edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
  ])
  view.dispatch({
    changes,
    selection: view.state.selection.map(changes, 1),
    userEvent: 'input',
  })
}
