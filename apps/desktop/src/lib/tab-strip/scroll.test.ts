import { describe, expect, test } from 'vitest'
import { revealed } from './scroll'

describe('the open tab brought into view', () => {
  test('leaves a strip alone that already shows it', () => {
    expect(revealed(100, 500, 2000, 200, 400)).toBe(100)
  })

  test('goes only as far as it has to, from either side', () => {
    expect(revealed(100, 500, 2000, 800, 1000)).toBe(500)
    expect(revealed(900, 500, 2000, 200, 400)).toBe(200)
  })

  test('never past either end of the strip', () => {
    expect(revealed(0, 500, 2000, 1900, 2100)).toBe(1500)
    expect(revealed(400, 500, 2000, -20, 100)).toBe(0)
  })

  test('takes a strip whose tabs all fit back to its start', () => {
    expect(revealed(300, 500, 500, 100, 200)).toBe(0)
    expect(revealed(300, 500, 400, 100, 200)).toBe(0)
  })
})
