/** What both servers' task and base verbs share: `nib mcp`'s window verbs and the
 *  account connector read their arguments, answer their rows and work out their edits
 *  here, and only reading and writing the notes is each server's own
 *  (docs/tasks.md 5.15). Its own entry, `@nib/bases/agent`; the half without the
 *  engine is `@nib/bases/tasks` (light.ts). */

export { readBase, writeBase } from '../base-file'
export { editedBase, noteName, rowPlace, withProperties } from './bases'
export { clockOf } from './clock'
export { editedTask, type Edited, movedTask, taskIn } from './edit'
export { type Entry, linesOf, placedEdit, placeIn, type Placed, taskOf } from './entry'
export { listTasks, type ListAsk, plainValue, queryBase, type QueryOut, VIEWS } from './listing'
export {
  AgentError,
  atOf,
  findTask,
  newTask,
  readAt,
  type ReadWords,
  taskBlock,
  taskChange,
  taskOut,
  type TaskOut,
  writtenFields,
} from './tasks'
export { todayTasks } from './today'
export { quickWords } from './words'
