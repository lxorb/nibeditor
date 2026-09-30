/** The crate's agent verbs, their answers and its events, as the window reads them.
 *
 *  A mirror of `src-tauri/src/agents/verbs.rs` and `grants.rs`, types only: the crate
 *  answers every one of these itself, and the window hears the events on
 *  `nib://agent`. `verbs.test.ts` holds the list of names to the crate's table, so a
 *  verb cannot be added on one side only. See docs/agent-native.md 13.1. */

/** The event the crate's news arrives on. */
export const AGENT_EVENT = 'nib://agent'

/** Every verb the crate answers, in the crate's order. */
export const BROWSER_VERBS = [
  'browser_tabs',
  'browser_open',
  'browser_navigate',
  'browser_wait',
  'browser_snapshot',
  'browser_find',
  'browser_read',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_select',
  'browser_fill_form',
  'browser_hover',
  'browser_drag',
  'browser_upload',
  'browser_screenshot',
  'browser_console',
  'browser_network',
  'browser_evaluate',
  'browser_dialog',
  'browser_downloads',
  'browser_storage',
  'browser_close',
  'browser_show',
  'browser_takeover',
  'agent_status',
  'approval_status',
  'agent_pair',
  'agent_bye',
] as const

/** A verb the crate answers. */
export type BrowserVerb = (typeof BROWSER_VERBS)[number]

/** The window's verbs an agent may call, with the scope each needs at the least; the
 *  crate refuses anything else from an agent before the window hears it. The window's
 *  dispatcher is handed the caller's `Grant` as `agent` beside the verb. */
export const AGENT_WINDOW_VERBS: Readonly<Record<string, Scope | null>> = {
  get_context: 'context',
  list_spaces: null,
  list_notes: 'notes.read',
  search_notes: 'notes.read',
  list_backlinks: 'notes.read',
  read_note: 'notes.read',
  list_versions: 'notes.read',
  read_canvas: 'notes.read',
  read_pdf: 'notes.read',
  pdf_highlights: 'notes.read',
  edit_note: 'notes.write',
  write_note: 'notes.write',
  append_note: 'notes.write',
  set_property: 'notes.write',
  set_task: 'notes.write',
  create_note: 'notes.write',
  restore_version: 'notes.write',
  edit_canvas: 'notes.write',
  capture_to_note: 'notes.write',
  attach_agent_log: 'notes.write',
  move_file: 'tree',
  trash_file: 'tree',
  create_folder: 'tree',
  workspace_tabs: 'workspace',
  bookmarks: 'workspace',
  run_command: 'workspace',
  read_setting: null,
  write_setting: 'settings',
  run_terminal: 'terminal',
}

/** The window's verbs the crate asks on an agent's behalf. Each is optional: a window
 *  that does not answer gets the crate's own best answer instead. */
export const CRATE_ASKS = {
  /** Answers `ReaderTab[]`: the reader's web tabs with their space and whether in
   *  front and on screen. */
  readerTabs: 'agent.reader_tabs',
  /** Takes `StoreAsk`, answers `StoreSaid`: which store the reader's tabs of a space
   *  use for an address, as `web-data.ts` decides. */
  storeFor: 'agent.store_for',
  /** Takes `{ html, url }`, answers the markdown `@nib/markdown/from-html` makes. */
  markdown: 'agent.markdown',
} as const

// ---- the grant ------------------------------------------------------------------------

/** What an agent may reach. */
export type Scope =
  | 'context'
  | 'notes.read'
  | 'notes.write'
  | 'tree'
  | 'workspace'
  | 'workspace.focus'
  | 'browser'
  | 'browser.reader'
  | 'browser.script'
  | 'browser.network'
  | 'browser.storage'
  | 'settings'
  | 'terminal'

/** What a question is about (9.3), and the questions nib asks for itself. */
export type Category =
  | 'paying'
  | 'sending'
  | 'publishing'
  | 'deleting'
  | 'signing_in'
  | 'settings'
  | 'terminal'
  | 'files'
  | 'writing'
  | 'showing'
  | 'takeover'
  | 'pairing'

/** What a grant says about one site. */
export type SiteRule = 'allow' | 'deny' | 'agent-store'

/** An agent, as `agents_read` answers and `agents_write` takes it. */
export interface Grant {
  id: string
  name: string
  client: string
  scopes: Scope[]
  spaces: 'all' | string[]
  sites: Record<string, SiteRule>
  /** The sites `browser.script` reaches. */
  scripts: string[]
  mode: 'unsupervised' | 'confirm'
  /** A category left out asks. */
  asks: Partial<Record<Category, boolean>>
  /** "Always on this site". */
  always: Record<string, Category[]>
  /** The programs `run_terminal` starts without asking. */
  programs: string[]
  limits: { tabs: number; calls: number; navigations: number }
  /** Milliseconds since 1970. */
  created: number
}

