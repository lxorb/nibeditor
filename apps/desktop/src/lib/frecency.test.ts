import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HALF_LIFE, trimmed, used, usesFrom, worth } from './frecency'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 30, 12)

describe('what a use is worth', () => {
  test('is one when fresh, and half of that a week later', () => {
    const once = used(undefined, NOW)
    expect(worth(once, NOW)).toBe(1)
    expect(worth(once, NOW + HALF_LIFE)).toBeCloseTo(0.5)
  })

  test('adds up, so a thing reached for daily climbs towards ten and stays', () => {
    let use = used(undefined, NOW)
    for (let day = 1; day < 60; day++) use = used(use, NOW + day * DAY)

    expect(worth(use, NOW + 59 * DAY)).toBeGreaterThan(9)
    expect(worth(use, NOW + 59 * DAY)).toBeLessThan(11)
  })

  test('counts twice this week for more than five times last month', () => {
    let month = used(undefined, NOW - 35 * DAY)
    for (let one = 1; one < 5; one++) month = used(month, NOW - (35 - one) * DAY)
    let week = used(undefined, NOW - 2 * DAY)
    week = used(week, NOW - DAY)

    expect(worth(week, NOW)).toBeGreaterThan(worth(month, NOW))
  })
})

describe('what is kept', () => {
  test('is the ones worth most, when there are too many', () => {
    const uses = new Map([
      ['old', { weight: 5, at: NOW - 90 * DAY }],
      ['fresh', { weight: 1, at: NOW }],
      ['middling', { weight: 2, at: NOW - 7 * DAY }],
    ])
    expect([...trimmed(uses, NOW, 2).keys()]).toEqual(['fresh', 'middling'])
  })

  test('is read rather than trusted', () => {
    const read = usesFrom({ a: [2, NOW], b: 'nonsense', c: [0, NOW], d: [1] })
    expect([...read.keys()]).toEqual(['a'])
    expect(usesFrom(null).size).toBe(0)
  })
})

describe('the store', () => {
  const held = new Map<string, string>()

  beforeEach(() => {
    held.clear()
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
    })
  })

  test('reads nothing until something asks, and keeps what was used meanwhile', async () => {
    const reads: string[] = []
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        reads.push(key)
        return held.get(key) ?? null
      },
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
    })
    const { frecency } = await import('./frecency')

    frecency.use('note:/a.md', NOW)
    expect(reads).toEqual([])

    expect(frecency.worth('note:/a.md', NOW)).toBe(1)
    expect(frecency.last('note:/a.md')).toBe(NOW)
    expect(reads).toContain('nib:palette-picks')
  })

  test('takes the commands the palette kept before, newest first, and forgets their list', async () => {
    held.set('nib:palette-used', JSON.stringify(['reopen', 'print']))
    const { frecency } = await import('./frecency')

    expect(frecency.latest('command:', 8)).toEqual(['command:reopen', 'command:print'])
    expect(held.has('nib:palette-used')).toBe(false)
  })

  test('writes itself down, and forgets a thing on request', async () => {
    const { frecency } = await import('./frecency')

    frecency.use('command:print', NOW)
    frecency.use('command:print', NOW)
    frecency.flush()
    const written = JSON.parse(held.get('nib:palette-picks') ?? '{}') as Record<string, unknown>
    expect(written['command:print']).toEqual([2, NOW])

    frecency.forget('command:print')
    expect(frecency.worth('command:print', NOW)).toBe(0)
  })
})
