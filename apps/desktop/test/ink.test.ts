import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ACCENTS, accentTokens } from '../src/lib/accents'

/** What is written on a fill of the accent, measured.
 *
 *  The accent cannot be both the ink and the fill: on the dark side a colour bright
 *  enough to be read on the page is too bright to carry white, which came to 3.98 to
 *  one on every primary button, and to 2.67 on the High contrast theme, the one a
 *  reader chooses to be able to read. So what is written on a fill is a token of its
 *  own, `--accent-ink`, answered per scheme: the dark ink on the dark side and white
 *  on the light one - the way Material's `onPrimary` is, and Obsidian's
 *  `--text-on-accent`. This holds the floor on every palette the app ships and on
 *  every accent a reader can pick, at rest, under the pointer and pressed, and holds
 *  every stylesheet to the token. See docs/design.md, "Ink on a fill". */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

/** What WCAG asks of words, and of an 11px capital on a button. */
const FLOOR = 4.5

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ]
}

function light(hex: string): number {
  const [r, g, b] = channels(hex).map((one) => {
    const value = one / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(one: string, two: string): number {
  const [high, low] = [light(one), light(two)].sort((a, b) => b - a) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

/** The hex colours a block of a stylesheet states, by token. */
function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  if (at === -1) throw new Error(`no \`${selector}\` block`)
  const body = css.slice(at, css.indexOf('\n}', at))

  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((one): [string, string] => [
      one[1] ?? '',
      one[2] ?? '',
    ]),
  )
}

const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')
const contrast = readFileSync(join(THEMES, 'contrast.css'), 'utf8')

const BUILT_IN = {
  dark: block(tokens, ":root,\n[data-theme='dark']"),
  light: block(tokens, "[data-theme='light']"),
}

/** Every palette the app ships, as the page would have it: a theme's own block
 *  over the built-in one for its side. Glass restates no accent and no ink, so it
 *  is the built-in pair, and the accent a reader picks is measured below. */
const PALETTES: [string, Record<string, string>][] = [
  ['dark', BUILT_IN.dark],
  ['light', BUILT_IN.light],
  ['High contrast, dark', { ...BUILT_IN.dark, ...block(contrast, "[data-theme='dark']") }],
  ['High contrast, light', { ...BUILT_IN.light, ...block(contrast, "[data-theme='light']") }],
]

describe('ink on a fill of the accent', () => {
  test('is a token on both sides', () => {
    expect(BUILT_IN.dark['--accent-ink']).toBeDefined()
    expect(BUILT_IN.light['--accent-ink']).toBeDefined()
  })

  test.each(PALETTES)('clears the floor on %s, at rest, hovered and pressed', (_, palette) => {
    const ink = palette['--accent-ink'] ?? ''
    // The danger fill is the other button a sheet has, and it wears the same ink.
    const fills = ['--accent', '--accent-hover', '--accent-press', '--danger']

    const short = fills
      .map((fill) => ({ fill, ratio: ratio(ink, palette[fill] ?? '') }))
      .filter((one) => one.ratio < FLOOR)
      .map((one) => `${one.fill} ${one.ratio.toFixed(2)}`)

    expect(short).toEqual([])
  })

  /** A reader's own accent, and a person's colour in the Share sheet and on a caret,
   *  which are drawn from the same row of colours. */
  test('and on every accent a reader can pick, on both sides', () => {
    const short = ACCENTS.flatMap((accent) =>
      (['dark', 'light'] as const).flatMap((scheme) => {
        const painted = accentTokens(accent.id, scheme)
        const ink = BUILT_IN[scheme]['--accent-ink'] ?? ''

        return ['--accent', '--accent-hover', '--accent-press']
          .map((fill) => ({ fill, ratio: ratio(ink, painted[fill] ?? '') }))
          .filter((one) => one.ratio < FLOOR)
          .map((one) => `${accent.id} ${scheme} ${one.fill} ${one.ratio.toFixed(2)}`)
      }),
    )

    expect(short).toEqual([])
  })
})

function files(dir: string, suffix: RegExp): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, suffix))
    else if (suffix.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

/** A white written straight onto something: a colour, a stroke, a badge's ink. */
const WHITE_INK =
  /(?<![\w-])(color|stroke|--badge-ink)\s*[:=]\s*["']?(#fff\b|#ffffff\b|white\b)|style:--badge-ink="#fff/i

describe('the stylesheets', () => {
  test('write on an accent in the ink, never in a white of their own', () => {
    const sources = [
      ...files(SOURCE, /\.svelte$/),
      ...files(THEMES, /^(base|document|editor|slides|tokens)\.css$/),
    ]

    const white = sources
      .map((path) => ({
        name: path.replace(/\\/g, '/').split('/src/').pop() ?? path,
        text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
      }))
      // The window's own close button on Windows is the platform's drawing: a white
      // cross on the caption's red, which is what every Windows app draws there.
      .filter((one) => one.name !== 'lib/Titlebar.svelte')
      .filter((one) => WHITE_INK.test(one.text))
      .map((one) => one.name)

    expect(white).toEqual([])
  })
})
