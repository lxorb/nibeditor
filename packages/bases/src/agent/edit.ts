/** `update_task` in its pure half: the note's words with one task changed, ticked the
 *  way the Tasks plugin ticks it (a recurring task's next line written above it), and
 *  where the task is afterwards. Both servers write the answer as one edit of the note.
 *
 *  The task is found again in the words as they are now, by its anchor's hash nearest
 *  the line it was on, so a note typed in since the agent read it is still edited in
 *  the right place, or refused where the task is gone. */

import { appliedEdits, type TextEdit } from '@nib/markdown/edits'
import { type TaskChange, writeTask } from '@nib/markdown/task-edits'
import { taskRowsOfText } from '../task-rows'
import { tick } from '../occurrence'
import type { Row } from '../types'
import { placedEdit, placeIn } from './entry'
import { AgentError, atOf, findTask, taskBlock } from './tasks'

/** Where a line starts in a note. */
function lineStart(text: string, line: number): number {
  let at = 0
  for (let index = 0; index < line; index++) {
    const next = text.indexOf('\n', at)
    if (next === -1) return text.length
    at = next + 1
  }
  return at
}

/** The words of a line, without its line break. */
function lineAt(text: string, from: number): string {
  const end = text.indexOf('\n', from)
  return text.slice(from, end === -1 ? text.length : end).replace(/\r$/, '')
}

/** The task a note's words hold for an anchor, or a refusal saying it is gone. */
export function taskIn(
  text: string,
  space: string,
  path: string,
  anchor: { line: number; hash: string },
): Row {
  const found = findTask(taskRowsOfText(space, path, text), anchor)
  if (!found?.anchor)
    throw new AgentError('not_found', 'that task is not in the note any more: list_tasks again')
  return found
}

export interface Edited {
  text: string
  /** The task afterwards. */
  at: string
  /** A recurring task's next occurrence, where ticking wrote one. */
  next?: string
}

/** The note with the task changed and, where `done` says so, ticked or opened again. */
export function editedTask(
  text: string,
  space: string,
  path: string,
  anchor: { line: number; hash: string },
  change: TaskChange,
  done: boolean | undefined,
  today: string,
): Edited {
  const row = taskIn(text, space, path, anchor)
  const line = row.anchor?.line ?? 0
  const from = lineStart(text, line)
  const edits: TextEdit[] = writeTask(lineAt(text, from), change).map((edit) => ({
    from: edit.from + from,
    to: edit.to + from,
    insert: edit.insert,
  }))
  let after = appliedEdits(text, edits)

  // Changing the words changes the hash; the line is the same one.
  const changed = taskOn(after, space, path, line)
  if (done !== undefined && changed.task && changed.task.done !== done) {
    after = appliedEdits(after, tick(after, line, today))
  }

  // The task is the one with its words nearest where it was that is as asked; a
  // recurring task's next occurrence is the open one written above it.
  const hash = changed.anchor?.hash ?? ''
  const same = taskRowsOfText(space, path, after).filter((one) => one.anchor?.hash === hash)
  const wanted = done === undefined ? same : same.filter((one) => one.task?.done === done)
  const settled = findTask(wanted.length ? wanted : same, { line, hash }) ?? changed
  const next = done
    ? same.find((one) => !one.task?.done && (one.anchor?.line ?? 0) < (settled.anchor?.line ?? 0))
    : undefined
  return { text: after, at: atOf(settled), ...(next ? { next: atOf(next) } : {}) }
}

/** The task on a line of a note. */
function taskOn(text: string, space: string, path: string, line: number): Row {
  const found = taskRowsOfText(space, path, text).find(
    (one) => one.kind === 'task' && one.anchor?.line === line,
  )
  if (!found)
    throw new AgentError('not_found', 'that task is not in the note any more: list_tasks again')
  return found
}

/** A task and everything indented under it, taken out of one note and written into
 *  another (or under another heading of the same one): the two notes' words after. */
export function movedTask(
  from: { text: string; space: string; path: string; anchor: { line: number; hash: string } },
  to: { text: string; under?: string } | null,
  under?: string,
): { source: string; target: string | null; line: number } {
  const row = taskIn(from.text, from.space, from.path, from.anchor)
  const block = taskBlock(from.text, row.anchor?.line ?? 0)
  const source = from.text.slice(0, block.from) + from.text.slice(block.to)
  const into = to === null ? source : to.text
  const placed = placeIn(into, block.lines, under ?? to?.under)
  const target = appliedEdits(into, [placedEdit(placed)])
  return to === null
    ? { source: target, target: null, line: placed.line }
    : { source, target, line: placed.line }
}
