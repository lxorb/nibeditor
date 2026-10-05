import { describe, expect, test } from 'vitest'
import { cellValue } from './answer'
import { readBase } from './base-file'
import { contextAt, noteRow } from './fixtures/rows'
import { readReverse, readRollup, reverseFormula, rollupFormula, ROLLUPS } from './rollup'
import type { Context, Row } from './types'

/** A context that finds notes by name and path and knows who links where, the way the
 *  app's (views/context.ts) does. */
function lookups(rows: readonly Row[]): Context {
  const name = (target: string) =>
    (target.split('/').pop() ?? target).replace(/\.md$/i, '').toLowerCase()
  return contextAt({
    resolve: (target) =>
      rows.find((row) => name(row.path) === name(target.split('#')[0] ?? target))?.path ?? null,
    row: (path) => rows.find((row) => row.path === path),
    backlinks: (row) =>
      rows
        .filter((one) => one.file.links.some((link) => name(link) === name(row.path)))
        .map((one) => one.path),
  })
}

const thesis = noteRow(
  'Projects/Thesis.md',
  'status: Doing\ntasks: ["[[Intro]]", "[[Data]]", "[[Talk]]"]',
  {
    links: ['Intro', 'Data', 'Talk'],
  },
)
const garden = noteRow('Projects/Garden.md', 'status: To do', {})
const intro = noteRow(
  'Tasks/Intro.md',
  'project: "[[Thesis]]"\nhours: 3\ndone: true\ndue: 2026-10-01',
  {
    links: ['Thesis'],
  },
)
const data = noteRow(
  'Tasks/Data.md',
  'project: "[[Thesis]]"\nhours: 5\ndone: false\ndue: 2026-10-09',
  {
    links: ['Thesis'],
  },
)
const talk = noteRow(
  'Tasks/Talk.md',
  'project: ["[[Thesis]]", "[[Garden]]"]\nhours: 4\ndone: true',
  {
    links: ['Thesis', 'Garden'],
  },
)
const stray = noteRow('Tasks/Stray.md', 'see: "[[Thesis]]"\nhours: 100', { links: ['Thesis'] })
const all = [thesis, garden, intro, data, talk, stray]
const context = lookups(all)

const base = readBase(`formulas:
  Tasks: '${reverseFormula('project')}'
`)

const value = (formula: string, row: Row) =>
  cellValue({ ...base, formulas: { ...base.formulas, it: formula } }, 'formula.it', row, context)

describe('a relation seen from the other side', () => {
  test('is the notes whose property links here, and nothing else that links here', () => {
    const reverse = cellValue(base, 'formula.Tasks', thesis, context)
    expect(
      Array.isArray(reverse) && reverse.map((one) => (one as { target: string }).target),
    ).toEqual(['Tasks/Intro.md', 'Tasks/Data.md', 'Tasks/Talk.md'])
    const other = cellValue(base, 'formula.Tasks', garden, context)
    expect(Array.isArray(other) && other.length).toBe(1)
  })

  test('reads back the property it follows', () => {
    expect(readReverse(reverseFormula('project'))).toBe('project')
    expect(readReverse(reverseFormula('due date'))).toBe('due date')
    expect(readReverse('file.backlinks.length')).toBeNull()
  })
})

describe('rollups', () => {
  const reverse = { relation: 'formula.Tasks' }
  test('count the related notes, forward and back', () => {
    expect(value(rollupFormula({ relation: 'note.tasks', calc: 'count' }), thesis)).toBe(3)
    expect(value(rollupFormula({ ...reverse, calc: 'count' }), thesis)).toBe(3)
    expect(value(rollupFormula({ ...reverse, calc: 'count' }), garden)).toBe(1)
  })

  test('calculate over a property of the related notes', () => {
    const of = (calc: (typeof ROLLUPS)[number], property = 'hours') =>
      value(rollupFormula({ ...reverse, property, calc }), thesis)
    expect(of('sum')).toBe(12)
    expect(of('average')).toBe(4)
    expect(of('median')).toBe(4)
    expect(of('min')).toBe(3)
    expect(of('max')).toBe(5)
    expect(of('range')).toBe(2)
    expect(of('filled', 'due')).toBe(2)
    expect(of('unique', 'done')).toBe(2)
    expect(of('checked', 'done')).toBe(2)
    expect(of('percent', 'done')).toBe(67)
  })

  test('an even number of values has the middle two halved as its median', () => {
    const two = noteRow('Projects/Two.md', 'tasks: ["[[Intro]]", "[[Data]]"]', {
      links: ['Intro', 'Data'],
    })
    expect(
      value(rollupFormula({ relation: 'note.tasks', property: 'hours', calc: 'median' }), two),
    ).toBe(4)
  })

  test('nothing related is nothing to average, and zero to count', () => {
    const none = noteRow('Projects/None.md', 'status: To do')
    expect(value(rollupFormula({ relation: 'note.tasks', calc: 'count' }), none)).toBe(0)
    expect(
      value(rollupFormula({ relation: 'note.tasks', property: 'hours', calc: 'average' }), none),
    ).toBeNull()
    expect(
      value(rollupFormula({ relation: 'note.tasks', property: 'done', calc: 'percent' }), none),
    ).toBe(0)
  })

  test('the picker reads back every formula it writes, and no other', () => {
    for (const calc of ROLLUPS) {
      for (const spec of [
        { relation: 'note.tasks', property: 'hours', calc },
        { relation: 'formula.Tasks', property: 'a key', calc },
      ]) {
        const read = readRollup(rollupFormula(spec))
        expect(read).toEqual(calc === 'count' ? { relation: spec.relation, calc } : spec)
      }
    }
    expect(readRollup('list(note.tasks).length + 1')).toBeNull()
    expect(readRollup('pages > 400')).toBeNull()
  })

  test('uses only functions Obsidian has', () => {
    const own = /\.(sum|mean|average|median|stddev|min|max)\(/
    for (const calc of ROLLUPS) {
      expect(rollupFormula({ relation: 'note.tasks', property: 'hours', calc })).not.toMatch(own)
    }
  })
})
