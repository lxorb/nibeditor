/** A chart of a view: its groups as bars, a line, a donut or one number, measured by a
 *  count, a sum, an average, the earliest or the latest (Notion's charts, docs/tasks.md
 *  5.9). What is measured is the engine's answer, so a chart says exactly what the
 *  list beside it lists.
 *
 *  The settings live under the view's `nib:` (`chart`, `measure`, `of`, `cumulative`),
 *  which Obsidian keeps without reading. Pure: the series and the shapes, as numbers;
 *  the layout draws them as SVG in the six tones. */

import { type Answer, type Base, cellValue, type Context, dayNumber, type View } from '@nib/bases'
import { dayIn } from './values'

export type ChartKind = 'bar' | 'hbar' | 'line' | 'donut' | 'number'
export const CHART_KINDS: readonly ChartKind[] = ['bar', 'hbar', 'line', 'donut', 'number']

export type Measure = 'count' | 'sum' | 'average' | 'earliest' | 'latest'
export const MEASURES: readonly Measure[] = ['count', 'sum', 'average', 'earliest', 'latest']

export interface ChartSettings {
  kind: ChartKind
  measure: Measure
  /** The property summed, averaged or dated; none for a count. */
  of?: string
  cumulative: boolean
}

export interface Point {
  key: Answer['groups'][number]['key']
  value: number
  /** A date measure's day, which is what its label says. */
  day?: string
}

/** A view's chart settings, read from what it keeps. */
export function settingsOf(view: View): ChartSettings {
  const kept = view.nib.kept
  const kind = CHART_KINDS.find((one) => one === kept.chart) ?? 'bar'
  const measure = MEASURES.find((one) => one === kept.measure) ?? 'count'
  const settings: ChartSettings = { kind, measure, cumulative: kept.cumulative === true }
  if (typeof kept.of === 'string') settings.of = kept.of
  return settings
}

/** One group measured. */
function measured(
  rows: Answer['groups'][number]['rows'],
  settings: ChartSettings,
  base: Base,
  context: Context,
): { value: number; day?: string } {
  if (settings.measure === 'count' || !settings.of) return { value: rows.length }
  const property = settings.of
  const values = rows.map((row) => cellValue(base, property, row, context))

  if (settings.measure === 'earliest' || settings.measure === 'latest') {
    const days = values
      .map((one) => dayIn(one))
      .filter((one): one is string => one !== null)
      .sort()
    const day = settings.measure === 'earliest' ? days[0] : days.at(-1)
    return day === undefined ? { value: 0 } : { value: dayNumber(day), day }
  }

  const numbers = values.filter((one): one is number => typeof one === 'number')
  const sum = numbers.reduce((total, one) => total + one, 0)
  if (settings.measure === 'sum') return { value: sum }
  return { value: numbers.length ? sum / numbers.length : 0 }
}

/** The chart's points, a group each, in the view's group order; running totals when
 *  the chart is cumulative. */
export function seriesOf(
  answer: Answer,
  settings: ChartSettings,
  base: Base,
  context: Context,
): Point[] {
  let running = 0
  return answer.groups.map((group) => {
    const one = measured(group.rows, settings, base, context)
    running += one.value
    const value = settings.cumulative && one.day === undefined ? running : one.value
    return { key: group.key, value, ...(one.day === undefined ? {} : { day: one.day }) }
  })
}

/** The one number a number chart shows: the measure over every row. */
export function totalOf(
  answer: Answer,
  settings: ChartSettings,
  base: Base,
  context: Context,
): Point {
  const rows = answer.groups.flatMap((group) => group.rows)
  const one = measured(rows, settings, base, context)
  return { key: null, value: one.value, ...(one.day === undefined ? {} : { day: one.day }) }
}

/** The heights of bars, as fractions of the tallest: dates measured from the
 *  earliest, so a bar of a later date is the longer one. */
export function heights(points: readonly Point[]): number[] {
  const dated = points.some((one) => one.day !== undefined)
  const values = points.map((one) => one.value)
  const floor = dated ? Math.min(...values) - 1 : 0
  const top = Math.max(...values.map((one) => one - floor), 0)
  return values.map((one) => (top > 0 ? (one - floor) / top : 0))
}

/** A line through the points, in a box of `width` by `height`. */
export function linePath(fractions: readonly number[], width: number, height: number): string {
  if (!fractions.length) return ''
  const step = fractions.length > 1 ? width / (fractions.length - 1) : 0
  return fractions
    .map(
      (one, at) =>
        `${at ? 'L' : 'M'}${(at * step).toFixed(1)} ${(height - one * height).toFixed(1)}`,
    )
    .join(' ')
}

/** The slices of a donut of radius `r` and hole `inner`, centred on 0,0, as paths. */
export function donutPaths(values: readonly number[], r: number, inner: number): string[] {
  const total = values.reduce((sum, one) => sum + Math.max(0, one), 0)
  if (total <= 0) return []
  let angle = -Math.PI / 2
  return values.map((one) => {
    const share = Math.max(0, one) / total
    // A slice of the whole circle is drawn as two halves: an arc cannot end where it
    // began.
    const sweep = Math.min(share, 0.9999) * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle += share * Math.PI * 2
    const large = sweep > Math.PI ? 1 : 0
    const point = (radius: number, at: number) =>
      `${(Math.cos(at) * radius).toFixed(2)} ${(Math.sin(at) * radius).toFixed(2)}`
    return [
      `M${point(r, start)}`,
      `A${r} ${r} 0 ${large} 1 ${point(r, end)}`,
      `L${point(inner, end)}`,
      `A${inner} ${inner} 0 ${large} 0 ${point(inner, start)}`,
      'Z',
    ].join(' ')
  })
}
