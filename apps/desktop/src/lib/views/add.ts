/** Adding to a view: a task where the view says (its note, its day, its label, the
 *  column the plus was pressed in), or for a view of notes, a note where its filter
 *  points with its properties written in - the Bases bug of new rows landing at the
 *  root, fixed (docs/tasks.md 4) - from the base's template and with its next id.
 *
 *  A task is quick add's to read and write (quick-add/, docs/tasks.md 5.6), opened with
 *  what this view would prefill. A column that stands for a section, a priority or a
 *  status is more than quick add can carry, and there the view's own add row writes
 *  the words as they were typed, with the prefill's fields, through `addTask`. */

import { type Base, inBase, nextId, type Priority, type Value } from '@nib/bases'
import { noteName, plainValue, rowPlace, withProperties } from '@nib/bases/agent'
import { joinPath } from '../tauri'
import { folderOf, insideSpace, withinSpace } from '../space-paths'
import { contextFor } from './context'
import { nowHere, todayHere } from './days'
import { templatePath, templateWords } from './templates'
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

/** What a new note of a view of notes is made with: a name, its own properties, and the
 *  template it starts from (the view's or the base's where absent, none for null). */
export interface NewNote {
  title?: string
  properties?: Record<string, Value>
  template?: string | null
  /** Opened in a tab for its name, as a plus does; a form stays where it is. */
  open?: boolean
}

/** The row's next id where the base keeps them, counted over the base's own rows. */
function idFor(base: Base): Record<string, string> {
  const id = base.nib.id
  const space = workspace.activeSpace
  if (!id || !space) return {}
  const mine = rows.of(space.name)
  const context = contextFor({ rows: mine, today: todayHere(), now: nowHere() })
  const own = mine.filter((row) => inBase(base, row, context))
  return { [id.property]: nextId(own, id.property, id.prefix) }
}

/** A new note for a view of notes: in the folder its filter names, with the
 *  properties its filter pins and the group's value, from its template, with the base's
 *  next id; opened for its name unless `made.open` is false. `base` is the view's base,
 *  `file` the base file it is in (its folder), if any. Answers its path. */
export async function addNote(
  base: Base,
  at: number,
  file: string | null,
  group?: { property: string; key: Value },
  made: NewNote = {},
): Promise<string | null> {
  const space = workspace.activeSpace
  if (!space) return null
  const view = base.views[at]
  const place = rowPlace(base, view?.name)
  const dir =
    place.folder !== undefined && place.folder !== ''
      ? joinPath(space.root, place.folder)
      : file
        ? folderOf(file)
        : space.root

  const props: Record<string, unknown> = { ...place.properties }
  // The column the plus was pressed in: the value its property has there.
  const key = group?.key
  if (
    group &&
    isNoteProperty(group.property) &&
    (typeof key === 'string' || typeof key === 'number')
  ) {
    props[bare(group.property)] = key
  }
  for (const [name, value] of Object.entries(made.properties ?? {})) props[name] = plainValue(value)
  Object.assign(props, idFor(base))

  const title = noteName(made.title ?? 'Untitled')
  const name = workspace.freeName(dir, `${title}.md`)
  const link =
    made.template === undefined ? (view?.nib.template ?? base.nib.template) : made.template
  const template = link ? templatePath(link) : null
  const words = template === null ? '' : await templateWords(template, name.replace(/.md$/i, ''))
  const path = joinPath(dir, name)
  await writeFile(path, withProperties(words, props))
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  if (made.open !== false) await workspace.open(path)
  return path
}
