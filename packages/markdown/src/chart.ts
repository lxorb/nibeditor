/** A ` ```chart ` fence: a few numbers, drawn.
 *
 *  The shape is the one the Obsidian Charts plugin reads, so a note that carries
 *  a chart opens in either app with the same numbers in it. Its own vocabulary is
 *  Chart.js's, which is a hundred options wide; what a note needs is what a
 *  reader can take in at a glance, so this reads five keys and draws seven kinds.
 *
 *  `type`, `title`, `labels`, `series` with a `title` and `data` each.
 *
 *  The seven are bar, line, scatter, pie, donut, radar and polar area - which is
 *  every kind the plugin draws that a column of prose has room for. Three of them
 *  were left out for a while, on the grounds that a note is prose and a radar is an
 *  instrument. The grounds were fine and the behaviour was not: a `type: radar`
 *  came out as a bar chart, silently, which is a picture of the right numbers
 *  saying the wrong thing about them. A reader cannot see that happen. So they are
 *  drawn, and a `type` nib has never heard of draws nothing at all - the fence
 *  stays the characters it is made of, the way a diagram that will not draw does,
 *  which is a refusal somebody can see and correct.
 *
 *  `stacked`, `tension`, `fill`, `beginAtZero`, `width`, `height` and the rest of
 *  Chart.js's surface. A bar chart always begins at zero, because one that does
 *  not is a picture that lies about a ratio; a chart is always the width of the
 *  column, because a note has one column; and a curve drawn through points is a
 *  claim about what happened between them that the numbers do not make.
 *
 *  Drawn as an SVG built from strings, with no library at all. Three reasons, in
 *  order: the Worker that publishes a note has no DOM to draw in, so anything
 *  needing one could not be published; a chart on paper and a chart on screen have
 *  to be the same picture; and Chart.js is two hundred kilobytes for a bar chart.
 *
 *  Colours come from the tokens the app and a published page both define, with a
 *  hex fallback for the one place neither does - a picture pulled out of a
 *  document and looked at on its own. */

import { escape } from './html'
import { flowItems, unquoted } from './yaml'

export type ChartKind = 'bar' | 'line' | 'scatter' | 'pie' | 'donut' | 'radar' | 'polar'

export interface Series {
  title: string
  data: number[]
}

export interface Chart {
  kind: ChartKind
  title: string | null
  labels: string[]
  series: Series[]
}

/** The kinds, and the names the plugin uses for each. `doughnut` is Chart.js's
 *  own spelling and `donut` is what people type; `polarArea` is Chart.js's name for
 *  the one everybody else calls a polar chart. */
const KINDS: Readonly<Record<string, ChartKind>> = {
  bar: 'bar',
  line: 'line',
  scatter: 'scatter',
  pie: 'pie',
  donut: 'donut',
  doughnut: 'donut',
  radar: 'radar',
  polar: 'polar',
  polararea: 'polar',
}

/** Well past any chart worth reading in a note, and a ceiling so a fence cannot
 *  ask for a picture of ten thousand bars. */
const MOST_POINTS = 200
const MOST_SERIES = 12

/** The colours a series is drawn in, in this order, so two beside each other are
 *  never two shades of the same thing. The accent first: a chart in a note is part
 *  of the note. */
const INK: readonly (readonly [string, string])[] = [
  ['--accent', '#5b4be0'],
  ['--canvas-4', '#08b94e'],
  ['--canvas-2', '#ec7500'],
  ['--canvas-6', '#7852ee'],
  ['--canvas-5', '#00b3b0'],
  ['--canvas-1', '#e93147'],
  ['--canvas-3', '#d9a600'],
]

function colour(at: number): string {
  const [token, hex] = INK[at % INK.length] ?? ['--accent', '#5b4be0']
  return `var(${token}, ${hex})`
}

/** A number as YAML would read one, or null for anything that is not one. Its
 *  only caller draws a zero for the null; see `numbers` below. */
function numberOf(written: string): number | null {
  const value = Number(unquoted(written))
  return Number.isFinite(value) ? value : null
}

