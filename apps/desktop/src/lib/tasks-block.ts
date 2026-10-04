/** A ` ```tasks ` fence: the Tasks plugin's own query block, answered by the rows
 *  engine where it stands, so a note written for Obsidian's Tasks shows its list in nib
 *  too (docs/tasks.md 5.7).
 *
 *  The block is read as a view (`readTasksQuery` in @nib/bases: `not done`, `due before
 *  tomorrow`, `group by heading`, `sort by priority`, `limit 10`) and answered over the
 *  rows of the space in front. Drawn in the query fence's shapes, for the reason that
 *  file gives: the same rows, the same live box, and one reading of a press
 *  (`pressRow` in query-block.ts), which ticks a box through the engine and opens a row
 *  at its line. A line the engine cannot read is said under the list rather than
 *  guessed at, and the fence keeps its source either way. */

import type { Answer, Row } from '@nib/bases'
import { escapeAll } from '@nib/markdown/html'
import { shownName } from './note-name'
import { insideSpace } from './space-paths'

/** How many rows a fence in a note is worth; see query-block.ts. */
const MOST = 50

/** The rows of the open space, once they have been read. */
async function rowsOfSpace(): Promise<{ rows: readonly Row[]; root: string } | null> {
  const [{ rows }, { workspace }] = await Promise.all([
    import('./rows/rows.svelte'),
    import('./workspace.svelte'),
  ])
  const space = workspace.activeSpace
  if (!space) return null
  if (!rows.ready) {
    await new Promise<void>((resolve) => {
      const stop = rows.watch(() => {
        if (!rows.ready) return
        stop()
        resolve()
      })
      // A space with nothing left to read says nothing at all.
      setTimeout(() => {
        stop()
        resolve()
      }, 1500)
    })
  }
  return { rows: rows.of(space.name), root: space.root }
}

/** One row: the box and the words, carrying the note and the line it is. */
function row(task: Row, root: string): string {
  const fields = task.task
  if (!fields || !task.anchor) return ''
  const where = `data-path="${escapeAll(insideSpace(root, task.path))}" data-line="${task.anchor.line}"`
  const box =
    `<input type="checkbox" class="nib-checkbox" data-task ${where}` +
    `${fields.done ? ' checked' : ''} aria-label="${escapeAll(fields.text)}">`
  const title = `title="${escapeAll(shownName(task.file.name))}"`
  return `<button type="button" class="nib-row is-short" ${where} ${title}>${box}${escapeAll(fields.text)}</button>`
}

/** The answer as the fence's HTML. */
function drawn(
  answer: Answer,
  root: string,
  unread: readonly string[],
  nothing: string,
  groupName: (key: Answer['groups'][number]['key']) => string,
): string {
  let left = MOST
  const groups = answer.groups
    .map((group) => {
      const rows = group.rows.slice(0, Math.max(left, 0))
      left -= rows.length
      if (!rows.length) return ''
      const name = groupName(group.key)
      const head = name
        ? `<p class="nib-section">${escapeAll(name)}<span>${group.rows.length}</span></p>`
        : ''
      return head + rows.map((one) => row(one, root)).join('')
    })
    .join('')
  const unreadLines = unread.length
    ? `<p class="nib-query-none">${unread.map((line) => escapeAll(line)).join('<br>')}</p>`
    : ''
  const body = groups || `<p class="nib-query-none">${escapeAll(nothing)}</p>`
  return `<div class="nib-query">${body}${unreadLines}</div>`
}

/** What one fence answers with, or null where there is nothing to answer from. */
export async function tasksRowsHtml(code: string, nothing: string): Promise<string | null> {
  const [{ answer, groupName }, { readTasksQuery }, { todayOf }, space] = await Promise.all([
    import('@nib/bases/answer'),
    import('@nib/bases/tasks-query'),
    import('@nib/bases'),
    rowsOfSpace(),
  ])
  if (!space) return null
  const { base, unsupported } = readTasksQuery(code)
  const now = new Date()
  const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString()
  const result = answer(base, 0, space.rows, { today: todayOf(now), now: stamp.slice(0, 19) })
  return drawn(result, space.root, unsupported, nothing, groupName)
}
