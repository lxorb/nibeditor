import { expect, test } from 'vitest'
import { placeNear } from './place'

const WINDOW = { width: 1000, height: 800 }
const SIZE = { width: 300, height: 200 }

test('under what was pressed, start edges lined up', () => {
  expect(placeNear({ left: 100, top: 100, right: 130, bottom: 120 }, SIZE, WINDOW)).toEqual({
    left: 100,
    top: 126,
  })
})

test('end edges lined up when asked', () => {
  expect(placeNear({ left: 500, top: 100, right: 530, bottom: 120 }, SIZE, WINDOW, true)).toEqual({
    left: 230,
    top: 126,
  })
})

test('above where there is no room below, and inside the window', () => {
  expect(placeNear({ left: 900, top: 700, right: 930, bottom: 720 }, SIZE, WINDOW)).toEqual({
    left: 692,
    top: 494,
  })
})
