import { describe, expect, test } from 'vitest'
import { farApart, zoneOffset } from './zone'

/** Noon, 15 January 2026, in UTC: winter on both sides of the Atlantic. */
const WINTER = Date.UTC(2026, 0, 15, 12)
/** And noon on 15 July, summer. */
const SUMMER = Date.UTC(2026, 6, 15, 12)

describe('a zone’s clock', () => {
  test('is read as minutes ahead of UTC, summer time and all', () => {
    expect(zoneOffset('Europe/Zurich', WINTER)).toBe(60)
    expect(zoneOffset('Europe/Zurich', SUMMER)).toBe(120)
    expect(zoneOffset('America/New_York', WINTER)).toBe(-300)
    expect(zoneOffset('Asia/Kolkata', WINTER)).toBe(330)
  })

  test('is nothing for a zone the engine does not know', () => {
    expect(zoneOffset('Mars/Olympus', WINTER)).toBeNull()
  })
})

describe('whether two clocks are worth telling apart', () => {
  test('is an hour or more', () => {
    expect(farApart('Europe/Zurich', 'Europe/London', WINTER)).toBe(true)
    expect(farApart('Europe/Zurich', 'Europe/Berlin', WINTER)).toBe(false)
  })

  test('is no for a zone nobody can read', () => {
    expect(farApart('Mars/Olympus', 'Europe/Zurich', WINTER)).toBe(false)
  })
})
