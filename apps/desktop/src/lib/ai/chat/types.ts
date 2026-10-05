/** What the sidebar's lanes meet at: a thread, the parts a turn is drawn from, the
 *  engine that answers one, and the shapes the review and the commands hang off
 *  (docs/ai-sidebar.md 6.1).
 *
 *  Written first, so the panel (lane 4), the review (lane 3) and the commands (lane 5)
 *  can build against a fake engine while this one is built. Types only: nothing here
 *  runs, so importing it costs nothing. */

import type { Limit } from '../local/heard'
import type { Mode } from '../modes'
import type { Provider, ProviderKind } from '../providers'

/** What the agent may do in a thread, and how much it asks first (../modes.ts). */
export type { Mode }

/** nib's one scale of effort (4.9). `auto` is the model's own default and is sent as
 *  nothing; `off` is OpenAI's `none`; `xhigh` is the chip's Extra. A model offers only
 *  the levels it has. */
export type Effort = 'auto' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One model, as its provider's own list describes it. Nothing here is written down in
 *  the source: what a provider does not say is null, or learnt from a refusal. */
export interface ModelInfo {
  id: string
  /** What the popover calls it: the provider's display name, else the id. */
  name: string
  /** The context window in tokens, or null where nobody has said. */
  window: number | null
  /** The levels this model takes, `auto` first, in the scale's order. */
  efforts: Effort[]
  /** Whether a picture can be sent to it. */
  images: boolean
  /** Whether the provider has a faster tier for it. */
  fast: boolean
  /** The most one answer may be, where the provider says. */
  output?: number
  /** Whether it thinks in summarised blocks that are sent back (Claude's adaptive
   *  thinking). */
  thinking?: boolean
  /** Whether the provider compacts a conversation for it on request. */
  compaction?: boolean
}

/** What one request cost, in the provider's own counts. `input` is the whole of what was
 *  sent, cached or not, so `input + output` is how full the window is for the next one. */
export interface Usage {
  input: number
  /** The part of `input` read from the provider's cache. */
  cached: number
  output: number
  /** The part of `output` spent thinking, where the provider says. */
  reasoning: number
  window: number | null
  /** Money, only where the provider reports it (OpenRouter's `cost`). */
  cost?: number
}

/** Where a tool call stands. `asking` is `needs_approval`: the reader was asked. */
export type ToolState = 'running' | 'ok' | 'error' | 'asking'

/** What a tool's answer was: the text a model reads, with nib's marks round words from
 *  outside, and any pictures. The crate writes it, the way `nib mcp` writes it for an
 *  outside agent (src-tauri/src/mcp/results.rs). */
export interface ToolOutput {
  text: string
  images: { mime: string; data: string }[]
  error: boolean
  /** The question's id, when the call asked the reader. */
  approval?: string
}

/** Why the engine says something between the words: a code the panel words, and the
 *  provider's or the model's own text where there is any. Never a sentence of nib's: the
 *  catalogues are the panel's (lane 4). */
export type NoticeCode =
  /** The older turns became a summary. */
  | 'compacted'
  /** Another model answers from here; `text` is its name. */
  | 'model'
  /** The tool loop reached its step limit and stopped. */
  | 'steps'
  /** The answer reached its length limit. */
  | 'max_tokens'
  /** The model declined; `text` is the provider's category, where it gave one. */
  | 'refusal'
  /** The request failed; `text` is the provider's words. */
  | 'error'
  /** The reader stopped it. */
  | 'stopped'
  /** The server refused tools, so the thread answers without them. */
  | 'no_tools'
  /** A command's own line (lane 5): a goal that ended, a subtask's answer, `/status`.
   *  `text` is already worded, in the reader's language; never sent to the model. */
  | 'command'
  /** To-dos a command listed (`/tasks`): `text` is their JSON (commands/todos.ts
   *  `Listed`), drawn as rows with live boxes; never sent to the model. */
  | 'tasks'

/** One piece of a turn, in the order it arrived. */
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; ms: number }
  | {
      kind: 'tool'
      id: string
      verb: string
      args: unknown
      state: ToolState
      result?: ToolOutput
      change?: { path: string; added: number; removed: number }
    }
  | { kind: 'notice'; code: NoticeCode; text: string }

/** Something attached to a message: a note, a selection, a page, a picture. The panel
 *  builds these from its chips (4.2); the engine only sends them. */
export interface Attachment {
  /** What it is, as the request labels it: a note's path, `selection`, a page's address. */
  label: string
  text?: string
  image?: { mime: string; data: string }
  /** Words from outside (a web page, a shared space): sent inside nib's untrusted marks. */
  untrusted?: boolean
}

/** What the reader sends. */
export interface Draft {
  text: string
  attachments: Attachment[]
  /** The provider's own web search, for this message only (`@web`). */
  web?: boolean
}

/** The provider's own record of a turn, kept so it is sent back exactly as it came:
 *  Claude's thinking blocks and their signatures, OpenAI's encrypted reasoning. Only
 *  ever sent back to the same kind of API and the same model; any other gets the turn
 *  rebuilt from its parts.
 *
 *  @public */
export interface Replay {
  api: Api
  model: string
  /** The wire's own messages or items, after the reader's message, in order. */
  messages: unknown[]
}

/** The three shapes of API nib runs a loop over itself. */
export type Api = 'anthropic' | 'responses' | 'completions'

/** One thing said. A `you` turn is the reader's message; a `model` turn is everything
 *  that answered it, tool calls included, until the next. */
