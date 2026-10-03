/** A thread as a conversation any of the three APIs can be sent: the turns since the
 *  last compaction, each either the provider's own record of it or rebuilt from what the
 *  reader saw.
 *
 *  The provider's own record is what keeps a long thread cheap and right: Claude checks
 *  that a thinking block comes back byte for byte with what came before it, and OpenAI's
 *  encrypted reasoning only means something to the model that wrote it. So a turn is sent
 *  back as it came when the thread is still on the API and model that answered it, and
 *  rebuilt from its words and tool calls when the reader switched: the thinking is the
 *  one thing that does not travel. Pure. */

import type {
  Api,
  Attachment,
  Compaction,
  Draft,
  Effort,
  Part,
  Thread,
  ToolOutput,
  Turn,
} from './types'

/** One step of a conversation in no provider's shape. */
export type Step =
  | { role: 'user'; text: string; images: { mime: string; data: string }[] }
  | { role: 'assistant'; text: string; calls: Call[] }
  | { role: 'tool'; results: { id: string; name: string; output: ToolOutput }[] }
  /** A turn's own messages, sent back exactly as they came. */
  | { role: 'native'; messages: unknown[] }
  /** The provider's own compaction, sent back exactly as it came. */
  | { role: 'compacted'; block: unknown }
  /** The effort from here on, where a provider takes it per message (Claude's beta). */
  | { role: 'effort'; effort: Effort }

/** A tool call: its id, the tool, and what it was called with. */
export interface Call {
  id: string
  name: string
  args: unknown
}

const MARK = 'untrusted'

/** Words with every mark they spell made into text, so words from outside cannot end
 *  their own mark early: the same rule as the crate's (src-tauri/src/mcp/marks.rs). */
function inert(words: string): string {
  return words.replace(new RegExp(`<(?=/?${MARK})`, 'gi'), '&lt;')
}

/** A label as an attribute: one line, no quotes or brackets of its own. */
function attribute(label: string): string {
  return label
    .slice(0, 300)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n\t]/g, ' ')
}

/** One attachment's words, labelled, and marked where they came from outside. */
function attached(one: Attachment): string {
  if (!one.text) return ''
  if (one.untrusted)
    return `<${MARK} source="${attribute(one.label)}">\n${inert(one.text)}\n</${MARK}>`
  return `<attached label="${attribute(one.label)}">\n${one.text}\n</attached>`
}

/** What the reader's message is sent as: where they were, each chip's words, then
 *  their own. */
export function userStep(draft: Draft, context = ''): Extract<Step, { role: 'user' }> {
  const texts = draft.attachments.map(attached).filter(Boolean)
  const where = context ? [`<reader-context>\n${context}\n</reader-context>`] : []
  return {
    role: 'user',
    text: [...where, ...texts, draft.text].join('\n\n'),
    images: draft.attachments.flatMap((one) => (one.image ? [one.image] : [])),
  }
}

/** A tool call that never answered: stopped, or cut off with the turn. */
const UNANSWERED: ToolOutput = {
  text: 'The call was stopped before it answered.',
  images: [],
  error: true,
}

/** A model turn rebuilt from its parts: words, then the calls made after them, then
 *  their answers, as many rounds as there were. Thinking and notices stay behind. */
export function partsAsSteps(parts: readonly Part[]): Step[] {
  const steps: Step[] = []
  let words = ''
  let calls: Extract<Part, { kind: 'tool' }>[] = []

  const flush = () => {
    if (!words && !calls.length) return
    steps.push({
      role: 'assistant',
      text: words,
      calls: calls.map((one) => ({ id: one.id, name: one.verb, args: one.args })),
    })
    if (calls.length) {
      steps.push({
        role: 'tool',
        results: calls.map((one) => ({
          id: one.id,
          name: one.verb,
          output: one.result ?? UNANSWERED,
        })),
      })
    }
    words = ''
    calls = []
  }

  for (const part of parts) {
    if (part.kind === 'text') {
      // Words after a round of calls are the next round's.
      if (calls.length) flush()
      words += part.text
    } else if (part.kind === 'tool') {
      calls.push(part)
    }
  }
  flush()
  return steps
}

/** Whether a turn's own record may be sent back to this API and model. */
function replays(turn: Turn, api: Api, model: string): boolean {
  return !!turn.replay && turn.replay.api === api && turn.replay.model === model
}

/** The turns a request carries: those after the compaction, or all of them. */
function sinceCompaction(turns: readonly Turn[], compaction: Compaction | undefined): Turn[] {
  if (!compaction) return [...turns]
  const at = turns.findIndex((one) => one.id === compaction.upTo)
  return at < 0 ? [...turns] : turns.slice(at + 1)
}

/** What a compaction is sent as to this API and model: the provider's own block where it
 *  is theirs, its words where anybody can read them, or null where neither will do and
 *  the turns it stood for are sent instead. */
function compactionStep(compaction: Compaction, api: Api, model: string): Step | null {
  if (compaction.kind === api && compaction.model === model && compaction.block !== undefined) {
    return { role: 'compacted', block: compaction.block }
  }
  if (!compaction.summary) return null
  return {
    role: 'user',
    text: `<summary of="the conversation so far">\n${compaction.summary}\n</summary>`,
    images: [],
  }
}

/** The thread as steps for one API and model. With `perMessage`, a change of effort
 *  between the reader's messages is a step of its own before the message it applies to,
 *  so the request's top-level effort, and with it the cached prefix, never changes; see
 *  `baseEffort`. */
export function stepsOf(
  thread: Pick<Thread, 'turns' | 'compaction'>,
  api: Api,
  model: string,
  perMessage = false,
): Step[] {
  const head = thread.compaction ? compactionStep(thread.compaction, api, model) : null
  const turns = head ? sinceCompaction(thread.turns, thread.compaction) : thread.turns
  const steps: Step[] = head ? [head] : []
  let effort: Effort | undefined

  for (const turn of turns) {
    if (turn.role === 'you') {
      if (perMessage && turn.effort && effort && turn.effort !== effort) {
        steps.push({ role: 'effort', effort: turn.effort })
      }
      effort = turn.effort ?? effort
      if (turn.draft) steps.push(userStep(turn.draft, turn.context))
    } else if (replays(turn, api, model) && turn.replay) {
      steps.push({ role: 'native', messages: turn.replay.messages })
    } else {
      steps.push(...partsAsSteps(turn.parts))
    }
  }
  return steps
}

/** The effort a request's top level says when per-message efforts carry the changes:
 *  the first message's since the last compaction. */
export function baseEffort(thread: Pick<Thread, 'turns' | 'compaction'>, current: Effort): Effort {
  const turns = sinceCompaction(thread.turns, thread.compaction)
  return turns.find((one) => one.role === 'you' && one.effort)?.effort ?? current
}

/** A tool's answer as one string, its pictures said rather than shown: for the APIs
 *  whose tool results are words alone. */
export function outputText(output: ToolOutput): string {
  const pictures = output.images.length ? `\n[${output.images.length} picture(s)]` : ''
  return output.text + pictures
}
