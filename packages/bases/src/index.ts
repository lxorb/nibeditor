/** `@nib/bases`: the one place a question about rows is answered. A note is a row
 *  whose columns are its front matter, a task line is a row whose columns are its
 *  fields, and a view of either is Obsidian's `.base` format answered by
 *  Obsidian's expression language. Pure: no DOM, no I/O, nothing per keystroke.
 *  See docs/tasks.md. */

export * from './types'
// What the views (apps/desktop/src/lib/views) and the rows store ask of the engine.
export { noteValues, scalarValue, taskHash } from './note-values'
export { finish, nextOccurrence, type OccurrenceOptions, skip, tick } from './occurrence'
export { answer, cellValue, groupName, rowId } from './answer'
export { readBase, writeBase } from './base-file'
export { type BuiltinName, type BuiltinParams, builtinView } from './builtins'
export { addDays, addMonths, dayNumber, daysInMonth, todayOf, weekday } from './dates'
export { nextDate, parseRule, ruleText } from './recurrence'
export { DEFAULT_SUMMARIES } from './summaries'
export { fromTodoist } from './todoist'
// What lane 7 adds (docs/tasks.md 5.12, 5.13): relations seen back, rollups, ids, colour,
// templates, buttons, automations and CSV.
export {
  readRollup,
  readReverse,
  reverseFormula,
  type Rollup,
  rollupFormula,
  ROLLUPS,
  type RollupSpec,
} from './rollup'
export { idNumber, idRepairs, idText, nextId } from './ids'
export { type ColourRule, colourExpression, colourRules } from './colour'
export { fillTemplate, type Filling, repeatDue, withoutTemplateKeys } from './templates'
export {
  BUTTON,
  type Button,
  isButton,
  type Press,
  pressed,
  readButtons,
  withButton,
} from './buttons'
export {
  type Automation,
  type Effect,
  fired,
  inBase,
  readAutomations,
  type Trigger,
  withAutomations,
} from './automations'
export { csvText, csvValue } from './csv'
