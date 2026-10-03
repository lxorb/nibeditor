/** The open thread's copy: new where it changed, the same object where it did not. */

import { describe, expect, test } from 'vitest'
import type { Turn } from '../chat/types'
import { snapshot } from './snapshot'

function turn(id: string, text = ''): Turn {
  return { id, role: 'model', at: 0, parts: text ? [{ kind: 'text', text }] : [] }
}

describe('a snapshot', () => {
  test('copies the turn an event named and keeps every other one as it was drawn', () => {
    const turns = [turn('a', 'one'), turn('b', 'two')]
    const first = snapshot(turns, [], 'all')
    turns[1]?.parts.push({ kind: 'text', text: ' more' })
    const next = snapshot(turns, first, new Set(['b']))
    expect(next[0]).toBe(first[0])
    expect(next[1]).not.toBe(first[1])
    expect(next[1]?.parts).toHaveLength(2)
  })

  test('copies a turn it has not drawn before, and everything when asked to', () => {
    const turns = [turn('a')]
    const first = snapshot(turns, [], new Set())
    turns.push(turn('b'))
    const next = snapshot(turns, first, new Set())
    expect(next).toHaveLength(2)
    expect(snapshot(turns, next, 'all')[0]).not.toBe(next[0])
  })

  test('hands the panel a list of parts of its own, so the engine’s next push is not drawn early', () => {
    const turns = [turn('a', 'one')]
    const drawn = snapshot(turns, [], 'all')
    turns[0]?.parts.push({ kind: 'text', text: 'two' })
    expect(drawn[0]?.parts).toHaveLength(1)
  })
})
