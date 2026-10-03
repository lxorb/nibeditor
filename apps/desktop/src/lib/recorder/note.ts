/** Where the words go.
 *
 *  A recording writes its embed into a note, at the caret or at the end, and both go
 *  through the editor that is showing the note rather than through the file on disk,
 *  for one reason: a change dispatched into the editor is one step of undo, every pane
 *  showing the note sees it at once, and the save that follows is the ordinary save. A
 *  file written underneath a note somebody has open is how two versions of a note come
 *  to exist.
 *
 *  Which means a note that is not open in any pane cannot be written into, and that is
 *  only ever answered honestly, as false. */

import type { EditorView } from '@nib/editor'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { recordingNoteName } from './transcript'

/** The editor showing a note, in whichever pane has it, or null when none does. */
export function viewFor(path: string): EditorView | null {
  for (const tab of workspace.tabs) {
    if (tab.note.path !== path) continue

    const view = views.of(tab.paneId)
    if (view) return view
  }

  return null
}

/** Writes at the caret, as a block of its own, and leaves the caret after it so the
 *  next thing typed follows it.
 *
 *  A player is a block and not a word in a sentence, so it gets a line to itself: a
 *  line break in front of it where there are already words behind the caret, and one
 *  after it where there are words ahead. Without the second one, a recording started
 *  with the caret at the very top of a note - which is where a note the app has just
 *  opened has it - wrote `![[recording-….weba]]# Notes` and took the heading with it.
 *  The same rule `insertBlock` uses in the editor package, for the same reason. */
export function writeAtCaret(view: EditorView, text: string) {
  const range = view.state.selection.main
  const line = view.state.doc.lineAt(range.from)

  const before = range.from === line.from ? '' : '\n'
  const after = range.to === line.to ? '' : '\n'
  const insert = `${before}${text}${after}`

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + before.length + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** Writes at the end of a note, and does not move the caret: the note is not the one
 *  being typed in, or it would have a caret to write at. */
export function appendTo(path: string, text: string): boolean {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return false

  const end = view.state.doc.length
  view.dispatch({ changes: { from: end, to: end, insert: text }, userEvent: 'input.complete' })
  return true
}

/** The note a recording goes into: the one that is open, or a new one.
 *
 *  A recording is a thing somebody starts in a hurry, and "no note open" is not an
 *  answer to give them. A note that has never been saved has no path either, and a
 *  recording has to be written beside something - so that case makes a note too. */
export async function noteToRecordInto(): Promise<string | null> {
  const open = workspace.active
  if (open?.kind === 'note' && open.path) return open.path

  if (!workspace.activeSpace) return null

  await workspace.createNote(undefined, `${recordingNoteName(new Date())}.md`)
  return workspace.active?.path ?? null
}
