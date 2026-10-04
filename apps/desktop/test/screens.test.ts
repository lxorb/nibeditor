import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** How big a layer in the middle of the window is, said once.
 *
 *  Emil, 2026-10-01, on a window of about 2000 by 1125: "settings have a strange size
 *  for this screen size". The sheet was 56rem across and 76vh down - a width that
 *  follows the reader's text size and a height that follows the window - so a big
 *  window made it a portrait slab. Six layers had a vh of their own for where they hung
 *  or how tall they got, and eight widths between them.
 *
 *  The scale is in tokens.css and the rule in `.nib-screen`; these hold every layer to
 *  them. What it comes to on a real window, at four sizes and three scales, is
 *  test/e2e/modal-size.py's question. See docs/design.md. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = uncommented(readFileSync(join(THEMES, 'tokens.css'), 'utf8'))
const base = uncommented(readFileSync(join(THEMES, 'base.css'), 'utf8'))

/** The scale, stated here as well so a step cannot move without somebody meaning it. */
const SCALE = {
  '--screen-ask': '24rem',
  '--screen-sheet': '28rem',
  '--screen-list': '36rem',
  '--screen-pair': '46rem',
  '--screen-panes': '60rem',
  '--screen-tall': '44rem',
  '--screen-gutter': 'var(--space-5)',
}

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }
  return out
}

/** The body of the first rule whose selector is exactly this. */
function rule(css: string, selector: string): string | null {
  for (const one of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((one[1] ?? '').trim() === selector) return one[2] ?? ''
  }
  return null
}

/** Every component that stands a `.nib-screen` up, and the class its own rule for that
 *  element is written against: `sheet` beside `class="nib-screen is-centred sheet"`,
 *  or the pair a component that is a screen only sometimes writes. */
const layers = files(SOURCE).flatMap((path) => {
  const text = readFileSync(path, 'utf8')
  const css = uncommented(
    [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1]).join('\n'),
  )
  const name = path.slice(SOURCE.length).replace(/\\/g, '/')
  const fixed = /class="nib-screen(?: is-[a-z]+)* ([a-z-]+)"/.exec(text)?.[1]
  if (fixed) return [{ name, css, selector: `.${fixed}` }]

  const sometimes = /class="([a-z-]+)[^"]*"[^>]*?class:nib-screen=/.exec(text)?.[1]
  return sometimes ? [{ name, css, selector: `.${sometimes}.nib-screen` }] : []
})

describe('the scale', () => {
  test.each(Object.entries(SCALE))('%s is %s', (token, value) => {
    expect(tokens).toMatch(new RegExp(`${token}:\\s*${value.replace(/[()]/g, '\\$&')};`))
  })

  test('is rem both ways, so the two sides follow the reader together', () => {
    for (const [token, value] of Object.entries(SCALE)) {
      if (token !== '--screen-gutter') expect(value, token).toMatch(/rem$/)
    }
  })
})

describe('the rule', () => {
  const screen = rule(base, '.nib-screen') ?? ''

  test('hangs a layer from one line, holds it inside the window, and takes a width of the scale', () => {
    expect(screen).toContain('top: var(--screen-top)')
    expect(screen).toContain(
      'width: min(var(--screen-width, var(--screen-ask)), calc(100vw - 2 * var(--screen-gutter)))',
    )
  })

  test('gives a desktop its heights, and leaves a phone to each sheet', () => {
    for (const selector of [
      ':root:not([data-touch]) .nib-screen',
      ':root:not([data-touch]) .nib-screen.is-centred',
      ':root:not([data-touch]) .nib-screen.is-steady',
    ]) {
      const body = rule(base, selector)
      expect(body, selector).not.toBeNull()
      expect(body, selector).toMatch(/--screen-(tall|height)/)
      expect(body, selector).toContain('var(--screen-gutter)')
    }
  })
})

describe('every layer in the middle of the window', () => {
  test('is found', () => {
    expect(layers.map((one) => one.name).sort()).toEqual([
      'lib/History.svelte',
      'lib/IconPicker.svelte',
      'lib/JoinSheet.svelte',
      'lib/NewKindSheet.svelte',
      'lib/Palette.svelte',
      'lib/PromptSheet.svelte',
      'lib/QuickQuestion.svelte',
      'lib/SettingsPanel.svelte',
      'lib/Sheet.svelte',
      'lib/SignIn.svelte',
      'lib/SpaceChooser.svelte',
      'lib/SpacePicker.svelte',
      'lib/ThemeStore.svelte',
      'lib/quick-add/QuickAddSheet.svelte',
      'lib/remote/HostPicker.svelte',
      'lib/theme-picker/ThemePicker.svelte',
    ])
  })

  test.each(layers)(
    '$name says where and how tall in no number of its own',
    ({ css, selector }) => {
      const own = rule(css, selector)
      expect(own, selector).not.toBeNull()
      expect(own).not.toMatch(/(^|[\s;])(top|height|max-height|translate|position):/)
    },
  )

  test.each(layers)('$name is a width of the scale', ({ css, selector }) => {
    const width = /--screen-width:\s*([^;]+);/.exec(rule(css, selector) ?? '')?.[1]
    if (width === undefined) return
    expect(width).toMatch(
      /^(var\(--screen-[a-z]+\)|var\(--picker-width\)|calc\(var\(--screen-[a-z]+\)[^;]*\))$/,
    )
  })
})
