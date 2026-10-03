// The goal loop against a fake turn and a fake evaluator: met, impossible, the budget,
// no progress, an error the reader must fix, errors tried again, and a stop.

import { describe, expect, test } from 'vitest'
import type { Goal, Part, Turn } from '../chat/types'
import { verdictIn, type Verdict } from './evaluate'
import {
  fatal,
  goalAsk,
  guidance,
  IDLE,
  newGoal,
  pursue,
  RETRIES,
  spent,
  type GoalRoad,
} from './goal'
import type { Ended } from './types'

const tool: Part = { kind: 'tool', id: 't', verb: 'edit_note', args: {}, state: 'ok' }

function turnWith(parts: Part[]): Turn {
  return { id: crypto.randomUUID(), role: 'model', at: 0, parts }
}

const worked = (): Ended => ({
  stop: 'end',
  turn: turnWith([tool, { kind: 'text', text: 'done a step' }]),
  usage: { input: 1_000, cached: 400, output: 100, reasoning: 0, window: 200_000 },
})

const talked = (): Ended => ({
  stop: 'end',
  turn: turnWith([{ kind: 'text', text: 'hm' }]),
  usage: null,
})

/** A road whose turns and verdicts are scripted, one per turn; the last repeats. */
function scripted(turns: (() => Ended)[], verdicts: (Verdict | Error)[]) {
  const sent: string[] = []
  const lines: string[] = []
  let clock = 0
  let asked = 0
  const road: GoalRoad = {
    turn: (text) => {
      sent.push(text)
      const make = turns[Math.min(sent.length - 1, turns.length - 1)] ?? worked
      return Promise.resolve(make())
    },
    evaluate: () => {
      const said = verdicts[Math.min(asked++, verdicts.length - 1)]
      return said instanceof Error
        ? Promise.reject(said)
        : Promise.resolve(said ?? { verdict: 'not_yet', reason: '' })
    },
    changed: () => undefined,
    ended: (goal, why) => lines.push(`${goal.state}:${why}`),
    wait: () => Promise.resolve(),
    now: () => (clock += 1_000),
  }
  return { road, sent, lines }
}

const goalOf = (condition = 'all notes in Inbox are filed'): Goal =>
  newGoal(
    { usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: 200_000 } },
    condition,
    0,
  )

const notYet = (reason: string): Verdict => ({ verdict: 'not_yet', reason })

