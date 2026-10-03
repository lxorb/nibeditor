/** `/loop [interval] [prompt]`: a prompt run again and again while nib is open
 *  (docs/ai-sidebar.md 3.3), Claude Code's command.
 *
 *  It runs at once and then every interval; without an interval the model paces it, by
 *  ending each answer with when it wants to look again, or that nothing is left; without
 *  a prompt it carries on with what the thread was doing. It stops on `/stop`, on the
 *  model saying it is done, on an error the reader has to fix, and with the window: a
 *  loop is the part of a schedule that runs while nib does, never a cloud runner. */

import type { Thread } from '../chat/types'
import { fatal } from './goal'
import type { Ended } from './types'

const MINUTE = 60_000
/** The shortest interval, which is also the model's shortest. */
export const SHORTEST = MINUTE
const LONGEST = 24 * 60 * MINUTE
/** Where a self-paced loop starts, and what it falls back to when the model said nothing. */
export const PACED = 10 * MINUTE

const UNITS: Record<string, number> = { s: 1_000, m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE }

/** An interval as typed, `30s` to `1d`, in milliseconds, or null for a word that is not one. */
export function intervalIn(word: string): number | null {
  const found =
    /^(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i.exec(
      word.trim(),
    )
  if (!found) return null
  const unit = UNITS[(found[2] ?? 'm').charAt(0).toLowerCase()] ?? MINUTE
  return Math.min(LONGEST, Math.max(SHORTEST, Number(found[1]) * unit))
}

export interface LoopAsk {
  /** Null: the model paces it. */
  every: number | null
  prompt: string
}

/** What follows `/loop`: an interval first, if the first word is one, then the prompt. */
export function loopAsk(args: string): LoopAsk {
  const said = args.trim()
  const [first = '', ...rest] = said.split(/\s+/)
  const every = intervalIn(first)
  return every === null ? { every: null, prompt: said } : { every, prompt: rest.join(' ') }
}

/** The prompt when none was given. Not translated: it is the model's to read. */
export const CARRY_ON =
  'Look at what this thread has been doing and carry on with whatever is unfinished. If nothing is left to do, say so in one line.'

/** What a self-paced run is told on top of its prompt. */
export const PACING =
  'End your answer with a last line `next: <minutes>m` saying when this should run again, or `next: done` when nothing is left to do.'

/** When the model asked to run again, from its answer's last `next:` line: milliseconds,
 *  `done`, or null where it said nothing. */
export function nextIn(answer: string): number | 'done' | null {
  const lines = [...answer.matchAll(/^\s*`?next:\s*([^`\n]+)`?\s*$/gim)]
  const said = lines.at(-1)?.[1]?.trim().toLowerCase()
  if (!said) return null
  if (said === 'done' || said === 'stop') return 'done'
  return intervalIn(said)
}

/** The words of a model turn, for reading its `next:` line. */
export function answerOf(ended: Ended): string {
  return (
    ended.turn?.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('') ?? ''
  )
}

/** The prompt a loop runs: the one given, or the last message the reader sent, or the
 *  carry-on prompt. */
export function loopPrompt(asked: LoopAsk, thread: Pick<Thread, 'turns'> | null): string {
  if (asked.prompt) return asked.prompt
  const said = (thread?.turns ?? []).filter((turn) => turn.role === 'you' && turn.draft?.text)
  return said.at(-1)?.draft?.text ?? CARRY_ON
}

export interface LoopRoad {
  turn(text: string, signal: AbortSignal): Promise<Ended>
  wait(ms: number, signal: AbortSignal): Promise<void>
  /** A line in the thread when the loop ends on its own. */
  ended(why: string): void
}

/** Runs a loop until it is stopped or ends. */
export async function runLoop(
  asked: LoopAsk,
  prompt: string,
  road: LoopRoad,
  signal: AbortSignal,
): Promise<void> {
  const text = asked.every === null ? `${prompt}\n\n${PACING}` : prompt
  // Asked through a call: the signal changes while a turn is awaited.
  const stopped = () => signal.aborted
  for (;;) {
    if (stopped()) return
    const ended = await road.turn(text, signal)
    if (stopped() || ended.stop === 'stopped') return
    if (ended.stop === 'error' && fatal(ended)) {
      road.ended(ended.error ?? '')
      return
    }
    let wait = asked.every
    if (wait === null) {
      const next = nextIn(answerOf(ended))
      if (next === 'done') {
        road.ended('')
        return
      }
      wait = next ?? PACED
    }
    await road.wait(wait, signal)
  }
}
