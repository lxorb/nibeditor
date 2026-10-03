/** A program's own goal (docs/ai-sidebar.md 4.8): what Claude Code and Codex are told to
 *  set, resume, pause or clear one. engine.ts runs the turns; this says the words. Pure.
 *
 *  The two keep different goals. Codex keeps one per thread, with a token budget and a
 *  pause of its own (`thread/goal/set`), and sets it without starting a turn, so a goal
 *  set or resumed is followed by the turn that starts the work. Claude Code keeps one per
 *  session, set or cleared and never paused, and setting it starts the turn itself
 *  (`/goal` typed as a message). So on Claude Code a pause clears the program's goal, nib
 *  keeps the condition, and a resume sets it again. */

import type { GoalTo } from '../chat/types'
import type { LocalKind } from '../providers'
import type { Say } from './session'

/** How long Codex is given, after a turn of a goal ends, to start the next one before the
 *  goal is taken to have stopped going on. Its own continuation starts at once; this is
 *  for one that never comes, so a goal never hangs a thread. */
export const QUIET = 30_000

type Pursued = Extract<GoalTo, { do: 'set' | 'resume' }>

/** What sets or resumes the goal in the program. */
export function goalSaid(kind: LocalKind, to: Pursued): Say {
  if (kind === 'codex' && to.do === 'resume') return { kind: 'goal', goal: { do: 'resume' } }
  const budget = kind === 'codex' && to.do === 'set' ? to.tokens : undefined
  return {
    kind: 'goal',
    goal: { do: 'set', objective: to.condition, ...(budget ? { budget } : {}) },
  }
}

/** The reader's message a goal's first turn is drawn under: the condition, which is what
 *  the program is set to work on - or, for a Codex goal resumed, the words its next turn
 *  is sent with. */
export function goalMessage(kind: LocalKind, to: Pursued): string {
  return kind === 'codex' && to.do === 'resume' ? to.text : to.condition
}

/** Whether the goal is said as the first turn itself, rather than before one: Claude
 *  Code's `/goal` starts its own. */
export function startsItsOwnTurn(kind: LocalKind): boolean {
  return kind === 'claude-code'
}

/** What holds a goal: a pause where the program has one, else a clear. */
export function goalHeld(kind: LocalKind): Say {
  return { kind: 'goal', goal: { do: kind === 'codex' ? 'pause' : 'clear' } }
}

/** What clears it. */
export const GOAL_CLEARED: Say = { kind: 'goal', goal: { do: 'clear' } }

/** Whether the program goes on to the next turn of a goal by itself, so its turns are
 *  read past the end of each: Codex does, and says when the goal stops; Claude Code runs
 *  the whole goal as the one message's answer. */
export function goesOn(kind: LocalKind): boolean {
  return kind === 'codex'
}
