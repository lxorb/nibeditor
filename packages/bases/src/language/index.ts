/** Quick add's grammar: a line of words read as a task's fields, in English and German
 *  (docs/tasks.md 5.6). Its own entry, `@nib/bases/language`, so a page that never adds
 *  a task never loads a word of it. */

export { type Chip, type ChipKind, parseQuickAdd, type QuickAdd, type QuickAddOptions, type QuickFields } from './parse'
