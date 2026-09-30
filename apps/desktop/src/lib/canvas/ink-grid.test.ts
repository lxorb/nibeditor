import { describe, expect, test } from 'vitest'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'
import { InkGrid } from './ink-grid'

/** A stroke from `x, y` to `x + wide, y + tall`, so its box is known without
 *  working anything out. */
function stroke(id: string, x: number, y: number, wide = 20, tall = 8, size = 3): InkStroke {
  return {
    id,
    tool: 'pen',
    color: 'ink',
    size,
    points: [
      { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
      { x: x + wide, y: y + tall, pressure: 0.5, tiltX: 0, tiltY: 0, t: 10 },
    ],
  }
}

function meets(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}

/** What a walk of every stroke would answer, which is what the grid must agree with. */
function walked(strokes: readonly InkStroke[], box: Box): string[] {
  return strokes
    .filter((one) => meets(strokeBox(one), box))
    .map((one) => one.id)
    .sort()
}

function ids(strokes: readonly InkStroke[]): string[] {
  return strokes.map((one) => one.id).sort()
}

/** A seeded run of numbers, so a failure here is the same failure next time. */
function numbers(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

describe('which strokes are near a part of the plane', () => {
  test('answers what a walk of every stroke answers, each stroke once', () => {
    const next = numbers(7)
    const strokes: InkStroke[] = []
    for (let one = 0; one < 600; one++) {
      // Short strokes and a few that cross many cells, anywhere either side of the
      // origin: a stroke filed under several cells is the one that could be answered
      // twice.
      const long = one % 37 === 0
      strokes.push(
        stroke(
          `s${one}`,
          next() * 6000 - 3000,
          next() * 6000 - 3000,
          long ? 1500 : 30,
          long ? 900 : 10,
        ),
      )
    }

    const grid = new InkGrid()
    for (const one of strokes) grid.add(one)

    for (let ask = 0; ask < 80; ask++) {
      const box = {
        x: next() * 7000 - 3500,
        y: next() * 7000 - 3500,
        width: 5 + next() * 2000,
        height: 5 + next() * 2000,
      }
      const found = grid.near(box)

      expect(ids(found)).toEqual(walked(strokes, box))
      expect(new Set(found).size).toBe(found.length)
    }
  })

  test('forgets a stroke taken away, from every cell it was under', () => {
    const kept = stroke('kept', 10, 10)
    const gone = stroke('gone', 0, 0, 2000, 40)
    const grid = new InkGrid()
    grid.add(kept)
    grid.add(gone)

    grid.remove(gone)

    expect(ids(grid.near({ x: -100, y: -100, width: 4000, height: 400 }))).toEqual(['kept'])
    expect(grid.near({ x: 1500, y: 0, width: 100, height: 100 })).toEqual([])
  })

  test('is asked about a corner of the plane without being walked whole', () => {
    // Ten thousand strokes a long way off and one in the corner being asked about:
    // the answer is the one, and it comes out of the cells under the box.
    const grid = new InkGrid()
    for (let one = 0; one < 10_000; one++) grid.add(stroke(`far${one}`, 50_000 + one * 3, 50_000))
    grid.add(stroke('here', 5, 5))

    expect(ids(grid.near({ x: 0, y: 0, width: 100, height: 100 }))).toEqual(['here'])
  })
})