/** One line split at its first colon, when it is a mapping at all. */
function pair(line: string): { indent: number; key: string; value: string } | null {
  const indent = line.length - line.trimStart().length
  const rest = line.trim().replace(/^-\s*/, '')
  const at = rest.indexOf(':')
  if (at <= 0) return null

  return { indent, key: rest.slice(0, at).trim().toLowerCase(), value: rest.slice(at + 1) }
}

/** The chart a fence's body describes, or null when it describes none.
 *
 *  Tolerant, the way every reader in this package is: a key nobody here knows is
 *  skipped rather than refused, so a chart written for the plugin's fuller
 *  vocabulary still draws the part of itself that is numbers. What it will not do
 *  is invent - a fence with no numbers in it is not a chart, and stays code. */
export function readChart(source: string): Chart | null {
  const lines = source.split('\n')
  let kind: ChartKind | null = 'bar'
  let title: string | null = null
  let labels: string[] = []
  const series: Series[] = []
  let inSeries = false

  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const found = pair(line)
    const listed = line.trimStart().startsWith('-')

    // A line with no colon on it says nothing this reads. `series:` on its own
    // is not one of those - it is a key with an empty value, and it is the
    // branch below that opens the list under it.
    if (found === null) continue

    if (found.indent === 0 && !listed) {
      if (found.key === 'series') {
        // `series: [1, 2, 3]` is one series with no name, which is what somebody
        // writes when there is only one thing to draw.
        const inline = flowItems(found.value)
        inSeries = inline === null
        if (inline) series.push({ title: '', data: numbers(found.value) })
        continue
      }

      inSeries = false
      // A kind nothing knows is null rather than the one it happened to start as:
      // a fence asking for a picture this cannot draw keeps its own characters, so
      // the reader can see what they asked for and change it. Silently drawing a bar
      // chart instead was the right numbers saying the wrong thing.
      if (found.key === 'type') kind = KINDS[unquoted(found.value).toLowerCase()] ?? null
      else if (found.key === 'title') title = unquoted(found.value) || null
      else if (found.key === 'labels') labels = flowItems(found.value) ?? [unquoted(found.value)]
      continue
    }

    if (!inSeries) continue

    // A new dash starts a new series, whichever of its keys came first.
    if (listed && series.length < MOST_SERIES) series.push({ title: '', data: [] })
    const current = series.at(-1)
    if (!current) continue

    if (found.key === 'title' || found.key === 'label') current.title = unquoted(found.value)
    else if (found.key === 'data') current.data = numbers(found.value)
  }

  const drawn = series.filter((one) => one.data.length > 0)
  if (drawn.length === 0 || kind === null) return null

  return { kind, title, labels, series: drawn.slice(0, MOST_SERIES) }
}

/** The numbers a `data:` value holds. A value that is not a number is a zero:
 *  a bar chart with a hole in it says less than one with a bar of nothing. */
function numbers(value: string): number[] {
  const listed = flowItems(value)
  if (listed === null) {
    const one = numberOf(value)
    return one === null ? [] : [one]
  }

  return listed.slice(0, MOST_POINTS).map((written) => numberOf(written) ?? 0)
}

/** The box every chart is drawn in. A viewBox and no width, so the figure around
 *  it decides how wide it is and the drawing scales with the column. */
const WIDTH = 640
const HEIGHT = 340
const PAD = { top: 24, right: 16, bottom: 40, left: 48 }

/** How many lines across a bar or line chart, counting the baseline. */
const GRID = 4

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/** Where a chart's numbers are written in English, because nobody has said
 *  otherwise: a chart pulled out of a document and looked at on its own has no
 *  language to take. */
const ENGLISH = 'en-US'

/** What language a chart's numbers are written in for a caller that does not
 *  say.
 *
 *  The same arrangement `setHardBreaks` has, for the same reason: a chart is
 *  drawn on five surfaces in the app - live preview, the reading view, a card on
 *  a canvas, a slide and an exported document - and 1234.5 cannot be grouped one
 *  way in one of them and another way in the next. The app says it once, from the
 *  language it is set to rather than the machine's.
 *
 *  The Worker that publishes a note says it per render instead, through the
 *  option below: one isolate serves many sites, and a global would leak between
 *  them. */
let tongue = ENGLISH

