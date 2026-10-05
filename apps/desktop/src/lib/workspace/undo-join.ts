/** A replacement that follows from the one before it, taken back with it: what a base's
 *  automation writes because of an edit is one undo with that edit (docs/tasks.md 5.13).
 *
 *  Joined only where every note it writes is one the last replacement wrote and still
 *  holds exactly what that left, so nothing typed in between is ever folded in. Out of
 *  the first paint: only an automation asks, and it is fetched with the first. */

import { oneEdit } from '@nib/markdown/edits'
import { reverse } from '../search/replace'
import { samePath } from '../space-paths'
import type { FileAction, FileActions } from './undo.svelte'

type Replaced = Extract<FileAction, { kind: 'replace' }>['notes'][number]

/** The last action with these notes' writes folded into it, or null where they do not
 *  follow from it. */
export function joinedAction(
  last: FileAction | undefined,
  notes: readonly Replaced[],
): FileAction | null {
  if (last?.kind !== 'replace') return null
  const next = [...last.notes]
  for (const note of notes) {
    const at = next.findIndex((one) => samePath(one.path, note.path))
    const was = next[at]
    if (!was || was.after !== note.content) return null
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

/** Folds these writes into the newest undo where they follow from it. Answers whether
 *  it did; where it did not, the caller records them as an undo of their own. */
export function joined(undone: FileActions, notes: readonly Replaced[]): boolean {
  const action = joinedAction(undone.last, notes)
  if (!action) return false
  // Replacing the newest rather than recording: what is ahead was emptied by the edit
  // this follows from, and stays empty.
  undone.stack = [...undone.stack.slice(0, -1), action]
  return true
}
