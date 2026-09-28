import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/** One size for a finger, everywhere.
 *
 *  A phone and a tablet are not a narrow desktop: a row has to be tall enough
 *  to land a thumb on, the words in it big enough to read at arm's length, and
 *  the marks beside them drawn at a size that survives that. That is the touch
 *  scale in `tokens.css`, and the whole point of it is that every surface reads
 *  the same numbers. A rule that writes 44 or 15 into a component of its own is
 *  how the drawer ends up one size, the menus another and the palette a third,
 *  which is exactly what this was written to end.
 *
 *  A component no longer reads the touch scale directly, though. It reads the
 *  row scale - `--row-height`, `--text-row`, `--icon-md` and the rest - and the
 *  tokens restate that from the touch scale in one `[data-touch]` block, so a
 *  rule is written once and comes out 28px under a pointer and 56 under a
 *  thumb. See docs/design.md.
 *
 *  So: both scales exist, the second is stated in terms of the first, no touch
 *  rule names a finger-sized number of its own, and the surfaces a thumb spends
 *  its time in read one of the two. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const TOKENS = fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url))

/** What the scale is made of, and what it says. Stated here as well as in the
 *  stylesheet so a value cannot drift without somebody having meant it. */
const SCALE = {
  '--touch-target': '48px',
  '--touch-row': '56px',
  '--touch-text': '17px',
  '--touch-icon': '24px',
  '--touch-mark': '20px',
  '--touch-gap': '12px',
  '--touch-pad': '14px',
  '--touch-indent': '18px',
}

/** What a component actually reads, and what a finger turns each of them into.
 *  The row scale is the one vocabulary the shell is written in; this block in
 *  the tokens is the only place a screen with a thumb on it is mentioned. */
const ROW_SCALE = {
  '--row-height': 'var(--touch-row)',
  '--row-height-sm': 'var(--touch-target)',
  '--row-pad': 'var(--touch-pad)',
  '--row-gap': 'var(--touch-gap)',
  '--row-indent': 'var(--touch-indent)',
  '--header-height': 'var(--touch-row)',
  '--icon-md': 'var(--touch-mark)',
  '--icon-lg': 'var(--touch-icon)',
  '--text-row': 'var(--touch-text)',
}

/** The surfaces a thumb spends its time in: the drawer, the lists in it, and
 *  the layers that open over the note. */
const SURFACES = [
  'lib/AppMenu.svelte',
  'lib/Bookmarks.svelte',
  'lib/CanvasBar.svelte',
  'lib/ContextMenu.svelte',
  'lib/FindBar.svelte',
  'lib/Links.svelte',
  'lib/Palette.svelte',
  'lib/SearchPanel.svelte',
  'lib/Sidebar.svelte',
  'lib/SidebarFoot.svelte',
  'lib/SpaceSwitcher.svelte',
  'lib/TagTree.svelte',
  'lib/Titlebar.svelte',
  'lib/Tree.svelte',
]

/** A row a finger has to hit, from this size up. Under it are the things a row
 *  holds rather than rows: a grip, a step between two squares, a hairline. */
const FINGER_HEIGHT = 40
/** Type from this size up is body text, and body text on a touch screen is the
 *  scale's business. Below it are captions and counts. */
const BODY_SIZE = 14

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

/** The `<style>` block with its comments taken out: a comment naming a phone
 *  would otherwise read as a selector for one. */
