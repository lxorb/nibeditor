import { describe, expect, it } from 'vitest'
import { ageKey, ageOf } from './ages'

const now = new Date(2026, 9, 5, 0, 10)
const at = (...parts: [number, number, number, number?, number?]) =>
  new Date(parts[0], parts[1], parts[2], parts[3] ?? 12, parts[4] ?? 0).getTime()

describe('ageOf', () => {
  it('counts calendar days, not hours', () => {
    expect(ageOf(at(2026, 9, 5, 0, 1), now)).toEqual({ kind: 'today' })
    expect(ageOf(at(2026, 9, 4, 23, 50), now)).toEqual({ kind: 'yesterday' })
  })

  it('files the rest of the week together', () => {
    expect(ageOf(at(2026, 9, 2), now)).toEqual({ kind: 'week' })
    expect(ageOf(at(2026, 8, 29), now)).toEqual({ kind: 'week' })
  })

  it('files anything older by its month', () => {
    expect(ageOf(at(2026, 8, 28), now)).toEqual({ kind: 'month', year: 2026, month: 8 })
    expect(ageOf(at(2025, 11, 31), now)).toEqual({ kind: 'month', year: 2025, month: 11 })
  })

  it('calls a moment from the future today', () => {
    expect(ageOf(at(2026, 9, 6), now)).toEqual({ kind: 'today' })
  })

  it('tells months of two years apart', () => {
    expect(ageKey({ kind: 'month', year: 2025, month: 8 })).not.toBe(
      ageKey({ kind: 'month', year: 2026, month: 8 }),
    )
    expect(ageKey({ kind: 'today' })).toBe('today')
  })
})