export function setChartLocale(tag: string): void {
  tongue = tag || ENGLISH
}

/** What a caller may say about one chart. The locale is the language its numbers
 *  are grouped and spelled in - `1,234.5` in English, `1.234,5` in German.
 *  Written as it is so a caller can hand over what it has without asking whether
 *  it has anything; saying nothing and saying `undefined` mean the same here. */
export interface ChartOptions {
  locale?: string | undefined
}

/** A number as a reader writes one: no trailing zeroes, and thousands grouped
 *  the way the reader's own language groups them.
 *
 *  Built once per chart rather than per number, because a chart of two hundred
 *  bars asks for two hundred of these and building the formatter is most of what
 *  that would cost. */
function sayer(options?: ChartOptions): (value: number) => string {
  const format = new Intl.NumberFormat(options?.locale ?? tongue)
  return (value) => format.format(Math.round(value * 100) / 100)
}

/** One chart's formatter, handed down to whatever draws the numbers in it. */
type Said = (value: number) => string

/** The scale a chart is drawn against: how far it reaches each way, and how far
 *  apart the lines across it are.
 *
 *  Rounded outwards to a step somebody would have chosen. Three, five and two
 *  divided into four equal parts reads `5 / 3.33 / 1.67 / 0`, and a reader who has
 *  to work out what 3.33 is doing there has stopped looking at the picture. So the
 *  step is one of 1, 2, 2.5 or 5 times a power of ten, whichever first covers a
 *  quarter of the range, and the ends are rounded out to land on it.
 *
 *  Always through zero: a bar chart that begins somewhere else is a picture that
 *  lies about a ratio. */
function span(chart: Chart): { low: number; high: number; step: number } {
  const every = chart.series.flatMap((one) => one.data)
  const top = Math.max(0, ...every)
  const bottom = Math.min(0, ...every)
  // A chart of nothing but zeroes still needs a scale to draw against.
  const reach = top === bottom ? 1 : top - bottom

  // A step a little under the rough one is allowed, which buys a line or two more
  // in exchange for a round number: seven over four is 1.75, and 2 reads better
  // than 1.75 does even though it draws one line fewer than asked for.
  const rough = reach / (GRID - 1)
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((one) => one * power).find((one) => one >= rough / 1.5) ?? 1

  return { low: Math.floor(bottom / step) * step, high: Math.ceil(top / step) * step, step }
}

function text(words: string, x: number, y: number, className: string, anchor = 'middle'): string {
  return `<text class="${className}" x="${round(x)}" y="${round(y)}" text-anchor="${anchor}">${escape(words)}</text>`
}

/** The axes: the value lines across, and the labels along the bottom. */
function frame(chart: Chart, low: number, high: number, step: number, said: Said): string {
  const out: string[] = []
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: WIDTH - PAD.left - PAD.right,
    h: HEIGHT - PAD.top - PAD.bottom,
  }

  // One line per step of the scale rather than a fixed number of them, so every
  // label is a number the step reaches exactly.
  for (let value = low; value <= high + step / 2; value += step) {
    const y = plot.y + plot.h * ((high - value) / (high - low))
    out.push(
      `<line class="chart-grid" x1="${plot.x}" y1="${round(y)}" x2="${plot.x + plot.w}" y2="${round(y)}"/>`,
    )
    out.push(text(said(value), plot.x - 8, y + 4, 'chart-tick', 'end'))
  }

  const across = plot.w / Math.max(1, longest(chart))
  for (const [at, label] of chart.labels.slice(0, longest(chart)).entries()) {
    out.push(text(label, plot.x + across * (at + 0.5), HEIGHT - PAD.bottom + 20, 'chart-label'))
  }

  return out.join('')
}

/** How many points the chart has, which is the longest series in it. */
function longest(chart: Chart): number {
  return Math.max(1, ...chart.series.map((one) => one.data.length))
}

