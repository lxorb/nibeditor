/** An agent's verbs in the workspace, answered in the window (docs/agent-native.md 5.1,
 *  5.3, 5.4, 8.6 to 8.9).
 *
 *  Reached only through the dispatcher every verb goes through (automation/verbs.ts),
 *  which has already checked the scope the verb's row names before this module is even
 *  fetched: nothing of lib/agents is loaded until the first agent request. What is
 *  checked here is everything a row cannot say - which space, which op, what asks the
 *  reader first - and every verb is the call the app itself makes, so an agent can only
 *  do what a person at the keyboard could, and it happens the same way: visible,
 *  undoable, synced.
 *
 *  Every answer is the contract's (src-tauri/src/agents/verbs.rs `Answer`): done with
 *  where its words came from when that is outside nib, a question put to the reader, or
 *  a refusal with a code an agent can act on. */

import type { Said } from '../../automation/args'
import type { AgentAnswer, Caller } from '../../automation/caller'
import { workspace } from '../../workspace.svelte'
import { bookmarks } from './bookmarks'
import { type Call, done } from './call'
import { readCanvas, editCanvas } from './canvas'
import { captureToNote } from './capture'
import { runCommand } from './commands'
import { listBacklinks, searchNotes } from './find'
import { attachAgentLog } from './log'
import {
  appendNote,
  createNote,
  editNote,
  readNote,
  setProperty,
  setTask,
  writeNote,
} from './notes'
import { pdfHighlights, readPdf } from './pdf'
import { answerOf, Refused } from './problem'
import { readSetting, writeSetting } from './settings'
import { addRow, addTask, editBase, editRows, listTasks, queryBase, updateTask } from './tasks'
import { reachable } from './spaces'
import { getContext, workspaceTabs } from './tabs'
import { runTerminal } from './terminal'
import { readTerminal, typeTerminal } from './terminal-tab'
import { recentlyDeleted } from './deleted'
import { createFolder, listNotes, moveFile, trashFile } from './tree'
import { listVersions, restoreVersion } from './versions'

export { answerTheCrate } from './crate'

/** The spaces this agent may reach, and which of them is open. */
function listSpaces(call: Call): AgentAnswer {
  return done(
    reachable(call).map((space) => ({
      id: space.id,
      name: space.name,
      open: space.id === workspace.activeSpace?.id,
    })),
  )
}

const VERBS: Record<string, (call: Call) => AgentAnswer | Promise<AgentAnswer>> = {
  get_context: getContext,
  list_spaces: listSpaces,
  list_notes: listNotes,
  search_notes: searchNotes,
  list_backlinks: listBacklinks,
  read_note: readNote,
  list_versions: listVersions,
  read_canvas: readCanvas,
  read_pdf: readPdf,
  pdf_highlights: pdfHighlights,
  edit_note: editNote,
  write_note: writeNote,
  append_note: appendNote,
  set_property: setProperty,
  set_task: setTask,
  list_tasks: listTasks,
  add_task: addTask,
  update_task: updateTask,
  query_base: queryBase,
  add_row: addRow,
  edit_rows: editRows,
  edit_base: editBase,
  create_note: createNote,
  restore_version: restoreVersion,
  edit_canvas: editCanvas,
  capture_to_note: captureToNote,
  attach_agent_log: attachAgentLog,
  move_file: moveFile,
  trash_file: trashFile,
  create_folder: createFolder,
  workspace_tabs: workspaceTabs,
  bookmarks,
  run_command: runCommand,
  read_setting: readSetting,
  write_setting: writeSetting,
  run_terminal: runTerminal,
  read_terminal: readTerminal,
  type_terminal: typeTerminal,
  recently_deleted: recentlyDeleted,
}

/** Every verb here, by name: the dispatcher's agent rows, which a test holds to this. */
export const AGENT_VERBS = Object.keys(VERBS)

/** Runs one of an agent's verbs. Answers rather than throws, like the dispatcher. */
export async function runAgentVerb(name: string, args: Said, caller: Caller): Promise<AgentAnswer> {
  const verb = VERBS[name]
  if (!verb) return answerOf(new Refused('bad_arguments', `there is no verb called ${name}`))

  try {
    return await verb({ verb: name, args, caller })
  } catch (error) {
    return answerOf(error)
  }
}