export interface Turn {
  id: string
  role: 'you' | 'model'
  at: number
  /** A `you` turn's message. */
  draft?: Draft
  /** Sent into a running turn (Ctrl+Enter) rather than after it. */
  steered?: boolean
  /** Where the reader was when a `you` turn was sent - the space, the tab in front,
   *  every open tab - as nib's own verbs said it, marks and all. Sent with the message,
   *  and kept with it, so a later request carries the same words. */
  context?: string
  /** A `model` turn's parts. */
  parts: Part[]
  /** Which provider and model answered a `model` turn, and at what effort. */
  provider?: string
  model?: string
  effort?: Effort
  usage?: Usage
  replay?: Replay
}

/** Where a goal stands (4.8), in Claude Code's and Codex's words.
 *
 *  @public */
export type GoalState = 'pursuing' | 'paused' | 'met' | 'impossible' | 'budget_limited' | 'cleared'

/** One goal per thread (lane 5 runs it).
 *
 *  @public */
export interface Goal {
  condition: string
  state: GoalState
  started: number
  turns: number
  tokens: number
  budget: { turns: number; tokens?: number; ms?: number }
  /** The evaluator's last reason. */
  reason?: string
}

/** What a program's own goal is asked (`Engine.goal`): set with its condition and, where
 *  the program keeps one, a token budget; resumed with the condition and the words its
 *  next turn is sent with; paused; cleared. */
export type GoalTo =
  | { do: 'set'; condition: string; tokens?: number }
  | { do: 'resume'; condition: string; text: string }
  | { do: 'pause' }
  | { do: 'clear' }

/** The older turns as a summary (5.1): the provider's own block where it compacts, or
 *  nib's own summary where it does not. Turns up to `upTo` are kept for the reader and
 *  no longer sent. */
export interface Compaction {
  /** The last turn the summary covers. */
  upTo: string
  /** `anthropic` and `responses` are the provider's own; `summary` is nib's turn. */
  kind: Api | 'summary'
  model: string
  /** The words of the summary, where anybody can read them. */
  summary: string
  /** The provider's own block or items, sent back exactly as they came. */
  block?: unknown
}

/** When compaction happens on its own (`/autocompact`): near the top of the window, at
 *  a count, or never. */
export type AutoCompact = 'auto' | 'off' | number

/** A conversation. Per space, on this device (4.11). */
export interface Thread {
  id: string
  space: string
  title: string
  /** The provider's id in Settings > AI. */
  provider: string
  model: string
  effort: Effort
  mode: Mode
  /** The tools the reader said Always to in Approve: asked no more in this thread. */
  always?: string[]
  turns: Turn[]
  goal?: Goal
  /** The last request's counts: what the ring draws. */
  usage: Usage
  created: number
  updated: number
  /** The provider's faster tier, where it has one. */
  fast?: boolean
  archived?: boolean
  compaction?: Compaction
  autocompact?: AutoCompact
  /** Everything this thread spent, for `/usage`. */
  spent?: { input: number; output: number; cost?: number }
}

/** What the thread list shows without reading a thread whole. */
export interface ThreadHead {
  id: string
  title: string
  provider: string
  model: string
  updated: number
  archived?: boolean
  /** The first words, for searching the list. */
  words: string
}

/** What the engine says while it answers. */
export type EngineEvent =
  /** A part of the model turn at `turn`, new or grown; `index` is its place in the turn. */
  | { type: 'part'; turn: string; index: number; part: Part }
  | { type: 'usage'; usage: Usage }
  /** Which model answered. */
  | { type: 'model'; model: string }
  /** Where a plan stands. */
  | { type: 'limit'; limit: Limit }
  /** A turn was added: the reader's message, a steered one, or the model's answer. */
  | { type: 'turn'; turn: Turn }
  | { type: 'done'; stop: Stop; error?: string }

/** How a send ended. */
export type Stop = 'end' | 'stopped' | 'max_tokens' | 'refusal' | 'steps' | 'error'

/** One engine per road: nib's own loop for the APIs, Claude Code's and Codex's sessions
 *  for the programs (lane 2). Every one writes into the thread it is handed, in place,
 *  and says so through `on`; the thread store writes it down once it is done. */
export interface Engine {
  models(provider: Provider): Promise<ModelInfo[]>
  send(
    thread: Thread,
    message: Draft,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<void>
  /** The program's own goal (4.8), on a road that has one: Claude Code's `/goal`, Codex's
   *  `thread/goal/*`. A goal set or resumed runs like a send - each turn the program takes
   *  toward it drawn through `on`, `done` once at the end - and answers where the goal
   *  stands then, as far as the program says (`null` where it does not); a pause or a
   *  clear answers at once. A road without one has no method, and the evaluator loop of
   *  lib/ai/commands runs instead. */
  goal?(
    thread: Thread,
    to: GoalTo,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<GoalState | null>
  /** Words for the running turn, delivered after the call in flight. */
  steer(thread: Thread, text: string): Promise<void>
  compact(thread: Thread, focus?: string): Promise<void>
  /** The thread's turns were cut (a rewind, an edited message): an engine that keeps a
   *  conversation of its own forgets it, so the next send starts from the thread's. */
  rewound?(thread: Thread): void
}

/** What a checkpoint holds (lane 3): every note the thread touched, as it stood before
 *  the reader's message `turn`.
 *
 *  @public */
export interface Checkpoint {
  turn: string
  notes: { path: string; rev: number; steps: number }[]
}

/** One row of the command registry (lane 5). `available` answers true, or why not.
 *
 *  @public */
export interface Command<Context = unknown> {
  name: string
  synonyms: string[]
  args?: string
  available(provider: ProviderKind): true | string
  run(context: Context): void | Promise<void>
}
