/** Which strokes are near a part of the plane, answered without walking the plane.
 *
 *  The plane is cut into square cells of a fixed size in plane units, and every
 *  stroke is filed under each cell its box touches. A question about a box is then
 *  the cells under that box and the strokes filed there, however many strokes the
 *  plane holds elsewhere: a tile at the edge of the view asks about its own corner
 *  of a plane of ten thousand strokes and is told about the dozen in it.
 *
 *  Fixed in plane units rather than in pixels, so zooming changes nothing here: the
 *  same filing answers a tile of a whole page zoomed out and a tile of one word
 *  zoomed in. And kept up by what changed rather than built again, so a stroke drawn
 *  is one stroke filed. */

import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'

/** How wide a cell is, in plane units: a few lines of handwriting. Small enough that
 *  a tile zoomed right in asks one cell of a few dozen strokes, big enough that a
 *  tile zoomed right out asks a few hundred cells rather than tens of thousands. */
const CELL = 256

/** A cell's two numbers as one, so a cell is a key rather than a string built for
 *  every question. Room for a million cells either way of the origin, which is a
 *  plane a quarter of a billion units across. */
const SPAN = 2 ** 21
const HALF = 2 ** 20

function cellOf(value: number): number {
  return Math.max(-HALF, Math.min(HALF - 1, Math.floor(value / CELL)))
}

function keyOf(across: number, down: number): number {
  return (across + HALF) * SPAN + (down + HALF)
}

export class InkGrid {
  #cells = new Map<number, Set<InkStroke>>()

  /** Every cell a box touches, handed to `visit` one at a time. */
  #under(box: Box, visit: (key: number) => void) {
    const left = cellOf(box.x)
    const right = cellOf(box.x + box.width)
    const top = cellOf(box.y)
    const bottom = cellOf(box.y + box.height)

    for (let across = left; across <= right; across++) {
      for (let down = top; down <= bottom; down++) visit(keyOf(across, down))
    }
  }

  add(stroke: InkStroke) {
    this.#under(strokeBox(stroke), (key) => {
      const cell = this.#cells.get(key)
      if (cell) cell.add(stroke)
      else this.#cells.set(key, new Set([stroke]))
    })
  }

  remove(stroke: InkStroke) {
    this.#under(strokeBox(stroke), (key) => {
      const cell = this.#cells.get(key)
      if (!cell) return

      cell.delete(stroke)
      if (!cell.size) this.#cells.delete(key)
    })
  }

  /** Every stroke whose box meets `box`, each once.
   *
   *  Once, without a set to remember what was seen: a stroke filed under several of
   *  the cells asked about is answered from the first of them only, which is the
   *  cell holding the corner of where it and the box overlap. */
  near(box: Box): InkStroke[] {
    const out: InkStroke[] = []
    const left = cellOf(box.x)
    const top = cellOf(box.y)

    this.#under(box, (key) => {
      const cell = this.#cells.get(key)
      if (!cell) return

      const across = Math.floor(key / SPAN) - HALF
      const down = (key % SPAN) - HALF

      for (const stroke of cell) {
        const its = strokeBox(stroke)
        if (
          its.x >= box.x + box.width ||
          box.x >= its.x + its.width ||
          its.y >= box.y + box.height ||
          box.y >= its.y + its.height
        ) {
          continue
        }

        const firstAcross = Math.max(left, cellOf(its.x))
        const firstDown = Math.max(top, cellOf(its.y))
        if (firstAcross === across && firstDown === down) out.push(stroke)
      }
    })

    return out
  }
}
