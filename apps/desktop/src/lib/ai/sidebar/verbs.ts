/** What a tool row says: one verb and one object, "Read Herons", "Opened example.org",
 *  "Edited Reading/Birds" (docs/ai-sidebar.md 4.3). The verb is a word of the
 *  catalogues, picked by the tool's name; the object is the note's name, the page's
 *  host or the search's words, read from the call's arguments. A tool this table does
 *  not know says its own name, which is better than a guess. Pure. */

import { key } from '../../i18n.svelte'
import { nameOf } from '../../space-paths'

/** The verb each of nib's tools is said with, past tense: the row is drawn as the
 *  call goes and stays once it is done, and a pulse says which are still going. */
const VERBS: Record<string, string> = {
  read_note: key('Read'),
  read_canvas: key('Read'),
  read_pdf: key('Read'),
  browser_read: key('Read'),
  browser_snapshot: key('Read'),
  browser_find: key('Read'),
  browser_screenshot: key('Read'),
  browser_console: key('Read'),
  browser_network: key('Read'),
  browser_downloads: key('Read'),
  search_notes: key('Searched'),
  list_notes: key('Listed'),
  list_spaces: key('Listed'),
  list_backlinks: key('Listed'),
  list_versions: key('Listed'),
  browser_tabs: key('Listed'),
  workspace_tabs: key('Listed'),
  bookmarks: key('Listed'),
  get_context: key('Checked'),
  agent_status: key('Checked'),
  approval_status: key('Checked'),
  read_setting: key('Checked'),
  edit_note: key('Edited'),
  write_note: key('Edited'),
  append_note: key('Edited'),
  set_property: key('Edited'),
  set_task: key('Edited'),
  edit_canvas: key('Edited'),
  pdf_highlights: key('Edited'),
  create_note: key('Created'),
  create_folder: key('Created'),
  capture_to_note: key('Created'),
  attach_agent_log: key('Created'),
  move_file: key('Moved'),
  trash_file: key('Deleted'),
  restore_version: key('Restored'),
  browser_open: key('Opened'),
  browser_navigate: key('Opened'),
  browser_show: key('Opened'),
  browser_click: key('Clicked'),
  browser_hover: key('Clicked'),
  browser_drag: key('Clicked'),
  browser_type: key('Typed'),
  browser_fill_form: key('Typed'),
  browser_select: key('Typed'),
  browser_press: key('Typed'),
  browser_upload: key('Typed'),
  browser_scroll: key('Scrolled'),
  browser_wait: key('Waited'),
  browser_close: key('Closed'),
  browser_evaluate: key('Ran'),
  browser_dialog: key('Clicked'),
  run_command: key('Ran'),
  run_terminal: key('Ran'),
  write_setting: key('Changed'),
}

/** A tool's own name, whichever road called it: Claude Code says `mcp__nib__read_note`. */
export function bareName(verb: string): string {
  return verb.replace(/^mcp__.+?__/, '')
}

/** The catalogue key the row's verb is, or null for a tool this table does not know. */
export function verbOf(verb: string): string | null {
  return VERBS[bareName(verb)] ?? null
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** A note's path as the row names it: the name, without its extension. */
function noteName(path: string): string {
  return nameOf(path).replace(/\.(?:md|markdown|canvas|pdf)$/i, '')
}

/** What the call was about, in a few words, or the empty string. */
export function objectOf(args: unknown): string {
  const said = record(args)
  for (const field of ['path', 'to', 'from', 'note', 'file']) {
    const value = said[field]
    if (typeof value === 'string' && value) return noteName(value)
  }
  if (typeof said.url === 'string' && said.url) return host(said.url)
  if (typeof said.query === 'string' && said.query) return `“${said.query.slice(0, 60)}”`
  for (const field of ['title', 'name', 'text', 'command']) {
    const value = said[field]
    if (typeof value === 'string' && value) return value.slice(0, 60)
  }
  return ''
}
