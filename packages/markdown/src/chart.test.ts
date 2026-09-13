import { describe, expect, test } from 'vitest'
import { chartFigure, chartSvg, readChart, setChartLocale } from './chart'
import { renderMarkdown } from './index'

const SALES = `type: bar
title: Two quarters
labels: [Jan, Feb, Mar]
series:
  - title: Sales
    data: [3, 5, 2]
  - title: Costs
    data: [1, 2, 1]
`

describe('reading a chart out of a fence', () => {
  test('the plugin’s own shape', () => {
    expect(readChart(SALES)).toEqual({
      kind: 'bar',
      title: 'Two quarters',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { title: 'Sales', data: [3, 5, 2] },
        { title: 'Costs', data: [1, 2, 1] },
      ],
    })
  })

  test('a bar chart unless it says otherwise', () => {
    expect(readChart('series:\n  - data: [1, 2]\n')?.kind).toBe('bar')
    expect(readChart('type: line\nseries:\n  - data: [1]\n')?.kind).toBe('line')
    expect(readChart('type: pie\nseries:\n  - data: [1]\n')?.kind).toBe('pie')
    // Chart.js spells it one way and people type the other.
    expect(readChart('type: doughnut\nseries:\n  - data: [1]\n')?.kind).toBe('donut')
    expect(readChart('type: donut\nseries:\n  - data: [1]\n')?.kind).toBe('donut')
    expect(readChart('type: scatter\nseries:\n  - data: [1]\n')?.kind).toBe('scatter')
    expect(readChart('type: radar\nseries:\n  - data: [1]\n')?.kind).toBe('radar')
    expect(readChart('type: polar\nseries:\n  - data: [1]\n')?.kind).toBe('polar')
    // Chart.js's own spelling of the last one.
    expect(readChart('type: polarArea\nseries:\n  - data: [1]\n')?.kind).toBe('polar')
  })

  /** A kind nothing can draw used to come out as a bar chart, which is the right
   *  numbers saying the wrong thing about themselves and nothing a reader can see
   *  happen. Nothing is drawn instead: the fence keeps its own characters, which is
   *  what a diagram that will not draw does. */
  test('and nothing at all for a kind nothing here draws', () => {
    expect(readChart('type: bubble\nseries:\n  - data: [1]\n')).toBeNull()
    expect(chartFigure('type: candlestick\nseries:\n  - data: [1]\n')).toBeNull()
  })

  test('quotes come off, and a key nobody knows is skipped', () => {
    const chart = readChart('title: "A count"\nstacked: true\nseries:\n  - data: [1]\n')
    expect(chart?.title).toBe('A count')
    expect(chart?.series).toEqual([{ title: '', data: [1] }])
  })

  test('one series written as a plain list', () => {
    expect(readChart('labels: [a, b]\nseries: [1, 2]\n')?.series).toEqual([
      { title: '', data: [1, 2] },
    ])
  })

  test('`label` is `title`, which is what the plugin also accepts', () => {
    expect(readChart('series:\n  - label: Sales\n    data: [1]\n')?.series[0]?.title).toBe('Sales')
  })

  test('a value that is not a number is a zero rather than a refusal', () => {
    expect(readChart('series:\n  - data: [1, x, 3]\n')?.series[0]?.data).toEqual([1, 0, 3])
  })

  test('and a fence with no numbers in it is not a chart', () => {
    expect(readChart('')).toBe(null)
    expect(readChart('type: bar\n')).toBe(null)
    expect(readChart('labels: [a, b]\n')).toBe(null)
    expect(readChart('series:\n  - title: Sales\n')).toBe(null)
    expect(readChart('<p>not yaml at all</p>')).toBe(null)
  })

  test('a comment is not data', () => {
    expect(readChart('# a note\nseries:\n  - data: [1]\n')?.series).toHaveLength(1)
  })
})

