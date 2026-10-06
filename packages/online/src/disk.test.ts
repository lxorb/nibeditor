import { describe, expect, test } from 'vitest'
import { diskFull, diskNear, diskShare } from './disk'

const GB = 1_000_000_000

describe('the disk', () => {
  test('is near at 80% and full at 90%, or with less than a gigabyte left', () => {
    expect(diskNear({ used: 79 * GB, total: 100 * GB })).toBe(false)
    expect(diskNear({ used: 80 * GB, total: 100 * GB })).toBe(true)
    expect(diskFull({ used: 89 * GB, total: 100 * GB })).toBe(false)
    expect(diskFull({ used: 90 * GB, total: 100 * GB })).toBe(true)
    // A small disk is full when a gigabyte is left, whatever its share.
    expect(diskFull({ used: 7.2 * GB, total: 8 * GB })).toBe(true)
  })

  test('a disk that says no size is never near or full', () => {
    expect(diskShare({ used: 5, total: 0 })).toBe(0)
    expect(diskNear({ used: 5, total: 0 })).toBe(false)
    expect(diskFull({ used: 5, total: 0 })).toBe(false)
  })
})
