import { describe, expect, it } from 'vitest'
import {
  accrue,
  budgetLeft,
  FREE,
  monthOf,
  near,
  NONE,
  resetAt,
  shares,
  SMALL,
  spend,
  sum,
  usedOf,
} from './usage'

const HOUR = 3600
const GB = 1e9

describe('accrue', () => {
  it('adds an awake stretch at the machine’s size', () => {
    const one = accrue(NONE, 60, SMALL, 3, 1000)
    expect(one).toEqual({ awakeS: 60, cpuS: 3, memGibS: 120, diskGbS: 480, egressBytes: 1000 })
    expect(accrue(one, 60, SMALL, 0, 0)).toEqual({
      awakeS: 120,
      cpuS: 3,
      memGibS: 240,
      diskGbS: 960,
      egressBytes: 1000,
    })
  })

  it('adds nothing for negative figures', () => {
    expect(accrue(NONE, -60, SMALL, -1, -5)).toEqual(NONE)
  })
})

describe('sum', () => {
  it('adds rows field by field, and nothing is nothing', () => {
    const a = accrue(NONE, 10, SMALL, 1, 2)
    expect(sum([a, a])).toEqual(accrue(a, 10, SMALL, 1, 2))
    expect(sum([])).toEqual(NONE)
  })
})

describe('spend', () => {
  it('is nothing for nothing', () => {
    expect(spend(NONE)).toBe(0)
  })

  it('prices an awake hour of the small machine with its CPU busy a quarter of it', () => {
    // 3.3's figures: memory $0.018, disk $0.002, CPU $0.009; the object a cent's tenth.
    const hour = accrue(NONE, HOUR, SMALL, 0.25 * 0.5 * HOUR, 0)
    expect(spend(hour)).toBeCloseTo(0.018 + 0.002 + 0.009 + 0.0058, 3)
  })

  it('keeps a whole free allowance used to its end near 3.3’s worst case', () => {
    const month = accrue(NONE, FREE.awakeS, SMALL, FREE.cpuS, FREE.egressBytes)
    const dollars = spend(month, FREE.homeBytes)
    // Hours, every CPU hour and all the egress: about a dollar and a half, never ten.
    expect(dollars).toBeGreaterThan(0.8)
    expect(dollars).toBeLessThan(2)
  })

  it('prices egress and stored homes by the gigabyte', () => {
    expect(spend({ ...NONE, egressBytes: 40 * GB })).toBeCloseTo(1)
    expect(spend(NONE, 100 * GB)).toBeCloseTo(1.5)
  })

  it('grows with every field', () => {
    const base = accrue(NONE, HOUR, SMALL, 60, GB)
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      expect(spend({ ...base, [key]: base[key] * 2 })).toBeGreaterThan(spend(base))
    }
  })
})

describe('budgetLeft', () => {
  it('is the ceiling less the month’s spend', () => {
    const month = accrue(NONE, 100 * HOUR, SMALL, 10 * HOUR, 0)
    expect(budgetLeft(30, month)).toBeCloseTo(30 - spend(month))
    expect(budgetLeft(30, NONE)).toBe(30)
  })

  it('reaches nothing for a service that has spent its ceiling', () => {
    const month = accrue(NONE, 2000 * HOUR, SMALL, 400 * HOUR, 0)
    expect(budgetLeft(30, month)).toBeLessThanOrEqual(0)
  })
})

describe('the meter', () => {
  it('reads usage as the allowance it is counted against', () => {
    const month = accrue(NONE, HOUR, SMALL, 60, 5)
    expect(usedOf(month, 7)).toEqual({ awakeS: HOUR, cpuS: 60, homeBytes: 7, egressBytes: 5 })
  })

  it('gives each bar its share, never past full', () => {
    const used = { awakeS: 10 * HOUR, cpuS: 0, homeBytes: 10 * GB, egressBytes: 5 * GB }
    expect(shares(used, FREE)).toEqual({ awakeS: 0.5, cpuS: 0, homeBytes: 1, egressBytes: 0.25 })
  })

  it('calls a bar with no allowance full', () => {
    expect(shares(usedOf(NONE, 0), usedOf(NONE, 0)).awakeS).toBe(1)
  })

  it('turns amber at 80% of the hours', () => {
    expect(near(usedOf({ ...NONE, awakeS: 16 * HOUR - 1 }, 0), FREE)).toBe(false)
    expect(near(usedOf({ ...NONE, awakeS: 16 * HOUR }, 0), FREE)).toBe(true)
  })
})

describe('the month', () => {
  it('is keyed by the UTC calendar month', () => {
    expect(monthOf(Date.UTC(2026, 9, 5, 12))).toBe('2026-10')
    expect(monthOf(Date.UTC(2026, 0, 1))).toBe('2026-01')
    expect(monthOf(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12')
  })

  it('resets at the first moment of the next month, December into January', () => {
    expect(resetAt(Date.UTC(2026, 9, 5))).toBe(Date.UTC(2026, 10, 1))
    expect(resetAt(Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1))
    expect(monthOf(resetAt(Date.UTC(2026, 9, 5)))).toBe('2026-11')
  })
})
