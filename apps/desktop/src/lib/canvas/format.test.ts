import { afterEach, describe, expect, test } from 'vitest'
import { forgetParsed, parseAhead, takeParsed, writeCanvas } from './format'
import { emptyCanvas, type InkStroke } from '@nib/markdown/canvas'

/** A plane read before the surface that shows it is built, counted.
 *
 *  Opening a canvas of ten thousand strokes was one task of a hundred and four
 *  milliseconds before a single card was on screen, and three things were in it: the
 *  parse of 2.8 MB of JSON, the surface's mount, and the first gather of the ink.
 *  What is asserted here is the first of the three leaving that task - the plane is
 *  read while the tab is still being made, and the mount finds the answer waiting
 *  rather than parsing again.
 *
 *  Counted rather than timed, for the reason the counters beside paint.ts give: what
 *  the code did is a number, and it is the same number on a busy machine. The number
 *  here is how many times `JSON.parse` is called, which is what reading a plane
 *  costs and what doing it twice would double.
 *
 *  A worker was the first idea and the numbers said no: handing a parsed plane of
 *  this size back over `postMessage` is about forty milliseconds of structured clone
 *  each way, against twenty-five to thirty-one to parse it here. That is written down
 *  beside `parseAhead`; it is the kind of thing somebody will try again. */

/** A plane with `count` strokes on it, as JSON. Big enough that a second parse is
 *  worth not doing, small enough that a test does not wait for it. */
function plane(count: number): string {
  const ink: InkStroke[] = []
  for (let one = 0; one < count; one++) {
    const points = []
    for (let step = 0; step < 10; step++) {
      points.push({
        x: one * 4 + step,
        y: step * 2,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: step * 8,
      })
    }
    ink.push({ id: `s${one}`, tool: 'pen', color: 'ink', size: 3, points })
  }

  return writeCanvas({ ...emptyCanvas(), ink })
}

/** How many times `JSON.parse` is called while `run` goes.
 *
 *  On the built-in, because what is being counted is reading a plane and the reader
 *  is `@nib/markdown/canvas`, which is not this module's to instrument. Put back
 *  afterwards whatever happens. */
function parses(run: () => void): number {
  const real = JSON.parse
  let counted = 0

  JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]): unknown => {
    counted++
    return real(text, reviver) as unknown
  }) as typeof JSON.parse

  try {
    run()
  } finally {
    JSON.parse = real
  }

  return counted
}

afterEach(() => {
  forgetParsed()
})

describe('a plane read ahead of the surface that shows it', () => {
  test('is handed over rather than read again', () => {
    const text = plane(200)

    // The tab being made: one parse, in a task of its own.
    expect(parses(() => parseAhead(text))).toBe(1)

    // And the mount: none at all, because the answer is waiting.
    let taken = null
    expect(parses(() => (taken = takeParsed(text)))).toBe(0)
    expect(taken).not.toBeNull()
  })

  test('once, so two surfaces on one file do not share a plane', () => {
    const text = plane(20)
    parseAhead(text)

    expect(takeParsed(text)).not.toBeNull()
    // The second surface reads for itself. Sharing the object graph would be two
    // surfaces editing one plane, and an edit on either would show on both.
    expect(takeParsed(text)).toBeNull()
  })

  test('and only for the plane it was read for', () => {
    parseAhead(plane(20))

    expect(takeParsed(plane(21))).toBeNull()
  })

  test('and is let go of where the tab never opened', () => {
    parseAhead(plane(20))
    forgetParsed()

    // 2.8 MB of object graph is not something to leave lying about on the chance
    // that somebody asks for it later.
    expect(takeParsed(plane(20))).toBeNull()
  })

  test('so opening a plane reads it once between them, not twice', () => {
    const text = plane(200)

    // What the two halves cost together, which is the whole of the claim: the tab
    // and the surface read the plane once between them.
    const both = parses(() => {
      parseAhead(text)
      const held = takeParsed(text)
      expect(held).not.toBeNull()
    })

    expect(both).toBe(1)
  })
})
