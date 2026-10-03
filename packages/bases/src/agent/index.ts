/** What both servers' task and base verbs share: `nib mcp`'s window verbs and the
 *  account connector read their arguments, answer their rows and work out their edits
 *  here, and only reading and writing the notes is each server's own
 *  (docs/tasks.md 5.15). Its own entry, `@nib/bases/agent`. */

export { readBase, writeBase } from '../base-file'
export { editedBase, noteName, rowPlace, withProperties } from './bases'
export { editedTask, type Edited, movedTask, taskIn } from './edit'
export {
  clockOf,
  listTasks,
  type ListAsk,
  plainValue,
  queryBase,
  type QueryOut,
  VIEWS,
} from './listing'
export {
  AgentError,
  atOf,
  findTask,
  newTask,
  placeLines,
  readAt,
  type ReadWords,
  taskBlock,
  taskChange,
  taskOut,
  type TaskOut,
  writtenFields,
} from './tasks'
