import { describe, expect, test } from 'vitest'
import { compileView } from './answer'
import { readBase } from './base-file'
import { contextAt, noteRow } from './fixtures/rows'
import type { Row } from './types'

/** How often a view reads a row's file, which is what working a row out costs. */
function counting(rows: readonly Row[]): { rows: Row[]; reads: () => number } {
  let reads = 0
  const counted = rows.map(
    (row) =>
      new Proxy(row, {
        get: (target, key): unknown => {
          if (key === 'file') reads++
          return Reflect.get(target, key) as unknown
        },
      }),
  )
  return { rows: counted, reads: () => reads }
}

const rows = Array.from({ length: 20 }, (_, at) =>
  noteRow(`n${at}.md`, { due: `2026-10-${String(at + 1).padStart(2, '0')}` }),
)

describe('what a view keeps between answers', () => {
  test('a view of the day keeps its rows while only the clock moves', () => {
    const view = compileView(
      readBase(
        'views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - due <= today()\n    sort:\n      - property: file.name\n        direction: ASC\n',
      ),
    )
    const { rows: counted, reads } = counting(rows)
    view.answer(counted, contextAt({ now: '2026-10-04T10:00:00' }))
    const first = reads()
    view.answer(counted, contextAt({ now: '2026-10-04T10:01:00' }))
    expect(reads()).toBe(first)
  })

  test('a view of the clock works its rows out again when the clock moves', () => {
    const view = compileView(
      readBase(
        'views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - due <= now()\n    sort:\n      - property: file.name\n        direction: ASC\n',
      ),
    )
    const { rows: counted, reads } = counting(rows)
    view.answer(counted, contextAt({ now: '2026-10-04T10:00:00' }))
    const first = reads()
    view.answer(counted, contextAt({ now: '2026-10-04T10:01:00' }))
    expect(reads()).toBeGreaterThan(first)
  })

  test('a view that reads other files keeps nothing', () => {
    const view = compileView(
      readBase(
        'views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - file.backlinks.length == 0\n',
      ),
    )
    const { rows: counted, reads } = counting(rows)
    const context = contextAt()
    view.answer(counted, context)
    const first = reads()
    view.answer(counted, context)
    expect(reads()).toBe(first * 2)
  })
})
