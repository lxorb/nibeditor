/** Adding to a view: a task where the view says (its note, its day, its label, the
 *  column the plus was pressed in), or for a view of notes, a note where its filter
 *  points with its properties written in - the Bases bug of new rows landing at the
 *  root, fixed (docs/tasks.md 4).
 *
 *  A task is quick add's to read and write (quick-add/, docs/tasks.md 5.6), opened with
 *  what this view would prefill. A column that stands for a section, a priority or a
 *  status is more than quick add can carry, and there the view's own add row writes
 *  the words as they were typed, with the prefill's fields, through `addTask`. */

import type { Base, Filter, Priority, Value } from '@nib/bases'
import { joinPath } from '../tauri'
import { folderOf, insideSpace, withinSpace } from '../space-paths'
import { showQuickAdd } from '../surfaces.svelte'
import { rows } from '../rows/rows.svelte'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { addTask } from './act'
import { bare, isNoteProperty } from './columns'
import { isPriority } from './drop'
import type { ViewSpec } from './spec'
import { dayIn } from './values'

/** What a new task starts with, from the view and the group it was added in. */
export interface Prefill {
  /** The note it is written in, on this disk; the open space's inbox where absent. */
  path?: string
  heading?: string
  due?: string
  tags?: string[]
  priority?: Priority
  status?: string
}

/** Quick add, opened with what the view would prefill, where that is all quick add can
 *  carry: its note in the open space, its tags, its day. Answers whether it opened. */
export function openQuickAdd(prefill: Prefill = {}): boolean {
  if (
    prefill.heading !== undefined ||
    prefill.priority !== undefined ||
    prefill.status !== undefined
  )
    return false
  const root = workspace.activeSpace?.root ?? null
  const note =
    prefill.path === undefined ? undefined : root === null ? null : withinSpace(root, prefill.path)
  if (note === null) return false

  showQuickAdd({
    ...(note === undefined ? {} : { note }),
    ...(prefill.tags ? { tags: prefill.tags } : {}),
    ...(prefill.due ? { due: prefill.due } : {}),
  })
  return true
}

/** What a task added to this view starts with. `group` is the property the view groups
 *  by and the key of the group the add was pressed in, where it was pressed in one. */
export function prefillOf(
  spec: ViewSpec,
  today: string,
  group?: { property: string; key: Value },
): Prefill {
  const out: Prefill = {}
  if (spec.builtin === 'today') out.due = today
  if (spec.builtin === 'label' && spec.tag) out.tags = [spec.tag]
  if (spec.builtin === 'project' && spec.space !== undefined && spec.path !== undefined) {
    const space = workspace.spaces.find((one) => one.name === spec.space)
    if (space) out.path = insideSpace(space.root, spec.path)
  }
  if (!group) return out

  const { property, key } = group
  if (property === 'task.section' && typeof key === 'string') out.heading = key
  else if (property === 'task.priority' && isPriority(key)) out.priority = key
  else if (property === 'task.status' && typeof key === 'string') out.status = key
  else if (property === 'formula.day' || /^task\.(due|date|scheduled)$/.test(property)) {
    // A day of Upcoming, a date column: the day the group is.
    const day = dayIn(key)
    if (day) out.due = day
  }
  return out
}

/** The task written as the words were typed, with the prefill's fields. */
export async function addTyped(words: string, prefill: Prefill): Promise<boolean> {
  const text = words.trim()
  if (!text) return false
  const path = prefill.path ?? (await rows.inbox())
  if (path === null) return false
  return addTask(
    path,
    {
      text,
      ...(prefill.due ? { due: prefill.due } : {}),
      ...(prefill.tags ? { tags: prefill.tags } : {}),
      ...(prefill.priority ? { priority: prefill.priority } : {}),
      ...(prefill.status ? { status: prefill.status } : {}),
    },
    prefill.heading,
  )
}

/** The folder a filter names with `file.inFolder("…")`, where it names one. */
function folderIn(filter: Filter | undefined): string | null {
  if (filter === undefined) return null
  if (typeof filter === 'string')
    return /file\.inFolder\("((?:[^"\\]|\\.)*)"\)/.exec(filter)?.[1] ?? null
  const members = 'and' in filter ? filter.and : 'or' in filter ? filter.or : []
  for (const one of members) {
    const found = folderIn(one)
    if (found !== null) return found
  }
  return null
}

/** The properties a filter pins with `note.key == "value"`, which a new row is given
 *  so it belongs to the view it was made in. Only from an `and`: an `or` pins nothing. */
function pinned(filter: Filter | undefined): Record<string, string> {
  if (filter === undefined) return {}
  const members = typeof filter === 'string' ? [filter] : 'and' in filter ? filter.and : []
  const out: Record<string, string> = {}
  for (const one of members) {
    if (typeof one !== 'string') continue
    const found = /^\s*(?:note\.)?([A-Za-z_][\w-]*)\s*==\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(one)
    if (found?.[1] && found[2] !== undefined && !['file', 'task', 'formula'].includes(found[1])) {
      out[found[1]] = found[2]
    }
  }
  return out
}

/** A new note for a view of notes: in the folder its filter names, with the
 *  properties its filter pins and the group's value, opened for its name. `base` is
 *  the view's base, `file` the base file it is in (its space and folder), if any. */
export async function addNote(
  base: Base,
  at: number,
  file: string | null,
  group?: { property: string; key: Value },
): Promise<void> {
  const space = workspace.activeSpace
  if (!space) return
  const view = base.views[at]
  const folder = folderIn(view?.filters) ?? folderIn(base.filters)
  const dir = folder !== null ? joinPath(space.root, folder) : file ? folderOf(file) : space.root

  const props = { ...pinned(base.filters), ...pinned(view?.filters) }
  // The column the plus was pressed in: the value its property has there.
  const key = group?.key
  if (
    group &&
    isNoteProperty(group.property) &&
    (typeof key === 'string' || typeof key === 'number')
  ) {
    props[bare(group.property)] = String(key)
  }

  const name = workspace.freeName(dir, 'Untitled.md')
  const path = joinPath(dir, name)
  const front = Object.entries(props).map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
  const content = front.length ? `---\n${front.join('\n')}\n---\n\n` : ''
  await writeFile(path, content)
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  await workspace.open(path)
}
