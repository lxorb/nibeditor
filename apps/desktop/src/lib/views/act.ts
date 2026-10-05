/** What a view does to the notes its rows are in: a box ticked, a cell written, a card
 *  dropped, a line moved, a task added. Every one of them is one write of the notes it
 *  touches, through note-text.ts, so it is one thing to undo and every pane showing
 *  the note has it at once; and every one of them reaches the rows the way any save
 *  does, so the view that did it moves with the rest (docs/tasks.md 5.12).
 *
 *  A property or a field goes through `rows.write`, the one write path. A tick goes
 *  through the engine's `tick`, which writes a recurring task's next occurrence in the
 *  same edit, as the editor's box does. A move of whole lines is this lane's own, in
 *  lines.ts. */

import { tick } from '@nib/bases'
import type { Row } from '@nib/bases'
import { appliedEdits, oneEdit } from '@nib/markdown/edits'
import { taskLine as lineWords } from '@nib/markdown/task-edits'
import type { TaskFields } from '@nib/markdown/task-line'
import { rows } from '../rows/rows.svelte'
import { changed, type RowChange } from '../rows/write'
import { changeOf } from '../search/replace'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText, replaceInNotes } from '../workspace/note-text'
import { dayOf } from './days'
import type { Drop } from './drop'
import {
  cutBlock,
  indentedBlock,
  lineOfAnchor,
  movedBeside,
  movedBlock,
  movedUnder,
  withLines,
} from './lines'

/** Where a row's note is on this disk, or null for a space no longer here. */
function pathOf(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

/** One note written from what it said to what it says now; false where nothing
 *  changed or the note could not be read. */
async function rewrite(path: string, after: (before: string) => string | null): Promise<boolean> {
  const before = await noteText(workspace, path)
  if (before === null) return false
  const next = after(before)
  if (next === null) return false
  const edit = oneEdit(before, next)
  if (!edit) return false
  await replaceInNotes(workspace, [changeOf(path, before, [edit])])
  return true
}

/** A property of a row's note or a field of its task: the one write path. */
export function writeRow(row: Row, change: RowChange): Promise<boolean> {
  return rows.write(row, change)
}

/** One change made to many rows as one write, so one undo takes all of it back:
 *  Today's "Reschedule to today" over every overdue task. Each note is read once and
 *  every change in it made on its words in turn. */
export function writeRows(many: readonly Row[], change: RowChange): Promise<boolean> {
  return writeEach(many.map((row) => ({ row, change })))
}

/** A change of its own to each of many rows, as one write: an option renamed in every
 *  note that holds it, ids given to a base's rows. `join` makes it one undo with the
 *  write just before, where it follows from that one (an automation). */
export async function writeEach(
  pairs: readonly { row: Row; change: RowChange }[],
  join = false,
): Promise<boolean> {
  const byNote = new Map<string, { row: Row; change: RowChange }[]>()
  for (const pair of pairs) {
    const path = pathOf(pair.row)
    if (path !== null) byNote.set(path, [...(byNote.get(path) ?? []), pair])
  }

  const changes = []
  for (const [path, inNote] of byNote) {
    const before = await noteText(workspace, path)
    if (before === null) continue
    let after = before
    for (const { row, change } of inNote) after = changed(after, row, change) ?? after
    const edit = oneEdit(before, after)
    if (edit) changes.push(changeOf(path, before, [edit]))
  }
  if (!changes.length) return false
  await replaceInNotes(workspace, changes, { join })
  return true
}

/** A task's box pressed: ticked as the editor ticks it, with a recurring task's next
 *  occurrence written above, or opened again when it was done. */
export async function tickRow(row: Row, today = dayOf(new Date())): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => {
    const line = lineOfAnchor(before, anchor)
    if (line === null) return null
    const edits = tick(before, line, today)
    return edits.length ? appliedEdits(before, edits) : null
  })
}

/** Alt+↑ and Alt+↓: the task and everything under it past its sibling. */
export async function moveRow(row: Row, up: boolean): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => movedBlock(before, anchor, up))
}

