/** A replacement that follows from the one before it, taken back with it: what a base's
 *  automation writes because of an edit is one undo with that edit (docs/tasks.md 5.13).
 *
 *  The automation's write is recorded like any other, and then folded into the edit
 *  before it - only where every note it wrote is one that edit wrote and held exactly
 *  what that edit left, so nothing typed in between is ever folded in. Out of the first
 *  paint: only the bases' runner asks (views/running.ts). */

import { oneEdit } from '@nib/markdown/edits'
import { reverse } from '../search/replace'
import { samePath } from '../space-paths'
import type { FileAction, FileActions } from './undo.svelte'

type Replaced = Extract<FileAction, { kind: 'replace' }>['notes'][number]

/** The earlier action with the later one's writes folded into it, or null where they
 *  do not follow from it. */
export function joinedAction(
  earlier: FileAction | undefined,
  notes: readonly Replaced[],
): FileAction | null {
  if (earlier?.kind !== 'replace') return null
  const next = [...earlier.notes]
  for (const note of notes) {
    const at = next.findIndex((one) => samePath(one.path, note.path))
    const was = next[at]
    if (was?.after !== note.content) return null
    const edit = oneEdit(was.content, note.after)
    next[at] = {
      path: was.path,
      content: was.content,
      after: note.after,
      edits: edit ? reverse(was.content, [edit]) : [],
    }
  }
  return { kind: 'replace', notes: next }
}

/** Folds the newest undo into the one before it where it follows from it. Answers
 *  whether it did. */
export function joinLast(undone: FileActions): boolean {
  const last = undone.stack.at(-1)
  if (last?.kind !== 'replace') return false
  const action = joinedAction(undone.stack.at(-2), last.notes)
  if (!action) return false
  undone.stack = [...undone.stack.slice(0, -2), action]
  return true
}
