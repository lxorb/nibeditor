/** What rewinding a thread to one of the reader's messages would do (docs/ai-sidebar.md
 *  4.5): Claude Code's five choices, which of them there is anything for, the changes
 *  and the notes made since, and whether the thread did anything since that a rewind
 *  cannot take back - a page clicked, a form filled, a command run, a file moved -
 *  which the sheet says in one line, as Copilot does. Pure. */

import type { Part, Thread, Turn } from '../chat/types'
import { type Change, changesSince, checkpoints } from './changes'

/** Claude Code's five, in its order. */
export type Choice = 'both' | 'conversation' | 'notes' | 'summarize-from' | 'summarize-to'

/** A file a tool call made: where the call said, relative to its space. */
export interface Made {
  path: string
  space?: string
}

export interface Plan {
  turn: Turn
  changes: Change[]
  made: Made[]
  /** Whether something since cannot be taken back. */
  lasting: boolean
  choices: Choice[]
}

/** A tool's name as nib's verbs say it: Claude Code calls it `mcp__nib__edit_note`. */
export function verbOf(name: string): string {
  const at = name.lastIndexOf('__')
  return at < 0 ? name : name.slice(at + 2)
}

/** The verbs that only look. */
const LOOKS =
  /^(read_|list_|search_|get_|pdf_highlights$|approval_status$|agent_status$|browser_(snapshot|read|find|screenshot|console|network|tabs|wait|downloads)$)/

/** The verbs whose edits the review takes back: through the agent's own steps. */
const EDITS = new Set(['edit_note', 'write_note', 'append_note', 'set_property', 'set_task'])

/** Whether a call made something a rewind sends to Recently deleted. */
function makes(verb: string): boolean {
  return verb.startsWith('create_')
}

/** The words of a call's answer, read as the JSON a window verb answers, or null. */
function answerOf(part: Extract<Part, { kind: 'tool' }>): Record<string, unknown> | null {
  try {
    const read: unknown = JSON.parse(part.result?.text ?? '')
    return typeof read === 'object' && read !== null ? (read as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function argsOf(part: Extract<Part, { kind: 'tool' }>): Record<string, unknown> {
  return typeof part.args === 'object' && part.args !== null
    ? (part.args as Record<string, unknown>)
    : {}
}

/** What a call that made a file made. */
function madeBy(part: Extract<Part, { kind: 'tool' }>): Made | null {
  const args = argsOf(part)
  const said = answerOf(part)
  const path = typeof said?.path === 'string' ? said.path : args.path
  if (typeof path !== 'string' || !path) return null
  return typeof args.space === 'string' && args.space ? { path, space: args.space } : { path }
}

/** The calls the thread made in answer to `turn` and every message after it. */
function callsSince(turns: readonly Turn[], turn: string): Extract<Part, { kind: 'tool' }>[] {
  const at = turns.findIndex((one) => one.id === turn)
  if (at < 0) return []
  return turns
    .slice(at)
    .flatMap((one) => one.parts)
    .filter((part): part is Extract<Part, { kind: 'tool' }> => part.kind === 'tool')
    .filter((part) => part.state === 'ok')
}

/** The plan for rewinding `thread` to before its message `turn`; null for a turn that
 *  is not one of the reader's messages with a checkpoint. */
export function planFor(
  thread: Pick<Thread, 'turns'>,
  turn: string,
  changes: readonly Change[],
): Plan | null {
  const marks = checkpoints(thread.turns)
  const at = marks.findIndex((one) => one.id === turn)
  const found = marks[at]
  if (!found) return null

  const since = changesSince(changes, thread.turns, turn)
  const made: Made[] = []
  let lasting = false
  for (const part of callsSince(thread.turns, turn)) {
    const verb = verbOf(part.verb)
    if (LOOKS.test(verb) || EDITS.has(verb)) continue
    const file = makes(verb) ? madeBy(part) : null
    if (file) made.push(file)
    else lasting = true
  }

  const notes = since.length > 0 || made.length > 0
  const choices: Choice[] = [
    ...(notes ? (['both'] as const) : []),
    'conversation',
    ...(notes ? (['notes'] as const) : []),
    'summarize-from',
    ...(at > 0 ? (['summarize-to'] as const) : []),
  ]
  return { turn: found, changes: since, made, lasting, choices }
}
