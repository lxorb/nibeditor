/** `/goal` and `/loop` put on their road: the panel's turns, the provider's evaluator,
 *  the thread's task list and its lines. goal.ts and loop.ts are the loops; this is
 *  what they run on. */

import { t } from '../../i18n.svelte'
import type { Goal, GoalState, Thread } from '../chat/types'
import { tokens } from './account'
import { evaluatorMessages, shown, verdictIn } from './evaluate'
import { goalAsk, guidance, newGoal, pursue, type GoalRoad } from './goal'
import { type Host, waitFor } from './host'
import { loopAsk, loopPrompt, runLoop } from './loop'
import { tasks } from './tasks.svelte'

/** The word a goal's line starts with, by how it ended. */
function goalWord(state: GoalState): string {
  switch (state) {
    case 'met':
      return t('Goal met')
    case 'impossible':
      return t('Goal cannot be met')
    case 'budget_limited':
      return t('Goal budget spent')
    case 'paused':
      return t('Goal paused')
    case 'cleared':
      return t('Goal cleared')
    case 'pursuing':
      return t('Goal')
  }
}

/** A goal as `/goal` with nothing after it shows it. */
function goalStatus(goal: Goal, now: number): string {
  const minutes = Math.round((now - goal.started) / 60_000)
  return [
    `◎ ${goalWord(goal.state)} · ${goal.condition}`,
    `${minutes}m · ${goal.turns}/${goal.budget.turns} · ${tokens(goal.tokens)}`,
    goal.reason ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

function road(host: Host, thread: Thread, signal: AbortSignal): GoalRoad {
  return {
    turn: (text) => host.turn(thread, text, { signal }),
    evaluate: async (condition, since) =>
      verdictIn(await host.ask(thread, evaluatorMessages(condition, shown(thread, since)), signal)),
    changed: () => host.touched(thread),
    ended: (goal, why) => host.line(thread, `◎ ${goalWord(goal.state)}${why ? ` · ${why}` : ''}`),
    wait: waitFor,
    now: () => Date.now(),
  }
}

/** Runs the thread's goal on the task list, from `first`. */
function start(host: Host, thread: Thread, goal: Goal, first?: string): void {
  tasks.stop(thread.id, 'goal')
  const stopper = new AbortController()
  const task = tasks.add({
    thread: thread.id,
    kind: 'goal',
    label: goal.condition,
    // A goal stopped from outside (`/stop`, `/goal pause`) is paused, not lost.
    stop: () => {
      stopper.abort()
      if (goal.state === 'pursuing') {
        goal.state = 'paused'
        host.touched(thread)
      }
    },
  })
  void pursue(goal, road(host, thread, stopper.signal), stopper.signal, first).finally(() =>
    tasks.done(task.id),
  )
}

/** `/goal [condition|pause|resume|clear]`. */
export function goal(host: Host, thread: Thread, args: string): void {
  const asked = goalAsk(args)
  const held = thread.goal
  switch (asked.do) {
    case 'status':
      host.line(thread, held ? goalStatus(held, Date.now()) : '∅')
      return
    case 'pause':
      tasks.stop(thread.id, 'goal')
      return
    case 'resume':
      if (held?.state === 'paused')
        start(host, thread, held, guidance(held.condition, held.reason ?? ''))
      return
    case 'clear':
      tasks.stop(thread.id, 'goal')
      if (held) {
        held.state = 'cleared'
        host.line(thread, `◎ ${goalWord('cleared')} · ${held.condition}`)
      }
      return
    case 'set': {
      const made = newGoal(thread, asked.condition, Date.now())
      thread.goal = made
      start(host, thread, made)
    }
  }
}

/** `/loop [interval] [prompt]`. */
export function loop(host: Host, thread: Thread, args: string): void {
  const asked = loopAsk(args)
  const prompt = loopPrompt(asked, thread)
  const stopper = new AbortController()
  const task = tasks.add({
    thread: thread.id,
    kind: 'loop',
    label: prompt,
    stop: () => stopper.abort(),
  })
  void runLoop(
    asked,
    prompt,
    {
      turn: (text, signal) => host.turn(thread, text, { signal }),
      wait: waitFor,
      ended: (why) => host.line(thread, `↻ ${why || '✓'}`),
    },
    stopper.signal,
  ).finally(() => tasks.done(task.id))
}
