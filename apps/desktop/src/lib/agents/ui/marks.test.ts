import { describe, expect, test } from 'vitest'

import type { AgentEvent, Overview } from '../verbs'
import { ACTIVE_FOR, nextLapse, sameMarks, wornAt } from './marks'
import { heard, nothing, overviewed, type Seen, wrote } from './seen'

/** The frame and the tab mark are three states said with a colour: acting, paused,
 *  none. These walk a tab through each way in and out of them, event by event, the way
 *  the crate says them. */

const colour = (agent: string) => `colour-of-${agent}`

function after(events: AgentEvent[], at = 1000): Seen {
  const seen = nothing()
  for (const [index, event] of events.entries()) heard(seen, event, at + index)
  return seen
}

const acting: AgentEvent = { kind: 'acting', agent: 'claude', tab: 't1', verb: 'browser_click' }

describe('a reader tab an agent acts in', () => {
  test('wears the agent mark in its colour while calls keep coming', () => {
    const seen = after([acting])

    expect(wornAt(seen, 1000, colour)).toEqual({
      t1: { agent: 'claude', colour: 'colour-of-claude', paused: false },
    })
  })

  test('lets go once nothing has called on it for a while, and not before', () => {
    const seen = after([acting])

    expect(wornAt(seen, 1000 + ACTIVE_FOR - 1, colour).t1?.paused).toBe(false)
    expect(wornAt(seen, 1000 + ACTIVE_FOR, colour)).toEqual({})
    expect(nextLapse(seen, 1000)).toBe(1000 + ACTIVE_FOR)
    expect(nextLapse(seen, 1000 + ACTIVE_FOR)).toBeNull()
  })

  test('goes muted when the reader takes it, and stays so until given back', () => {
    const seen = after([acting, { kind: 'paused', agent: 'claude', tab: 't1', by: 'reader' }])

    expect(wornAt(seen, 1001, colour).t1?.paused).toBe(true)
    // Nothing gives it back by itself: an hour later it is still waiting for the press.
    expect(wornAt(seen, 1001 + 60 * 60 * 1000, colour).t1?.paused).toBe(true)

    heard(seen, { kind: 'resumed', agent: 'claude', tab: 't1' }, 2000)
    expect(wornAt(seen, 2000, colour).t1?.paused).toBe(false)
  })

  test('a takeover pauses it the same way', () => {
    const seen = after([acting, { kind: 'paused', agent: 'claude', tab: 't1', by: 'takeover' }])

    expect(wornAt(seen, 1001, colour).t1?.paused).toBe(true)
  })

  test('the stop mutes every tab that was being acted in, and only those', () => {
    const quiet: AgentEvent = { kind: 'acting', agent: 'claude', tab: 'old', verb: 'browser_read' }
    const seen = nothing()
    heard(seen, quiet, 0)
    heard(seen, acting, ACTIVE_FOR + 10)
    heard(seen, { kind: 'stopped', closed: false }, ACTIVE_FOR + 20)

    const worn = wornAt(seen, ACTIVE_FOR * 10, colour)
    expect(worn.t1?.paused).toBe(true)
    expect(worn.old).toBeUndefined()

    heard(seen, { kind: 'resumed', agent: '' }, ACTIVE_FOR * 10)
    expect(wornAt(seen, ACTIVE_FOR * 10, colour)).toEqual({})
  })

  test('stopping one agent mutes its tabs and leaves another agent acting', () => {
    const seen = after([
      acting,
      { kind: 'acting', agent: 'codex', tab: 't2', verb: 'browser_type' },
      { kind: 'paused', agent: 'claude', by: 'stop' },
    ])

    const worn = wornAt(seen, 1010, colour)
    expect(worn.t1?.paused).toBe(true)
    expect(worn.t2?.paused).toBe(false)

    heard(seen, { kind: 'resumed', agent: 'claude' }, 1020)
    expect(wornAt(seen, 1020, colour).t1?.paused).toBe(false)
  })

  test('a tab that closed wears nothing, pause and all', () => {
    const seen = after([
      acting,
      { kind: 'paused', agent: 'claude', tab: 't1', by: 'reader' },
      { kind: 'closed', agent: 'claude', id: 't1' },
    ])

    expect(wornAt(seen, 1003, colour)).toEqual({})
  })

  test('the latest agent to call on a tab is the one it wears', () => {
    const seen = after([
      acting,
      { kind: 'acting', agent: 'codex', tab: 't1', verb: 'browser_read' },
    ])

    expect(wornAt(seen, 1002, colour).t1?.agent).toBe('codex')
  })
})

describe('an agent own tabs', () => {
  test('are never in the strip: the panel draws them', () => {
    const seen = after([
      { kind: 'tab', agent: 'claude', id: 'a1', url: 'https://shop.example/', title: 'Shop' },
      { kind: 'acting', agent: 'claude', tab: 'a1', verb: 'browser_open' },
    ])

    expect(wornAt(seen, 1002, colour)).toEqual({})
    expect(seen.tabs.a1?.title).toBe('Shop')
  })

  test('go when the second stop closes them', () => {
    const seen = after([
      { kind: 'tab', agent: 'claude', id: 'a1', url: 'https://shop.example/', title: 'Shop' },
      { kind: 'stopped', closed: false },
      { kind: 'stopped', closed: true },
    ])

    expect(seen.tabs).toEqual({})
    expect(seen.stopped).not.toBeNull()
  })
})

describe('a note an agent writes in', () => {
  test('wears the mark on every tab showing it', () => {
    const seen = nothing()
    wrote(seen, 'claude', ['n1', 'n2'], 5000)

    expect(Object.keys(wornAt(seen, 5000, colour))).toEqual(['n1', 'n2'])
    expect(seen.doing.claude?.verb).toBe('edit_note')
  })
})

describe('the overview', () => {
  test('puts back the pauses and the stop a window finds on arriving', () => {
    const overview: Overview = {
      agents: [],
      tabs: [],
      approvals: [],
      stopped: false,
      paused: [['claude', 't9']],
      halted: [],
      connected: ['claude'],
    }
    const seen = nothing()
    overviewed(seen, overview, 100)

    // Nothing had been seen acting there, and the pause still wants its mark to be
    // given back with.
    expect(wornAt(seen, 100, colour).t9).toEqual({
      agent: 'claude',
      colour: 'colour-of-claude',
      paused: true,
    })
    expect(seen.connected).toEqual(['claude'])
  })

  test('keeps only the questions still waiting', () => {
    const seen = nothing()
    heard(
      seen,
      {
        kind: 'asked',
        approval: {
          id: 'q1',
          agent: 'claude',
          name: 'Claude',
          category: 'paying',
          summary: 'Pay',
          asked: 0,
          answer: 'pending',
        },
      },
      1,
    )
    expect(seen.approvals).toHaveLength(1)

    heard(
      seen,
      {
        kind: 'answered',
        approval: {
          id: 'q1',
          agent: 'claude',
          name: 'Claude',
          category: 'paying',
          summary: 'Pay',
          asked: 0,
          answer: 'expired',
        },
      },
      2,
    )
    expect(seen.approvals).toEqual([])
  })
})

test('marks are only written again when one of them changed', () => {
  const one = { t1: { agent: 'a', colour: 'c', paused: false } }

  expect(sameMarks(one, { t1: { agent: 'a', colour: 'c', paused: false } })).toBe(true)
  expect(sameMarks(one, { t1: { agent: 'a', colour: 'c', paused: true } })).toBe(false)
  expect(sameMarks(one, {})).toBe(false)
})