function bars(chart: Chart, low: number, high: number, said: Said): string {
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: WIDTH - PAD.left - PAD.right,
    h: HEIGHT - PAD.top - PAD.bottom,
  }
  const points = longest(chart)
  const step = plot.w / points
  const room = step * 0.72
  const each = room / chart.series.length
  const zero = plot.y + plot.h * (high / (high - low))
  const out: string[] = []

  for (const [which, series] of chart.series.entries()) {
    for (const [at, value] of series.data.entries()) {
      const top = plot.y + plot.h * ((high - Math.max(value, 0)) / (high - low))
      const bottom = plot.y + plot.h * ((high - Math.min(value, 0)) / (high - low))
      const x = plot.x + step * at + (step - room) / 2 + each * which
      const height = Math.max(1, bottom - top)
      out.push(
        `<rect class="chart-bar" x="${round(x)}" y="${round(top)}" width="${round(Math.max(1, each - 2))}" height="${round(height)}" fill="${colour(which)}"><title>${escape(`${series.title ? `${series.title}: ` : ''}${said(value)}`)}</title></rect>`,
      )
    }
  }

  out.push(
    `<line class="chart-axis" x1="${plot.x}" y1="${round(zero)}" x2="${plot.x + plot.w}" y2="${round(zero)}"/>`,
  )
  return out.join('')
}

/** A line chart, and a scatter plot, which is the same picture without the line
 *  through the points: the numbers and where they fall, and no claim about what
 *  happened between them. One function because they are one drawing - a second copy
 *  of the arithmetic would be a second place for the scale to drift. */
function lines(chart: Chart, low: number, high: number, said: Said, joined = true): string {
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: WIDTH - PAD.left - PAD.right,
    h: HEIGHT - PAD.top - PAD.bottom,
  }
  const points = longest(chart)
  const step = plot.w / points
  const out: string[] = []

  for (const [which, series] of chart.series.entries()) {
    const drawn = series.data.map((value, at) => {
      const x = plot.x + step * (at + 0.5)
      const y = plot.y + plot.h * ((high - value) / (high - low))
      return `${round(x)},${round(y)}`
    })
    if (drawn.length === 0) continue

    if (joined) {
      out.push(
        `<polyline class="chart-line" points="${drawn.join(' ')}" fill="none" stroke="${colour(which)}"/>`,
      )
    }
    for (const [at, value] of series.data.entries()) {
      const x = plot.x + step * (at + 0.5)
      const y = plot.y + plot.h * ((high - value) / (high - low))
      out.push(
        `<circle class="chart-dot" cx="${round(x)}" cy="${round(y)}" r="3" fill="${colour(which)}"><title>${escape(`${series.title ? `${series.title}: ` : ''}${said(value)}`)}</title></circle>`,
      )
    }
  }

  return out.join('')
}

/** A pie, or the same with the middle taken out. One series only: a pie of two
 *  series is two pies, and nobody reads that. */
function pie(chart: Chart, hole: number, said: Said): string {
  const series = chart.series[0]
  if (!series) return ''

  const values = series.data.map((one) => Math.max(0, one))
  const total = values.reduce((sum, one) => sum + one, 0)
  if (total <= 0) return ''

  const middle = { x: WIDTH / 2, y: (HEIGHT - PAD.bottom + PAD.top) / 2 }
  const radius = Math.min(WIDTH, HEIGHT - PAD.bottom) / 2 - PAD.top
  const out: string[] = []
  let turned = -Math.PI / 2

  for (const [at, value] of values.entries()) {
    const sweep = (value / total) * Math.PI * 2
    if (sweep <= 0) continue

    const name = chart.labels[at] ?? ''
    // A slice that is the whole pie has no arc: its two ends are the same point,
    // and an arc between them is drawn as nothing at all.
    const path =
      sweep >= Math.PI * 2 - 1e-9
        ? ring(middle, radius, hole)
        : slice(middle, radius, hole, turned, turned + sweep)

    out.push(
      `<path class="chart-slice" d="${path}" fill="${colour(at)}"><title>${escape(`${name ? `${name}: ` : ''}${said(value)}`)}</title></path>`,
    )
    turned += sweep
  }

  return out.join('')
}

/** The middle of a round chart, and how far its rim reaches. Said once, because a
 *  pie, a radar and a polar area are all drawn into the same circle. */
function round_middle(): { middle: { x: number; y: number }; radius: number } {
  return {
    middle: { x: WIDTH / 2, y: (HEIGHT - PAD.bottom + PAD.top) / 2 },
    radius: Math.min(WIDTH, HEIGHT - PAD.bottom) / 2 - PAD.top,
  }
}

