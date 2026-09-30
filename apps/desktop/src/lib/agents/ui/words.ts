/** What an agent is doing, in one word: the verb it called, said the way somebody
 *  watching would say it.
 *
 *  Fifty-odd verbs come to ten words, because the reader wants to know whether it
 *  is reading, writing or pressing things, not which of five ways of reading a page it
 *  chose. The verbs that are bookkeeping - asking for its own status, pairing, saying
 *  goodbye - have no word and are not shown as something it did. */

import { key, t } from '../../i18n.svelte'

const OPENING = key('Opening')
const READING = key('Reading')
const PRESSING = key('Pressing')
const TYPING = key('Typing')
const WRITING = key('Writing')
const WAITING = key('Waiting')
const RUNNING = key('Running')

/** Each verb's word, untranslated: the key its row is filed under. */
const WORDS: Readonly<Record<string, string>> = {
  browser_tabs: READING,
  browser_open: OPENING,
  browser_navigate: OPENING,
  browser_wait: WAITING,
  browser_snapshot: READING,
  browser_find: READING,
  browser_read: READING,
  browser_click: PRESSING,
  browser_type: TYPING,
  browser_press: PRESSING,
  browser_scroll: READING,
  browser_select: TYPING,
  browser_fill_form: TYPING,
  browser_hover: PRESSING,
  browser_drag: PRESSING,
  browser_upload: TYPING,
  browser_screenshot: READING,
  browser_console: READING,
  browser_network: READING,
  browser_evaluate: RUNNING,
  browser_dialog: PRESSING,
  browser_downloads: READING,
  browser_storage: READING,
  browser_close: key('Closing'),
  browser_show: OPENING,
  browser_takeover: key('Waiting for you'),
  get_context: READING,
  list_spaces: READING,
  list_notes: READING,
  search_notes: key('Searching'),
  list_backlinks: READING,
  read_note: READING,
  list_versions: READING,
  read_canvas: READING,
  read_pdf: READING,
  pdf_highlights: READING,
  edit_note: WRITING,
  write_note: WRITING,
  append_note: WRITING,
  set_property: WRITING,
  set_task: WRITING,
  create_note: WRITING,
  restore_version: WRITING,
  edit_canvas: WRITING,
  capture_to_note: WRITING,
  attach_agent_log: WRITING,
  move_file: WRITING,
  trash_file: key('Deleting'),
  create_folder: WRITING,
  workspace_tabs: OPENING,
  bookmarks: WRITING,
  run_command: RUNNING,
  read_setting: READING,
  write_setting: WRITING,
  run_terminal: RUNNING,
}

/** The word for a verb, translated, or null for bookkeeping. */
export function wordFor(verb: string): string | null {
  const word = WORDS[verb]
  return word === undefined ? null : t(word)
}