describe('drawing it', () => {
  test('a bar per number, in the colours the tokens name', () => {
    const svg = chartSvg(readChart(SALES)!)
    expect(svg.match(/<rect class="chart-bar"/g)).toHaveLength(6)
    expect(svg).toContain('fill="var(--accent, #5b4be0)"')
    expect(svg).toContain('fill="var(--canvas-4, #08b94e)"')
    // The scale is drawn, and the labels along the bottom.
    expect(svg).toContain('class="chart-grid"')
    expect(svg).toContain('>Jan<')
  })

  test('the scale lands on numbers somebody would have chosen', () => {
    // Three, five and two over four equal parts reads 5 / 3.33 / 1.67 / 0, and a
    // reader who has to work out what 3.33 is doing there has stopped looking.
    const svg = chartSvg(readChart(SALES)!)
    for (const tick of ['>0<', '>2<', '>4<', '>6<']) expect(svg, tick).toContain(tick)
    expect(svg).not.toContain('3.33')

    // Whatever the size of the numbers.
    const big = chartSvg(readChart('series:\n  - data: [1200, 3700]\n')!)
    for (const tick of ['>0<', '>1,000<', '>4,000<']) expect(big, tick).toContain(tick)

    const small = chartSvg(readChart('series:\n  - data: [0.2, 0.9]\n')!)
    expect(small).toContain('>1<')
  })

  test('and reaches below zero when the numbers do', () => {
    const svg = chartSvg(readChart('series:\n  - data: [-3, 4]\n')!)
    for (const tick of ['>-4<', '>-2<', '>0<', '>4<']) expect(svg, tick).toContain(tick)
  })

  test('a line per series, with a dot per number', () => {
    const svg = chartSvg(readChart('type: line\nseries:\n  - data: [1, 4, 2]\n')!)
    expect(svg.match(/<polyline class="chart-line"/g)).toHaveLength(1)
    expect(svg.match(/<circle class="chart-dot"/g)).toHaveLength(3)
  })

  test('a slice per number, and a donut has a hole in it', () => {
    const pie = chartSvg(readChart('type: pie\nlabels: [a, b]\nseries:\n  - data: [1, 3]\n')!)
    expect(pie.match(/<path class="chart-slice"/g)).toHaveLength(2)
    // A pie's slices meet at the middle; a donut's do not.
    expect(pie).toContain('M 320,')
    const donut = chartSvg(readChart('type: donut\nseries:\n  - data: [1, 3]\n')!)
    expect(donut.match(/<path class="chart-slice"/g)).toHaveLength(2)
    expect(donut).not.toContain('M 320,150 L')
  })

  test('a single value fills the whole circle rather than drawing nothing', () => {
    // An arc from a point to the same point is drawn as no arc at all.
    const svg = chartSvg(readChart('type: pie\nseries:\n  - data: [7]\n')!)
    expect(svg.match(/<path class="chart-slice"/g)).toHaveLength(1)
    expect(svg).toContain('A ')
  })

  test('negative numbers hang below a baseline in the right place', () => {
    const svg = chartSvg(readChart('series:\n  - data: [-4, 4]\n')!)
    expect(svg).toContain('class="chart-axis"')
    expect(svg.match(/<rect class="chart-bar"/g)).toHaveLength(2)
  })

  test('a chart of nothing but zeroes still has a scale', () => {
    expect(() => chartSvg(readChart('series:\n  - data: [0, 0]\n')!)).not.toThrow()
  })

  test('every number is a hover title, so the picture is not the only reading', () => {
    expect(chartSvg(readChart(SALES)!)).toContain('<title>Sales: 5</title>')
  })

  test('scales with the column rather than asking for a width', () => {
    const svg = chartSvg(readChart(SALES)!)
    expect(svg).toContain('viewBox="0 0 640 340"')
    expect(svg).not.toContain('width="640"')
  })
})

describe('the block a fence becomes', () => {
  test('the picture, a legend and the title', () => {
    const figure = chartFigure(SALES) ?? ''
    expect(figure).toContain('<figure class="chart" data-kind="bar">')
    expect(figure).toContain('<figcaption>Two quarters</figcaption>')
    expect(figure).toContain('class="chart-key"')
    expect(figure).toContain('Sales')
  })

  test('and no legend when there is nothing to tell apart', () => {
    expect(chartFigure('series:\n  - title: Sales\n    data: [1]\n')).not.toContain('chart-keys')
  })

  test('a pie names its slices rather than its series', () => {
    const figure = chartFigure('type: pie\nlabels: [Bern, Zug]\nseries:\n  - data: [1, 2]\n') ?? ''
    expect(figure).toContain('Bern')
    expect(figure).toContain('Zug')
  })

  test('nothing a note wrote can end an attribute or open a tag', () => {
    const hostile = 'title: "</svg><script>alert(1)</script>"\nseries:\n  - data: [1]\n'
    const figure = chartFigure(hostile) ?? ''
    expect(figure).not.toContain('<script')
    expect(figure).not.toContain('</svg>a')
  })

  test('a label with a quote in it cannot break out of the text', () => {
    const figure = chartFigure('labels: ["a\\"><b"]\nseries:\n  - data: [1]\n') ?? ''
    expect(figure).not.toContain('><b<')
  })
})

describe('a chart in a note', () => {
  test('is drawn wherever a note is rendered, publishing included', () => {
    for (const escapeHtml of [false, true]) {
      const html = renderMarkdown('```chart\n' + SALES + '```\n', { escapeHtml })
      expect(html, String(escapeHtml)).toContain('<figure class="chart"')
      expect(html, String(escapeHtml)).not.toContain('<pre>')
    }
  })

  test('and a fence that is not a chart stays code', () => {
    const html = renderMarkdown('```chart\nnot a chart\n```\n')
    expect(html).toContain('<pre>')
    expect(html).toContain('not a chart')
  })

  test('a fence in another language is left alone', () => {
    expect(renderMarkdown('```yaml\ntype: bar\nseries:\n  - data: [1]\n```\n')).toContain('<pre>')
  })
})

