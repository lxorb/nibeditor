import { describe, expect, it } from 'vitest'

import type { Call } from '../ui/session'
import { SESSION_GAP, lastActive, sessionsOf } from './sessions'

const call = (agent: string, at: number, verb = 'read_note'): Call => ({
  seq: at,
  at,
  agent,
  verb,
  tab: null,
  url: null,
  path: null,
  status: 'ok',
})

describe('sessions', () => {
  it('are one agent’s calls with no half hour between them, newest first', () => {
    const calls = [
      call('a', 0),
      call('b', 1),
      call('a', 10 * 60_000),
      call('a', 10 * 60_000 + SESSION_GAP + 1),
      call('a', 10 * 60_000 + SESSION_GAP + 2),
    ]
    const sessions = sessionsOf(calls, 'a')
    expect(sessions.map((one) => [one.start, one.end, one.calls.length])).toEqual([
      [10 * 60_000 + SESSION_GAP + 1, 10 * 60_000 + SESSION_GAP + 2, 2],
      [0, 10 * 60_000, 2],
    ])
    expect(sessionsOf(calls, 'c')).toEqual([])
  })

  it('come out the same whatever order the days were read in', () => {
    const calls = [call('a', 100), call('a', 0), call('a', 50)]
    expect(sessionsOf(calls, 'a')[0]?.calls.map((one) => one.at)).toEqual([0, 50, 100])
  })

  it('say when each agent last called', () => {
    expect([...lastActive([call('a', 3), call('b', 9), call('a', 7)])]).toEqual([
      ['a', 7],
      ['b', 9],
    ])
  })
})