describe('/goal', () => {
  test('reads what follows it, with every word for clear', () => {
    expect(goalAsk('')).toEqual({ do: 'status' })
    for (const word of ['clear', 'stop', 'off', 'reset', 'none', 'cancel', 'CANCEL'])
      expect(goalAsk(word)).toEqual({ do: 'clear' })
    expect(goalAsk('pause')).toEqual({ do: 'pause' })
    expect(goalAsk('resume')).toEqual({ do: 'resume' })
    expect(goalAsk(' Inbox is empty ')).toEqual({ do: 'set', condition: 'Inbox is empty' })
    expect(goalAsk('x'.repeat(5_000))).toMatchObject({ do: 'set', condition: 'x'.repeat(4_000) })
  })

  test('starts with the condition and stops when the evaluator says met', async () => {
    const goal = goalOf()
    const { road, sent, lines } = scripted(
      [worked],
      [notYet('two notes left'), { verdict: 'met', reason: 'all filed' }],
    )
    expect(await pursue(goal, road, new AbortController().signal)).toBe('met')
    expect(sent).toEqual([goal.condition, guidance(goal.condition, 'two notes left')])
    expect(goal).toMatchObject({ state: 'met', turns: 2, reason: 'all filed', tokens: 2 * 700 })
    expect(lines).toEqual(['met:all filed'])
  })

  test('ends at once when the evaluator says impossible', async () => {
    const goal = goalOf()
    const { road, sent, lines } = scripted(
      [worked],
      [{ verdict: 'impossible', reason: 'there is no Inbox' }],
    )
    expect(await pursue(goal, road, new AbortController().signal)).toBe('impossible')
    expect(sent).toHaveLength(1)
    expect(lines).toEqual(['impossible:there is no Inbox'])
  })

  test('stops when the budget of turns is spent', async () => {
    const goal = goalOf()
    goal.budget.turns = 4
    const { road, sent } = scripted([worked], [notYet('more')])
    expect(await pursue(goal, road, new AbortController().signal)).toBe('budget_limited')
    expect(sent).toHaveLength(4)
  })

  test('stops when the budget of tokens or of time is spent', async () => {
    const tokens = goalOf()
    tokens.budget.tokens = 1_500
    const first = scripted([worked], [notYet('more')])
    expect(await pursue(tokens, first.road, new AbortController().signal)).toBe('budget_limited')
    expect(first.sent).toHaveLength(3)

    const time = goalOf()
    time.budget.ms = 2_500
    const second = scripted([worked], [notYet('more')])
    expect(await pursue(time, second.road, new AbortController().signal)).toBe('budget_limited')
    expect(second.sent.length).toBeLessThan(4)
  })

  test('pauses after turns in a row with no tool call, keeping the goal', async () => {
    const goal = goalOf()
    const { road, sent } = scripted([worked, talked], [notYet('more')])
    expect(await pursue(goal, road, new AbortController().signal)).toBe('paused')
    expect(sent).toHaveLength(1 + IDLE)
    expect(goal.condition).toBe('all notes in Inbox are filed')
  })

  test('clears on an error the reader has to fix, and says why', async () => {
    const goal = goalOf()
    const refused = (): Ended => ({
      stop: 'error',
      error: 'That key was refused.',
      turn: null,
      usage: null,
    })
    const { road, sent, lines } = scripted([refused], [notYet('')])
    expect(await pursue(goal, road, new AbortController().signal)).toBe('cleared')
    expect(sent).toHaveLength(1)
    expect(lines).toEqual(['cleared:That key was refused.'])
  })

  test('clears when the plan is at its limit', async () => {
    const goal = goalOf()
    const limited = (): Ended => ({
      stop: 'error',
      error: 'usage',
      turn: null,
      usage: null,
      limit: { state: 'reached', until: null, untilWords: null },
    })
    const { road } = scripted([limited], [notYet('')])
    expect(await pursue(goal, road, new AbortController().signal)).toBe('cleared')
  })

  test('tries another error again three times, then pauses', async () => {
    const goal = goalOf()
    const overloaded = (): Ended => ({
      stop: 'error',
      error: 'Overloaded',
      turn: null,
      usage: null,
    })
    const { road, sent, lines } = scripted([overloaded], [notYet('')])
    expect(await pursue(goal, road, new AbortController().signal)).toBe('paused')
    expect(sent).toHaveLength(RETRIES + 1)
    expect(lines).toEqual(['paused:Overloaded'])
  })

  test('recovers when a retry works, and counts an evaluator that failed as an error', async () => {
    const goal = goalOf()
    const overloaded = (): Ended => ({
      stop: 'error',
      error: 'Overloaded',
      turn: null,
      usage: null,
    })
    const { road } = scripted(
      [overloaded, worked],
      [new Error('timeout'), { verdict: 'met', reason: 'ok' }],
    )
    expect(await pursue(goal, road, new AbortController().signal)).toBe('met')
  })

  test('pauses when the reader stops a turn', async () => {
    const goal = goalOf()
    const stopped = (): Ended => ({ stop: 'stopped', turn: null, usage: null })
    const { road } = scripted([stopped], [notYet('')])
    expect(await pursue(goal, road, new AbortController().signal)).toBe('paused')
  })

  test('ends quietly when its task is stopped', async () => {
    const goal = goalOf()
    const stopper = new AbortController()
    const { road, sent } = scripted([worked], [notYet('')])
    const turn = road.turn.bind(road)
    road.turn = (text, signal) => {
      stopper.abort()
      return turn(text, signal)
    }
    await pursue(goal, road, stopper.signal)
    expect(sent).toHaveLength(1)
  })

  test('counts only the tokens spent fresh, and knows which errors last', () => {
    expect(spent({ input: 10_000, cached: 9_000, output: 50, reasoning: 0, window: null })).toBe(
      1_050,
    )
    expect(spent(null)).toBe(0)
    expect(fatal({ error: 'Claude Code is not signed in' })).toBe(true)
    expect(fatal({ error: 'model not found' })).toBe(true)
    expect(fatal({ error: 'The provider answered 529.' })).toBe(false)
  })

  test('budgets thirty turns and the window up to where it compacts', () => {
    const goal = goalOf()
    expect(goal.budget.turns).toBe(30)
    expect(goal.budget.tokens).toBe(167_000)
    expect(
      newGoal({ usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null } }, 'x', 0)
        .budget.tokens,
    ).toBe(undefined)
  })
})

describe('the evaluator', () => {
  test('reads its verdict, with words around it or none', () => {
    expect(verdictIn('{"verdict": "met", "reason": "done"}')).toEqual({
      verdict: 'met',
      reason: 'done',
    })
    expect(verdictIn('Sure.\n```json\n{"verdict":"not_yet","reason":"3 left"}\n```')).toEqual({
      verdict: 'not_yet',
      reason: '3 left',
    })
    expect(verdictIn('{"verdict":"impossible","reason":"no"}').verdict).toBe('impossible')
    expect(verdictIn('Met.').verdict).toBe('met')
    expect(verdictIn('not yet met').verdict).toBe('not_yet')
    expect(verdictIn('???')).toEqual({ verdict: 'not_yet', reason: '' })
  })
})
