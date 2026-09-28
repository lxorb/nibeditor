import { describe, expect, test } from 'vitest'
import { wheelAlong } from './wheel'

const turn = (deltaY: number, rest: Partial<Parameters<typeof wheelAlong>[0]> = {}) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  ...rest,
})

describe('the wheel over a strip too full to show every tab', () => {
  test('goes along it as far as the wheel turned, towards the end going down', () => {
    expect(wheelAlong(turn(100), 600)).toBe(100)
    expect(wheelAlong(turn(-100), 600)).toBe(-100)
  })

  test('counts a wheel that turns in lines or pages', () => {
    expect(wheelAlong(turn(3, { deltaMode: 1 }), 600)).toBe(120)
    expect(wheelAlong(turn(1, { deltaMode: 2 }), 600)).toBe(600)
  })

  /** A trackpad or a tilted wheel already scrolls the strip sideways, and Ctrl with
   *  the wheel is somebody zooming. */
  test('leaves a sideways turn and a zoom alone', () => {
    expect(wheelAlong(turn(10, { deltaX: 40 }), 600)).toBe(0)
    expect(wheelAlong(turn(100, { ctrlKey: true }), 600)).toBe(0)
  })
})
