/** What the commands meet the panel at (docs/ai-sidebar.md 6.5).
 *
 *  The panel (lane 4) fetches `commands(panel)` from index.ts and hands every row it
 *  runs the panel itself. Its controls are the first half of `Panel` below; the second
 *  half is what the commands ask of it beyond them, each optional, so a panel that has
 *  not grown one yet still runs every command through the road `host.ts` builds in its
 *  place. Types only. */

import type { Limit } from '../local/heard'
import type { Provider } from '../providers'
import type { Command, Effort, Mode, Stop, Thread, Turn, Usage } from '../chat/types'

/** What one send may be told to do differently from the thread, for that send alone: a
 *  custom command's `model:`, `effort:` and `mode:`, or Agent mode for `/init`. */
export interface Once {
  mode?: Mode
  model?: string
  effort?: Effort
  /** Stops this send, and only this one: a goal, a loop or a helper being stopped. */
  signal?: AbortSignal
}

/** How a send ended, as a command needs to know it: the goal's evaluator reads the model
 *  turn, the budget its usage, the error road its words and the plan's limit. */
export interface Ended {
  stop: Stop
  error?: string
  /** The last model turn the send added, or null where it added none. */
  turn: Turn | null
  /** What the send cost, summed over its requests. */
  usage: Usage | null
  /** Where the plan stood, if the provider said during the send. */
  limit?: Limit
}

/** Words a send carries beside the message, under a label. */
export interface Attached {
  label: string
  text: string
}

/** The panel, as a command sees it. */
export interface Panel {
  // The panel's own controls (lane 4's `PanelActions`).
  send(text: string): void
  newThread(): void
  showThreads(query?: string): void
  rename(name?: string): Promise<void>
  branch(name?: string): void
  exportThread(): Promise<void>
  archive(): void
  remove(): Promise<void>
  stop(): void
  setMode(mode: Mode): void
  openModels(): void
  modelNamed(name: string): boolean
  setEffort(effort: Effort | 'next'): void
  setFast(on?: boolean): void
  compact(focus?: string): void
  openContext(): void
  toggleFolded(): void

  // What the commands ask for beyond them (6.5). Optional until the panel has them.
  /** The field's words, read and written: `/help` and `/mention` put words in it. */
  text?: string
  /** The open thread's provider, or the one a new thread would get. */
  readonly provider?: Provider | null
  /** The open thread, made first where none is open: a goal or a fork needs one. */
  ensure?(): Thread
  /** Dictation into the field (`/voice`): on, off, or the other of the two. */
  voice?(on?: boolean): void
  /** Sends words in a thread, the open one or another, exactly as the field does (queued
   *  behind a running turn, drawn while it runs), and resolves once its turn is over. */
  turn?(thread: Thread, text: string, once?: Once): Promise<Ended>
  /** The same, with words attached the way the field's chips attach them: a chat's
   *  messages for `/catchup`, `/reply` and `@nib` in a chat (docs/chats.md 4.14). */
  turnWith?(thread: Thread, text: string, attached: readonly Attached[], once?: Once): Promise<Ended>
  /** A thread a command made (a fork, a subtask): into the list, and to the front with
   *  `open`. */
  adopt?(thread: Thread, open?: boolean): void
  /** A thread a command changed outside a send (its goal, a line it added): drawn again
   *  and written down. */
  touched?(thread: Thread): void
}

/** What a command runs with: the words after its name, the open thread, the panel. */
export interface CommandContext {
  args: string
  /** The name it was typed by, where that was a synonym (`/ask` for `/approve`). */
  typed?: string
  thread: Thread | null
  panel: Panel
}

/** One row of the `/` menu. */
export interface PanelCommand extends Command<CommandContext> {
  /** A few words for the menu, translated. */
  description?: string
  /** Where it comes from: `nib` for the built-in table, else the note's path. */
  source?: string
}
