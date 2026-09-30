/** What an agent did, as sessions (docs/agent-native.md 9.5).
 *
 *  An agent's calls with no pause longer than half an hour between them are one
 *  session, which is how a person thinks of "what it did this afternoon" and the rule
 *  every analytics product counts a visit by. A client does not say when a job starts or
 *  ends, so the gap is the only honest line to draw.
 *
 *  Pure, over the calls the activity panel reads the log into (`agents/ui/session.ts`),
 *  so a call is the same call in the panel and here, said in the same words. */

import type { Call } from '../ui/session'

/** The calls of one agent with no half hour of nothing between two of them. */
export interface Session {
  agent: string
  start: number
  end: number
  calls: Call[]
}

/** How long a pause ends a session. */
export const SESSION_GAP = 30 * 60 * 1000

/** One agent's sessions, newest first, each with its calls oldest first. */
export function sessionsOf(calls: readonly Call[], agent: string): Session[] {
  const own = calls.filter((one) => one.agent === agent).sort((a, b) => a.at - b.at)
  const sessions: Session[] = []

  for (const call of own) {
    const last = sessions.at(-1)
    if (last && call.at - last.end <= SESSION_GAP) {
      last.calls.push(call)
      last.end = call.at
    } else {
      sessions.push({ agent, start: call.at, end: call.at, calls: [call] })
    }
  }

  return sessions.reverse()
}

/** When each agent last called, by id. */
export function lastActive(calls: readonly Call[]): Map<string, number> {
  const last = new Map<string, number>()
  for (const call of calls) last.set(call.agent, Math.max(call.at, last.get(call.agent) ?? 0))
  return last
}
