/** `/goal`: keep working until a condition holds (docs/ai-sidebar.md 4.8), the same on
 *  every provider.
 *
 *  Claude Code's words and Codex's budget. Setting a goal starts a turn with the
 *  condition as the message; after each turn the evaluator says met, not yet or
 *  impossible; not yet starts the next turn with its reason as guidance, and the other two
 *  end the goal with a line. Three turns in a row with no tool call is no progress, and
 *  pauses it with the goal kept. An error the reader has to fix (signed out, a plan at its
 *  limit, a model gone, a key refused) clears it and says why; any other is tried again,
 *  three times, and then pauses it. The budget is turns, time and tokens: thirty turns,
 *  and as many fresh tokens as the thread's window holds before it compacts.
 *
 *  The loop is written against `GoalRoad`, so the test drives it with a fake turn and a
 *  fake evaluator; index.ts hands it the panel's turn and the provider's evaluator. */

import type { Goal, GoalState, Thread, Usage } from '../chat/types'
import { compactsAt } from '../chat/usage'
import { GOAL_CLEAR } from './table'
import type { Verdict } from './evaluate'
import type { Ended } from './types'

/** Claude Code's longest condition. */
const LONGEST = 4_000
const TURNS = 30
/** Turns in a row with no tool call before the goal pauses. */
export const IDLE = 3
/** Errors in a row tried again before the goal pauses. */
export const RETRIES = 3

export type GoalAsk =
  { do: 'status' } | { do: 'pause' | 'resume' | 'clear' } | { do: 'set'; condition: string }

/** What follows `/goal`. */
export function goalAsk(args: string): GoalAsk {
  const said = args.trim()
  const word = said.toLowerCase()
  if (!said) return { do: 'status' }
  if (GOAL_CLEAR.includes(word)) return { do: 'clear' }
  if (word === 'pause' || word === 'resume') return { do: word }
  return { do: 'set', condition: said.slice(0, LONGEST) }
}

/** What the road the loop runs on can do. */
export interface GoalRoad {
  turn(text: string, signal: AbortSignal): Promise<Ended>
  evaluate(condition: string, since: number, signal: AbortSignal): Promise<Verdict>
  /** The goal changed: draw the chip again and write the thread down. */
  changed(): void
  /** A line in the thread when the goal ends or pauses. */
  ended(goal: Goal, why: string): void
  wait(ms: number, signal: AbortSignal): Promise<void>
  now(): number
}

/** A new goal, with the budget the thread's window allows. */
export function newGoal(
  thread: Pick<Thread, 'usage' | 'autocompact'>,
  condition: string,
  now: number,
): Goal {
  const tokens = compactsAt(thread.usage.window, thread.autocompact ?? 'auto')
  return {
    condition,
    state: 'pursuing',
    started: now,
    turns: 0,
    tokens: 0,
    budget: { turns: TURNS, ...(tokens ? { tokens } : {}) },
  }
}

/** The tokens a send spent fresh: what it wrote, and what it read that was not cached. */
export function spent(usage: Usage | null): number {
  return usage ? usage.output + Math.max(0, usage.input - usage.cached) : 0
}

/** Failures that will not go away by asking again. */
const FATAL =
  /\b(401|403|404)\b|sign(ed)? ?(in|out)|log ?in|not logged|unauthori[sz]ed|forbidden|invalid.{0,12}key|key was refused|not set up|add an ai provider|credit|billing|insufficient_quota|not found|does not exist|no such model|context.{0,20}(overflow|too long|exceed)/i

export function fatal(ended: Pick<Ended, 'error' | 'limit'>): boolean {
  return ended.limit?.state === 'reached' || FATAL.test(ended.error ?? '')
}

/** What the next turn is told after a verdict of not yet. Not translated: it is the
 *  model's to read. */
export function guidance(condition: string, reason: string): string {
  return reason
    ? `Keep working toward the goal: ${condition}\nNot met yet: ${reason}`
    : `Keep working toward the goal: ${condition}`
}

function finish(goal: Goal, state: GoalState, road: GoalRoad, why: string): GoalState {
  goal.state = state
  road.changed()
  road.ended(goal, why)
  return state
}

/** Runs a thread's goal until it ends, pauses or is stopped. `first` is the message the
 *  first turn is sent with: the condition itself for a new goal, the guidance for a goal
 *  resumed. */
export async function pursue(
  goal: Goal,
  road: GoalRoad,
  signal: AbortSignal,
  first = goal.condition,
): Promise<GoalState> {
  goal.state = 'pursuing'
  road.changed()
  let text = first
  let idle = 0
  let failed = 0
  // Asked through a call: the signal changes while a turn is awaited.
  const stopped = () => signal.aborted
  for (;;) {
    if (stopped()) return goal.state
    const ended = await road.turn(text, signal)
    if (stopped()) return goal.state
    goal.turns++
    goal.tokens += spent(ended.usage)

    if (ended.stop === 'stopped') return finish(goal, 'paused', road, '')
    let verdict: Verdict | null = null
    let error = ended.error ?? ''
    if (ended.stop !== 'error') {
      verdict = await road
        .evaluate(goal.condition, goal.started, signal)
        .catch((thrown: unknown) => {
          error = thrown instanceof Error ? thrown.message : String(thrown)
          return null
        })
      if (stopped()) return goal.state
    }
    if (!verdict) {
      if (fatal({ error, ...(ended.limit ? { limit: ended.limit } : {}) }))
        return finish(goal, 'cleared', road, error)
      if (++failed > RETRIES) return finish(goal, 'paused', road, error)
      road.changed()
      await road.wait(2_000 * 2 ** (failed - 1), signal)
      continue
    }
    failed = 0
    goal.reason = verdict.reason
    if (verdict.verdict === 'met') return finish(goal, 'met', road, verdict.reason)
    if (verdict.verdict === 'impossible') return finish(goal, 'impossible', road, verdict.reason)

    const { budget } = goal
    const over =
      goal.turns >= budget.turns ||
      (budget.tokens !== undefined && goal.tokens >= budget.tokens) ||
      (budget.ms !== undefined && road.now() - goal.started >= budget.ms)
    if (over) return finish(goal, 'budget_limited', road, verdict.reason)

    const called = ended.turn?.parts.some((part) => part.kind === 'tool') ?? false
    idle = called ? 0 : idle + 1
    if (idle >= IDLE) return finish(goal, 'paused', road, verdict.reason)

    road.changed()
    text = guidance(goal.condition, verdict.reason)
  }
}