/** `agents_mint`: a grant made by hand, with its token, said once. */
export interface Minted {
  grant: Grant
  token: string
}

// ---- answers --------------------------------------------------------------------------

/** Why a call was not done. */
export type Code =
  | 'unsupported_on_this_engine'
  | 'bad_arguments'
  | 'not_granted'
  | 'site_denied'
  | 'no_such_tab'
  | 'no_such_ref'
  | 'paused_by_reader'
  | 'stopped'
  | 'password_field'
  | 'limit'
  | 'timeout'
  | 'failed'
  | 'no_dialog'
  | 'denied'
  | 'in_use_elsewhere'

/** A dialog a page is holding open. */
export interface Dialog {
  kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
  default_text?: string
  url: string
  open_ms: number
}

/** Every answer the crate gives. */
export type Answer =
  | { status: 'ok'; result: unknown; untrusted?: string; dialog?: Dialog }
  | { status: 'needs_approval'; approval: string; summary: string }
  | { status: 'error'; code: Code; message: string; dialog?: Dialog }

/** Which store an agent tab is in. */
export type Store = 'reader' | 'agent' | 'space'

/** A reader's web tab. */
export interface ReaderTab {
  id: string
  title: string
  url: string
  space?: string
  front: boolean
  on_screen: boolean
}

/** An agent's own tab. */
export interface AgentTab {
  id: string
  url: string
  title: string
  loading: boolean
  store: Store
  parked: boolean
}

/** `agent.store_for`'s arguments. */
export interface StoreAsk {
  space?: string
  url: string
}

/** `agent.store_for`'s answer: `null` for the store every space shares. */
export interface StoreSaid {
  space: string
  store: string | null
}

/** Where a question has got to. */
export type ApprovalAnswer = 'pending' | 'allowed' | 'denied' | 'expired' | 'done'

/** A question the reader is asked. */
export interface Approval {
  id: string
  agent: string
  name: string
  category: Category
  summary: string
  site?: string
  tab?: string
  /** Milliseconds since 1970. */
  asked: number
  answer: ApprovalAnswer
}

/** Why an agent is paused. */
export type PausedBy = 'reader' | 'takeover' | 'stop'

/** `browser_open`'s answer: the store is the agent's own when the site is kept to it,
 *  whatever was asked. */
export interface Opened {
  tab: string
  store: Store
}

// ---- the window's commands ------------------------------------------------------------

/** The commands the window calls the crate with: the settings pane (`agents_read`,
 *  `agents_write`, `agents_mint`), the activity panel, `capture_to_note`'s reading of a
 *  page (`agents_capture`), and the agent harness's one test hook
 *  (`agents_test_reader_focus`), which answers only in debug and probe builds. Each
 *  answers only nib's own window. */
export const AGENT_COMMANDS = [
  'agents_read',
  'agents_write',
  'agents_mint',
  'agents_stop',
  'agents_resume',
  'agents_answer',
  'agents_ask',
  'agents_state',
  'agents_log',
  'agents_adopt',
  'agents_capture',
  'agents_test_reader_focus',
] as const

/** `agents_state`: everything the activity panel draws from at once; the events keep it
 *  current after. `tabs` and `paused` are `[agent, tab]` pairs. */
export interface Overview {
  agents: Grant[]
  tabs: [string, AgentTab][]
  approvals: Approval[]
  stopped: boolean
  paused: [string, string][]
}

/** What `agents_capture` reads a page as: the article for a clip, a picture with every
 *  filled secret field painted over, or a PDF on the reader's paper. */
export const CAPTURE_AS = ['clip', 'screenshot', 'pdf'] as const
export type CaptureAs = (typeof CAPTURE_AS)[number]

/** `agents_capture`'s result, inside an `ok` answer marked with the page's address: the
 *  one of `html`, `png` and `pdf` that was asked for, the last two as base64. */
export interface Captured {
  url: string
  title: string
  html?: string
  png?: string
  pdf?: string
}

// ---- events ---------------------------------------------------------------------------

/** The crate's news, on `AGENT_EVENT`. */
export type AgentEvent =
  | { kind: 'acting'; agent: string; tab: string; verb: string }
  | { kind: 'paused'; agent: string; tab?: string; by: PausedBy }
  | { kind: 'resumed'; agent: string; tab?: string }
  | { kind: 'asked'; approval: Approval }
  | { kind: 'answered'; approval: Approval }
  | { kind: 'tab'; agent: string; id: string; url: string; title: string }
  | { kind: 'closed'; agent: string; id: string }
  | { kind: 'stopped'; closed: boolean }