/** A task dragged onto another of its note's tasks: its lines moved to stand before
 *  (or after) that one's. */
export async function moveBeside(row: Row, target: Row, after: boolean): Promise<boolean> {
  const anchor = row.anchor
  const there = target.anchor
  const path = pathOf(row)
  if (
    !anchor ||
    !there ||
    path === null ||
    row.space !== target.space ||
    !samePath(row.path, target.path)
  ) {
    return false
  }
  return rewrite(path, (before) => movedBeside(before, anchor, there, after))
}

/** Tab and Shift+Tab: a sub-task of the task above it, or lifted out a level. */
export async function indentRow(row: Row, deeper: boolean): Promise<boolean> {
  const anchor = row.anchor
  const path = pathOf(row)
  if (!anchor || path === null) return false
  return rewrite(path, (before) => indentedBlock(before, anchor, deeper))
}

/** A task's lines moved under another heading of its note, or into another note of
 *  its space (under one of that note's headings, where one is named). Two notes
 *  written as one write, so one undo puts the task back. */
async function moveRowTo(row: Row, to: { path?: string; heading?: string }): Promise<boolean> {
  const anchor = row.anchor
  const from = pathOf(row)
  if (!anchor || from === null) return false

  const target = to.path === undefined ? null : targetOf(row, to.path)
  if (target === null || samePath(target, from)) {
    if (to.heading === undefined) return false
    const heading = to.heading
    return rewrite(from, (before) => movedUnder(before, anchor, heading))
  }

  const [before, there] = await Promise.all([
    noteText(workspace, from),
    noteText(workspace, target),
  ])
  if (before === null) return false
  const cut = cutBlock(before, anchor)
  if (!cut) return false
  const after = withLines(there ?? '', cut.block, to.heading)

  const changes = []
  const leave = oneEdit(before, cut.rest)
  const arrive = oneEdit(there ?? '', after)
  if (leave) changes.push(changeOf(from, before, [leave]))
  if (arrive) changes.push(changeOf(target, there ?? '', [arrive]))
  await replaceInNotes(workspace, changes)
  return true
}

/** The note a move names, in the row's own space: by path, or by a note's name, which
 *  is what a view grouped by note calls its groups. */
function targetOf(row: Row, named: string): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  if (!space) return null
  const all = rows.of(row.space)
  const found =
    all.find((one) => one.kind === 'note' && samePath(one.path, named)) ??
    all.find((one) => one.kind === 'note' && one.file.basename === named)
  return found ? insideSpace(space.root, found.path) : null
}

/** What the view does with a drop: the change, the tick or the move it answered. */
export function dropRow(row: Row, drop: Drop): Promise<boolean> {
  if ('tick' in drop) return tickRow(row)
  if ('move' in drop) return moveRowTo(row, drop.move)
  return writeRow(row, drop.change)
}

/** A new task line written at the end of a note, or of one of its headings. `path`
 *  is on this disk. */
export async function addTask(
  path: string,
  fields: Partial<TaskFields> & { text: string },
  heading?: string,
): Promise<boolean> {
  const line = lineWords(
    {
      status: ' ',
      done: false,
      cancelled: false,
      remind: [],
      priority: 4,
      tags: [],
      dependsOn: [],
      fields: {},
      ...fields,
    },
    '- ',
  )
  return rewrite(path, (before) => withLines(before, [line], heading))
}

/** A button pressed on a row (docs/tasks.md 5.13): its properties set and its task
 *  added at the end of the row's note, as one write, so one undo takes the press back. */
export async function pressRow(row: Row, change: RowChange, task?: string): Promise<boolean> {
  const path = pathOf(row)
  if (path === null) return false
  return rewrite(path, (before) => {
    const set = Object.keys(change.note ?? {}).length ? changed(before, row, change) : before
    if (set === null) return null
    return task?.trim() ? withLines(set, [`- [ ] ${task.trim()}`]) : set
  })
}
