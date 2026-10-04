import { describe, expect, test } from 'vitest'

import { readEvent } from './read'
import { callsOf, readCall, sessionMarkdown, today } from './session'
import { wordFor } from './words'

describe('the crate news, read', () => {
  test('takes every kind 13.1 names', () => {
    expect(readEvent({ kind: 'acting', agent: 'a', tab: 't', verb: 'browser_click' })).toEqual({
      kind: 'acting',
      agent: 'a',
      tab: 't',
      verb: 'browser_click',
    })
    expect(readEvent({ kind: 'paused', agent: 'a', by: 'stop' })).toEqual({
      kind: 'paused',
      agent: 'a',
      by: 'stop',
    })
    expect(readEvent({ kind: 'resumed', agent: '' })).toEqual({ kind: 'resumed', agent: '' })
    expect(readEvent({ kind: 'stopped', closed: true })).toEqual({ kind: 'stopped', closed: true })
    expect(readEvent({ kind: 'connected', agents: ['a', 'b'] })).toEqual({
      kind: 'connected',
      agents: ['a', 'b'],
    })
    expect(readEvent({ kind: 'closed', agent: 'a', id: 'a1' })).toEqual({
      kind: 'closed',
      agent: 'a',
      id: 'a1',
    })
  })

  test('drops what it does not know rather than half applying it', () => {
    expect(readEvent(null)).toBeNull()
    expect(readEvent({ kind: 'acting', agent: 'a' })).toBeNull()
    expect(readEvent({ kind: 'paused', agent: 'a', by: 'somebody' })).toBeNull()
    expect(readEvent({ kind: 'connected', agents: ['a', 3] })).toBeNull()
    expect(readEvent({ kind: 'asked', approval: { id: 'q1' } })).toBeNull()
    expect(readEvent({ kind: 'something new' })).toBeNull()
  })
})

describe('the session', () => {
  const lines = [
    {
      at: 1,
      agent: 'a',
      verb: 'browser_open',
      tab: 'a1',
      args: { url: 'https://shop.example/x' },
      status: 'ok',
      ms: 90,
    },
    { at: 2, agent: 'a', verb: 'agent_status', args: {}, status: 'ok', ms: 1 },
    { at: 3, agent: 'b', verb: 'read_note', args: { path: 'Plan.md' }, status: 'ok', ms: 3 },
    { at: 4, agent: 'a', verb: 'edit_note', args: { path: 'Ideas/Plan.md' }, status: 'ok', ms: 4 },
    {
      at: 5,
      agent: 'a',
      verb: 'browser_click',
      tab: 'a1',
      args: { ref: 'e4' },
      status: 'error',
      ms: 20,
    },
    'not a line',
  ]

  test('is one agent calls, newest first, without the bookkeeping', () => {
    const calls = callsOf(lines, 'a')

    expect(calls.map((one) => one.verb)).toEqual(['browser_click', 'edit_note', 'browser_open'])
    expect(calls[2]?.url).toBe('https://shop.example/x')
    expect(calls[0]?.status).toBe('error')
  })

  test('only keeps an address that is a web page', () => {
    expect(
      readCall({
        at: 1,
        agent: 'a',
        verb: 'browser_open',
        args: { url: 'file:///c:/x' },
        status: 'ok',
      })?.url,
    ).toBeNull()
  })

  test('is written into a note as a list with a link to each page and note', () => {
    const text = sessionMarkdown('Claude Code', callsOf(lines, 'a'))

    expect(text.startsWith('## Claude Code, ')).toBe(true)
    expect(text).toContain('[shop.example](https://shop.example/x)')
    expect(text).toContain('[[Ideas/Plan]]')
    expect(
      text
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('- ')),
    ).toHaveLength(3)
    expect(text).toContain(' ✗')
  })

  test('is filed under the day in UTC, which is what the crate names its files by', () => {
    expect(today(Date.UTC(2026, 8, 30, 23, 30))).toBe('2026-09-30')
  })

  test('has a word for every verb somebody would want to read about', () => {
    expect(wordFor('browser_click')).toBe('Pressing')
    expect(wordFor('edit_note')).toBe('Writing')
    expect(wordFor('agent_pair')).toBeNull()
  })
})
