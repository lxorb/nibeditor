/** `@nib/bases`: the one place a question about rows is answered. A note is a row
 *  whose columns are its front matter, a task line is a row whose columns are its
 *  fields, and a view of either is Obsidian's `.base` format answered by
 *  Obsidian's expression language. Pure: no DOM, no I/O, nothing per keystroke.
 *  See docs/tasks.md. */

export * from './types'
export { noteValues, scalarValue, taskHash } from './note-values'
export { finish, nextOccurrence, type OccurrenceOptions, skip, tick } from './occurrence'
export { todayOf } from './dates'
