import { describe, expect, test } from 'vitest'
import { putsAway } from './sheet-pull'

/** Where a sheet pulled down by its head goes when the finger lifts: away, or back.
 *
 *  An iPhone's sheets are put away by pulling them down from the top, and a short
 *  quick pull is as good as a long slow one. The menus a phone shows here drew the
 *  grip that says so and did nothing when it was pulled. */
describe('a sheet let go of', () => {
  test('goes back after a little pull, slowly', () => {
    expect(putsAway(30, 600, 0.1)).toBe(false)
  })

  test('goes away pulled a quarter of its height', () => {
    expect(putsAway(160, 600, 0.1)).toBe(true)
  })

  test('and never needs more than a thumb’s length, however tall it is', () => {
    expect(putsAway(130, 900, 0.1)).toBe(true)
  })

  test('goes away on a flick, however short', () => {
    expect(putsAway(24, 600, 0.9)).toBe(true)
  })

  test('but not on a twitch, however fast', () => {
    expect(putsAway(6, 600, 2)).toBe(false)
  })

  test('and never when pushed up instead', () => {
    expect(putsAway(-80, 600, -1)).toBe(false)
  })
})