/** Where a point sits on a radar: one axis per label, the first straight up, and
 *  the rest around clockwise. */
function spoke(count: number, at: number): number {
  return -Math.PI / 2 + (at / Math.max(1, count)) * Math.PI * 2
}

/** A radar: an axis out of the middle for every label, and a closed shape for every
 *  series.
 *
 *  Its own frame rather than the grid the bar and line charts share, because the
 *  scale runs outwards here: the rings are the value lines and the spokes are the
 *  labels. A web rather than circles, so a reader can see which ring a corner of a
 *  shape is sitting on.
 *
 *  Each shape is filled faintly as well as drawn, which is what makes two series
 *  readable over each other - a radar of outlines alone is a tangle. */
function radar(chart: Chart, low: number, high: number, step: number, said: Said): string {
  const { middle, radius } = round_middle()
  const count = Math.max(3, longest(chart))
  const reach = (value: number) => (radius * (value - low)) / (high - low || 1)
  const out: string[] = []

  for (let value = low + step; value <= high + step / 2; value += step) {
    const ring = Array.from({ length: count }, (_one, one) =>
      at(middle, reach(value), spoke(count, one)),
    )
    out.push(`<polygon class="chart-grid" points="${ring.join(' ')}" fill="none"/>`)
  }

  for (let one = 0; one < count; one++) {
    const angle = spoke(count, one)
    const rim = at(middle, radius, angle).split(',')
    out.push(
      `<line class="chart-grid" x1="${round(middle.x)}" y1="${round(middle.y)}" x2="${rim[0] ?? 0}" y2="${rim[1] ?? 0}"/>`,
    )

    const label = chart.labels[one]
    if (label === undefined) continue

    const away = at(middle, radius + 14, angle).split(',')
    const across = Math.cos(angle)
    const anchor = Math.abs(across) < 0.2 ? 'middle' : across > 0 ? 'start' : 'end'
    out.push(text(label, Number(away[0] ?? 0), Number(away[1] ?? 0) + 4, 'chart-label', anchor))
  }

  for (const [which, series] of chart.series.entries()) {
    const corners = Array.from({ length: count }, (_one, one) =>
      at(middle, reach(series.data[one] ?? low), spoke(count, one)),
    )
    out.push(
      `<polygon class="chart-area" points="${corners.join(' ')}" fill="${colour(which)}" stroke="${colour(which)}"/>`,
    )

    for (const [one, value] of series.data.slice(0, count).entries()) {
      const point = at(middle, reach(value), spoke(count, one)).split(',')
      out.push(
        `<circle class="chart-dot" cx="${point[0] ?? 0}" cy="${point[1] ?? 0}" r="3" fill="${colour(which)}"><title>${escape(`${series.title ? `${series.title}: ` : ''}${said(value)}`)}</title></circle>`,
      )
    }
  }

  return out.join('')
}

/** A polar area: a pie whose slices all take the same angle, and reach out as far
 *  as their number says.
 *
 *  Which is the one thing a pie cannot show - how big each part is on its own
 *  rather than as a share of the whole - and it is the same slice the pie is drawn
 *  from, turned by an equal step each time. One series only, for the reason a pie is
 *  one series: two sets of slices over each other is two charts. */
function polar(chart: Chart, high: number, said: Said): string {
  const series = chart.series[0]
  if (!series) return ''

  const { middle, radius } = round_middle()
  const values = series.data.map((one) => Math.max(0, one))
  const count = values.length
  if (count === 0) return ''

  const out: string[] = []
  const sweep = (Math.PI * 2) / count

  for (const [one, value] of values.entries()) {
    const reach = high <= 0 ? 0 : (radius * value) / high
    if (reach <= 0) continue

    const from = -Math.PI / 2 + sweep * one
    const name = chart.labels[one] ?? ''
    out.push(
      `<path class="chart-slice" d="${slice(middle, reach, 0, from, from + sweep)}" fill="${colour(one)}"><title>${escape(`${name ? `${name}: ` : ''}${said(value)}`)}</title></path>`,
    )
  }

  return out.join('')
}

