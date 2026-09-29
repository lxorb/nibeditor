import { describe, expect, test } from 'vitest'
import { dragsSelection } from './dragging'

describe('which presses hold the reveal still', () => {
  test('the main button of a mouse, which drags a selection out', () => {
    expect(dragsSelection(0, 'mouse')).toBe(true)
  })

  test('not another button', () => {
    expect(dragsSelection(2, 'mouse')).toBe(false)
  })

  test('not a finger or a pen, whose mousedown after a tap is no drag at all', () => {
    expect(dragsSelection(0, 'touch')).toBe(false)
    expect(dragsSelection(0, 'pen')).toBe(false)
  })
})