function styleOf(text: string): string {
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((one) => one[1] ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

interface Component {
  name: string
  text: string
  style: string
}

const components: Component[] = componentFiles(SOURCE).map((path) => {
  const text = readFileSync(path, 'utf8')
  return {
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    text,
    style: styleOf(text),
  }
})

/** Innermost rules only, which is what the pair of braces with nothing but
 *  declarations between them finds. An `@media` around them is left where it
 *  is; the rules inside it are still read. */
function rules(style: string): { selector: string; body: string }[] {
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((one) => ({
    selector: (one[1] ?? '').trim().replace(/\s+/g, ' '),
    body: one[2] ?? '',
  }))
}

/** Whether a rule only applies where fingers do: under the device flag, or in
 *  the phone and sheet variants that are only ever drawn on one. */
function forTouch(selector: string): boolean {
  return /\[data-touch\]|\.phone\b|\.touch\b|\.sheet\b/.test(selector)
}

describe('the touch scale', () => {
  test('the scan finds the components', () => {
    expect(components.length).toBeGreaterThan(10)
  })

  test('the scale is stated once, in the tokens', () => {
    const tokens = readFileSync(TOKENS, 'utf8')

    for (const [name, value] of Object.entries(SCALE)) {
      expect(tokens, `${name} is missing from the tokens`).toContain(`${name}: ${value};`)
    }

    // The one that is a sum rather than a number: a sheet's last row clears the
    // gesture bar by a fixed step above whatever the system says it needs, and by
    // the step alone once it is standing on a keyboard that covers the bar.
    expect(tokens).toContain(
      '--touch-bottom: max(var(--space-4), calc(var(--space-4) + var(--inset-bottom) - var(--keyboard)));',
    )
    expect(tokens).toContain('--keyboard: 0px;')
  })

  test('no touch rule names a finger-sized number of its own', () => {
    const offenders: string[] = []

    for (const one of components) {
      for (const rule of rules(one.style)) {
        if (!forTouch(rule.selector)) continue

        for (const [, property, size] of rule.body.matchAll(
          /(min-height|height|font-size):\s*([\d.]+)px/g,
        )) {
          const pixels = Number(size)
          const tooBig = property === 'font-size' ? pixels >= BODY_SIZE : pixels >= FINGER_HEIGHT
          if (tooBig) offenders.push(`${one.name}: ${rule.selector} { ${property}: ${size}px }`)
        }
      }
    }

    expect(
      offenders,
      `these size themselves instead of reading the scale:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  test('the row scale is restated from the touch scale, in one block', () => {
    const tokens = readFileSync(TOKENS, 'utf8')
    const block = /\[data-touch\]\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? ''

    expect(block, 'the tokens have no [data-touch] block').not.toBe('')

    // Every name a component reads for a size, and what a finger makes of it.
    for (const [name, from] of Object.entries(ROW_SCALE)) {
      expect(block, `${name} is not restated for a finger`).toContain(`${name}: ${from};`)
    }
  })

  test('the surfaces a thumb lands on read one of the two scales', () => {
    const scale =
      /var\(--(touch-(row|target|text|icon|mark|pad|gap|indent)|row-(height|height-sm|pad|gap|indent)|text-row|text-head|icon-(md|lg))\)/

    const missing = SURFACES.filter((name) => {
      const one = components.find((component) => component.name === name)
      // Or it draws no size at all because every row in it is the shared one,
      // which is the same answer said better; see one-of-each.test.ts.
      return !one || !(scale.test(one.style) || one.text.includes('nib-row'))
    })

    expect(missing, `these draw a touch surface without the scale: ${missing.join(', ')}`).toEqual(
      [],
    )
  })

  test('a tree row is a row, and its marks are drawn at the row', () => {
    const tree = components.find((one) => one.name === 'lib/Tree.svelte')?.style ?? ''
    const mark = components.find((one) => one.name === 'lib/FileMark.svelte')?.style ?? ''

    // The step per level, which is the whole of what the tree still sizes: the
    // row itself is `.nib-row` in the themes package.
    expect(tree).toContain('var(--row-indent)')
    // And the mark in front of the name, which is one component for every row
    // the tree has: a file's kind, and whether a folder is open. One size,
    // which the tokens raise to `--touch-mark` under a thumb.
    expect(mark).toContain('width: var(--icon-md)')
    expect(mark).toContain('height: var(--icon-md)')
  })
})