function at(middle: { x: number; y: number }, radius: number, angle: number): string {
  return `${round(middle.x + radius * Math.cos(angle))},${round(middle.y + radius * Math.sin(angle))}`
}

function slice(
  middle: { x: number; y: number },
  radius: number,
  hole: number,
  from: number,
  to: number,
): string {
  const big = to - from > Math.PI ? 1 : 0
  const inner = radius * hole

  if (hole === 0) {
    return `M ${middle.x},${middle.y} L ${at(middle, radius, from)} A ${radius},${radius} 0 ${big} 1 ${at(middle, radius, to)} Z`
  }

  return (
    `M ${at(middle, radius, from)} A ${radius},${radius} 0 ${big} 1 ${at(middle, radius, to)}` +
    ` L ${at(middle, inner, to)} A ${inner},${inner} 0 ${big} 0 ${at(middle, inner, from)} Z`
  )
}

/** A whole circle, or a whole ring, which no arc can draw. */
function ring(middle: { x: number; y: number }, radius: number, hole: number): string {
  const circle = (r: number, sweep: 0 | 1) =>
    `M ${round(middle.x - r)},${round(middle.y)} A ${r},${r} 0 1 ${sweep} ${round(middle.x + r)},${round(middle.y)} A ${r},${r} 0 1 ${sweep} ${round(middle.x - r)},${round(middle.y)} Z`

  return hole === 0 ? circle(radius, 1) : `${circle(radius, 1)} ${circle(radius * hole, 0)}`
}

/** Which series is which, when there is more than one to tell apart. A pie names
 *  its slices instead, since its labels are the things rather than the series. */
function legend(chart: Chart): string {
  const sliced = chart.kind === 'pie' || chart.kind === 'donut'
  const named = sliced
    ? chart.labels.slice(0, chart.series[0]?.data.length ?? 0)
    : chart.series.map((one) => one.title)

  const shown = named.filter((one) => one !== '')
  if (shown.length < 2) return ''

  return `<div class="chart-keys">${shown
    .map(
      (name, at) =>
        `<span class="chart-key"><span class="chart-swatch" style="background: ${colour(at)}"></span>${escape(name)}</span>`,
    )
    .join('')}</div>`
}

/** The chart as one SVG, sized by its viewBox so the column decides how wide. */
export function chartSvg(chart: Chart, options?: ChartOptions): string {
  const { low, high, step } = span(chart)
  const said = sayer(options)
  const body = roundly(chart, low, high, step, said) ?? squarely(chart, low, high, step, said)

  return `<svg class="chart-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" preserveAspectRatio="xMidYMid meet">${body}</svg>`
}

/** The four kinds drawn into a circle, or null for one that is not. */
function roundly(chart: Chart, low: number, high: number, step: number, said: Said): string | null {
  if (chart.kind === 'pie') return pie(chart, 0, said)
  if (chart.kind === 'donut') return pie(chart, 0.58, said)
  if (chart.kind === 'polar') return polar(chart, high, said)
  if (chart.kind === 'radar') return radar(chart, low, high, step, said)

  return null
}

/** And the three drawn against a scale across and up: the grid, and the marks over
 *  it. A scatter plot is the line chart without the line; see `lines`. */
function squarely(chart: Chart, low: number, high: number, step: number, said: Said): string {
  const marks =
    chart.kind === 'line'
      ? lines(chart, low, high, said)
      : chart.kind === 'scatter'
        ? lines(chart, low, high, said, false)
        : bars(chart, low, high, said)

  return `${frame(chart, low, high, step, said)}${marks}`
}

/** The whole block a ` ```chart ` fence becomes, or null when the fence holds no
 *  chart it can draw - a kind nothing knows, or no numbers at all - in which case
 *  it stays code, the way a diagram that will not draw does. */
export function chartFigure(source: string, options?: ChartOptions): string | null {
  const chart = readChart(source)
  if (chart === null) return null

  const title = chart.title === null ? '' : `<figcaption>${escape(chart.title)}</figcaption>`
  return `<figure class="chart" data-kind="${chart.kind}">${chartSvg(chart, options)}${legend(chart)}${title}</figure>\n`
}
