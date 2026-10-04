/** The half of the task verbs that carries no engine, its own entry
 *  (`@nib/bases/tasks`): a task as it is shown and handed back, a new one's line and
 *  where it goes, the clock, and Today by hand. What the glasses' package reads, which
 *  is held under 8 MiB; everything here is also in `@nib/bases/agent`. */

export { clockOf } from './clock'
export { editedTask } from './edit'
export { todayTasks } from './today'
export { AgentError, atOf, findTask, placeLines, readAt, taskOut, type TaskOut } from './tasks'
