/** The goal's evaluator (docs/ai-sidebar.md 4.8): after each turn, a model is asked
 *  whether the condition holds yet, from what the conversation shows, and answers
 *  met, not yet, or impossible, with a reason.
 *
 *  Claude Code's design: the evaluator runs no tools and reads no files, so it can only
 *  judge what the thread surfaced, which is what makes a goal's condition worth writing
 *  as something the agent's own output can show. The question and the reading of its
 *  answer are here; who it is asked of is the runner's. Pure. */

import type { Message } from '../providers'
import type { Part, Thread, Turn } from '../chat/types'

export interface Verdict {
  verdict: 'met' | 'not_yet' | 'impossible'
  reason: string
}

/** The most of the conversation the evaluator is shown, from its end. */
const SHOWN = 16_000

/** How much of one tool answer is shown. */
const RESULT = 400

const SYSTEM = [
  'You judge whether a goal’s condition holds, from the conversation alone.',
  'You cannot run anything, open anything or read any note: judge only what the conversation shows.',
  'Answer with JSON and nothing else: {"verdict": "met" | "not_yet" | "impossible", "reason": "<one sentence>"}.',
  '"met" only when the conversation demonstrates that the condition holds.',
  '"impossible" only when it can never hold, whatever is done next.',
  'Otherwise "not_yet", with the reason saying what is still missing, as guidance for the next step.',
  'Write the reason in the language of the condition.',
].join(' ')

function partLine(part: Part): string {
  if (part.kind === 'text') return part.text
  if (part.kind !== 'tool') return ''
  const args = JSON.stringify(part.args ?? {}).slice(0, RESULT)
  const said = part.result?.text.slice(0, RESULT) ?? ''
  return `[tool ${part.verb} ${args} -> ${part.state}${said ? `: ${said}` : ''}]`
}

function turnLines(turn: Turn): string {
  if (turn.role === 'you') return turn.draft?.text ? `Reader: ${turn.draft.text}` : ''
  const said = turn.parts.map(partLine).filter(Boolean).join('\n')
  return said ? `Assistant:\n${said}` : ''
}

/** What the evaluator is shown: the thread's turns since `since`, its last words kept
 *  where the whole is too long. */
export function shown(thread: Pick<Thread, 'turns'>, since = 0): string {
  const text = thread.turns
    .filter((turn) => turn.at >= since)
    .map(turnLines)
    .filter(Boolean)
    .join('\n\n')
  return text.length > SHOWN ? `…${text.slice(-SHOWN)}` : text
}

export function evaluatorMessages(condition: string, conversation: string): Message[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `<condition>\n${condition}\n</condition>\n\n<conversation>\n${conversation}\n</conversation>`,
    },
  ]
}

/** The evaluator's answer, read rather than trusted: the first JSON object in it, or the
 *  first word that is a verdict, or not yet. */
export function verdictIn(answer: string): Verdict {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0]
  let said: Record<string, unknown> = {}
  if (json) {
    try {
      const value: unknown = JSON.parse(json)
      if (typeof value === 'object' && value !== null) said = value as Record<string, unknown>
    } catch {
      // Words around a broken object: read the words below.
    }
  }
  const word = (typeof said.verdict === 'string' ? said.verdict : answer).toLowerCase()
  const reason = typeof said.reason === 'string' ? said.reason.trim() : ''
  if (/\bimpossible\b|\bunmet\b/.test(word)) return { verdict: 'impossible', reason }
  if (/\bnot[_ ]yet\b/.test(word)) return { verdict: 'not_yet', reason }
  if (/\bmet\b|\bachieved\b/.test(word)) return { verdict: 'met', reason }
  return { verdict: 'not_yet', reason }
}
