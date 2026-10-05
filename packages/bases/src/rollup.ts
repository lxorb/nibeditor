/** Relations seen from the other side, and rollups over them, as the formulas a base
 *  keeps (docs/tasks.md 5.12).
 *
 *  A relation is a note property holding wikilinks (`project: "[[Thesis]]"`). Its
 *  reverse is never stored: on the Thesis row it is the notes linking here whose
 *  `project` points here, read off the backlinks every time, so it cannot drift the
 *  way Notion's two stored columns can. A rollup is a calculation over the notes a
 *  relation points at: a count, or one property of each of them summed, averaged,
 *  ranged. A percentage is a share, 0 to 1, which the column's `percent` format shows
 *  as one, as Notion's does.
 *
 *  Both are written as formulas Obsidian reads too, so only its own functions are
 *  used: lists have `filter`, `map`, `reduce`, `sort`, `unique` and `length` there,
 *  and no `sum` or `mean`. The picker reads a formula back by writing every shape it
 *  could have written and finding the one that matches, so the two directions can
 *  never disagree, and a formula somebody wrote by hand stays theirs. Pure. */

/** The calculations the picker offers, Notion's, in its order. */
export const ROLLUPS = [
  'count',
  'filled',
  'unique',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'checked',
  'percent',
] as const
export type Rollup = (typeof ROLLUPS)[number]

/** A rollup as the picker holds it. `relation` is a column: a note property whose
 *  values are links (`note.tasks`), or a reverse column (`formula.Tasks`). `property`
 *  is the related notes' front matter key; absent for a count of the notes. */
export interface RollupSpec {
  relation: string
  property?: string
  calc: Rollup
}

const NAME = /^[A-Za-z_][\w]*$/

/** `object.key`, or `object["a key"]` where the key is not a name. */
function member(object: string, key: string): string {
  return NAME.test(key) ? `${object}.${key}` : `${object}[${JSON.stringify(key)}]`
}

/** A column as the expression that reads it on a row. */
function columnOf(column: string): string {
  if (column.startsWith('formula.')) return member('formula', column.slice(8))
  return member('note', column.replace(/^note\./, ''))
}

/** The calculations that need no property: they count notes. */
const OF_NOTES: readonly Rollup[] = ['count']

/** The formula a rollup is written as. */
export function rollupFormula(spec: RollupSpec): string {
  const notes = `list(${columnOf(spec.relation)})`
  if (OF_NOTES.includes(spec.calc) || spec.property === undefined) return `${notes}.length`

  const values = `${notes}.map(${member('value.asFile().properties', spec.property)})`
  const numbers = `${values}.filter(value.isType("number"))`
  const present = `${values}.filter(value != null && value != "")`
  const total = `${numbers}.reduce(acc + value, 0)`
  switch (spec.calc) {
    case 'filled':
      return `${present}.length`
    case 'unique':
      return `${present}.unique().length`
    case 'sum':
      return total
    case 'average':
      return `if(${numbers}.length, ${total} / ${numbers}.length, null)`
    case 'median':
      return `if(${numbers}.length, (${numbers}.sort()[((${numbers}.length - 1) / 2).floor()] + ${numbers}.sort()[(${numbers}.length / 2).floor()]) / 2, null)`
    case 'min':
      return `${present}.sort()[0]`
    case 'max':
      return `${present}.sort().reverse()[0]`
    case 'range':
      return `${present}.sort().reverse()[0] - ${present}.sort()[0]`
    case 'checked':
      return `${values}.filter(value == true).length`
    case 'percent':
      return `if(${values}.length, ${values}.filter(value == true).length / ${values}.length, 0)`
    case 'count':
      return `${notes}.length`
  }
}

/** The relation a formula starts from, and the property it maps the notes to. */
const SHAPE =
  /^list\((note|formula)(?:\.([A-Za-z_]\w*)|\[("(?:[^"\\]|\\.)*")\])\)(?:\.map\(value\.asFile\(\)\.properties(?:\.([A-Za-z_]\w*)|\[("(?:[^"\\]|\\.)*")\])\))?/

/** The rollup a formula is, where the picker wrote it; null for any other formula. */
export function readRollup(formula: string): RollupSpec | null {
  const found = SHAPE.exec(formula.replace(/^if\(/, '').trim())
  if (!found) return null
  const key = found[2] ?? (found[3] === undefined ? '' : String(JSON.parse(found[3])))
  const relation = `${found[1]}.${key}`
  const property = found[4] ?? (found[5] === undefined ? undefined : String(JSON.parse(found[5])))
  const trimmed = formula.trim()
  for (const calc of ROLLUPS) {
    const spec: RollupSpec =
      property === undefined ? { relation, calc } : { relation, property, calc }
    if (rollupFormula(spec) === trimmed) return spec
  }
  return null
}

/** The reverse of a relation: on each row, the notes whose `property` links to it. */
export function reverseFormula(property: string): string {
  const key = property.replace(/^note\./, '')
  return `file.backlinks.filter(list(${member('value.asFile().properties', key)}).contains(file))`
}

const REVERSE =
  /^file\.backlinks\.filter\(list\(value\.asFile\(\)\.properties(?:\.([A-Za-z_]\w*)|\[("(?:[^"\\]|\\.)*")\])\)\.contains\(file\)\)$/

/** The property a reverse column follows back, where the formula is one; else null. */
export function readReverse(formula: string): string | null {
  const found = REVERSE.exec(formula.trim())
  if (!found) return null
  return found[1] ?? (found[2] === undefined ? null : String(JSON.parse(found[2])))
}