/** A thousand is `1,234.5` in English and `1.234,5` in German, and which of the
 *  two a reader sees is the language the app is set to rather than the language of
 *  the machine under it. The numbers are the labels down the axis and every hover
 *  title. */
describe('the language the numbers are written in', () => {
  const THOUSANDS = 'series:\n  - title: Sales\n    data: [1234.5, 2000]\n'

  test('English, where nobody has said otherwise', () => {
    const svg = chartSvg(readChart(THOUSANDS)!)
    expect(svg).toContain('<title>Sales: 1,234.5</title>')
    expect(svg).toContain('>1,000<')
  })

  test('and the one the caller names', () => {
    const svg = chartSvg(readChart(THOUSANDS)!, { locale: 'de' })
    expect(svg).toContain('<title>Sales: 1.234,5</title>')
    expect(svg).toContain('>1.000<')
  })

  test('through the block a fence becomes', () => {
    expect(chartFigure(THOUSANDS, { locale: 'de' })).toContain('1.234,5')
    expect(chartFigure(THOUSANDS)).toContain('1,234.5')
  })

  /** What the Worker that publishes a note passes, per render: one isolate serves
   *  many sites, so it cannot say it once the way the app does. */
  test('through a render option, which reaches a chart inside the note', () => {
    const fence = '```chart\n' + THOUSANDS + '```\n'
    expect(renderMarkdown(fence, { locale: 'de' })).toContain('1.234,5')
    expect(renderMarkdown(fence, { locale: 'en-US' })).toContain('1,234.5')
    // A published page renders with four other options set; the language has to
    // survive the company.
    expect(renderMarkdown(fence, { locale: 'de', escapeHtml: true, toc: true })).toContain(
      '1.234,5',
    )
  })

  /** What the app says once, from the language it is set to, for the five surfaces
   *  that draw a chart with no option between them. */
  test('or once, for every caller that names none', () => {
    try {
      setChartLocale('de')
      expect(chartFigure(THOUSANDS)).toContain('1.234,5')
      // An option still wins, so the Worker is never at the mercy of this.
      expect(chartFigure(THOUSANDS, { locale: 'en-US' })).toContain('1,234.5')
    } finally {
      setChartLocale('')
    }
  })

  test('and English again when what it is handed is nothing', () => {
    setChartLocale('')
    expect(chartFigure(THOUSANDS)).toContain('1,234.5')
  })
})

/** The three kinds that used to be silently drawn as something else: a radar, a
 *  polar area and a scatter plot. Each of them is a picture a note can hold - the
 *  grounds for leaving them out were about prose, and a chart somebody asked for by
 *  name and got a different chart of is worse than any of them. */
describe('the kinds that were drawn as a bar chart', () => {
  const THREE = 'labels: [a, b, c]\nseries:\n  - title: One\n    data: [3, 1, 2]\n'

  test('a radar draws its web, its spokes and a shape per series', () => {
    const svg = chartSvg(readChart(`type: radar\n${THREE}`)!)

    // The rings of the scale as polygons, which is what makes it a web rather than a
    // set of circles, and one spoke per label with the label at its end.
    expect(svg).toContain('<polygon class="chart-grid"')
    expect(svg).toContain('<polygon class="chart-area"')
    expect(svg.match(/class="chart-label"/g)?.length).toBe(3)
    // And not the grid a bar chart is drawn against.
    expect(svg).not.toContain('<line class="chart-grid" x1="48"')
  })

  test('a radar of two series draws both, in two colours', () => {
    const two = `type: radar\nlabels: [a, b]\nseries:\n  - data: [1, 2]\n  - data: [2, 1]\n`
    const svg = chartSvg(readChart(two)!)

    expect(svg.match(/class="chart-area"/g)?.length).toBe(2)
  })

  test('a polar area draws a slice per number, each reaching as far as it says', () => {
    const svg = chartSvg(readChart(`type: polar\n${THREE}`)!)

    expect(svg.match(/class="chart-slice"/g)?.length).toBe(3)
    // Slices of its own rather than a pie's: a pie's three slices all reach the rim.
    expect(svg).not.toContain('<polygon')
  })

  test('a scatter draws the points and no line through them', () => {
    const svg = chartSvg(readChart(`type: scatter\n${THREE}`)!)

    expect(svg.match(/class="chart-dot"/g)?.length).toBe(3)
    expect(svg).not.toContain('chart-line')
    // Against the same grid a line chart is drawn against, so the numbers read the
    // same way.
    expect(svg).toContain('class="chart-grid"')
  })

  test('a line still draws its line, which is the whole difference', () => {
    expect(chartSvg(readChart(`type: line\n${THREE}`)!)).toContain('chart-line')
  })

  test('and every one of them is the kind the figure says it is', () => {
    for (const kind of ['radar', 'polar', 'scatter']) {
      expect(chartFigure(`type: ${kind}\n${THREE}`), kind).toContain(`data-kind="${kind}"`)
    }
  })
})
