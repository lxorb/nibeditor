import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/** A hovered tab, as Chrome draws it.
 *
 *  Emil, 2026-10-03, of a hovered tab: *"the hover here doesn't look nice tbh"*. The box
 *  was Chrome's - `kHighlight` in horizontal_tab_style_views.cc: the open tab's top and
 *  sides, as far short of the toolbar as it is of the top of the strip, every corner the
 *  top corner - but what it lit sat three pixels low in it, centred on the open tab's
 *  body rather than on the box, and its fill was a step toward the paper, paler than the
 *  open tab beside it when that stood on a page's bar. Chrome centres a tab's contents in
 *  that box (`GetContentsInsets`, the strip's padding above and below) and lights it in
 *  the header's hover tone, the tone the plus beside it lights in too.
 *
 *  Where the pixels are looked at is a drive's; what is here is the rule, so a later edit
 *  cannot set the words off the box again or give the strip two hovers. */

const TABS = readFileSync(fileURLToPath(new URL('../src/lib/Tabs.svelte', import.meta.url)), 'utf8')

/** The declarations of the one rule `selector` opens in the stylesheet. */
function rule(selector: string): string {
  const at = TABS.indexOf(`\n  ${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return TABS.slice(at, TABS.indexOf('}', at))
}

test('a hovered tab lights in a box as far from the bar as from the top', () => {
  const inset = (one: string) => /inset: ([^;]+);/.exec(one)?.[1]
  expect(inset(rule('.tab::before'))).toBe('var(--tab-top) 3px')
  // The open tab's own top and sides.
  expect(inset(rule('.fill'))).toBe('var(--tab-top) 3px 0')
  expect(rule('.tab::before')).toMatch(/border-radius: var\(--round\);/)
})

test('what a tab says sits in the middle of that box', () => {
  expect(rule('.pick')).toMatch(/padding: var\(--tab-top\) 8px;/)
  for (const one of ['.shut', '.tab::after']) {
    expect(rule(one), one).toMatch(/top: calc\(50% - 8px\);/)
  }
  expect(rule('.new')).toMatch(/top: calc\(50% - var\(--row-height\) \/ 2\);/)
  expect(TABS).not.toMatch(/50% \+ var\(--tab-top\)/)
})

test('the hover is a tone past the frame, not a step toward the paper', () => {
  expect(rule('.tabs')).toMatch(
    /--tab-hover: var\(--glass-tab-hover, color-mix\(in srgb, var\(--text\)/,
  )
  expect(rule('.tabs')).not.toMatch(/--tab-hover:[^;]*--tab-ground/)
})

test('everything on the frame lights the same under the pointer', () => {
  for (const one of ['.new:hover', '.step:hover:not(:disabled)', '.link:hover']) {
    expect(rule(one), one).toMatch(/background: var\(--tab-hover\);/)
  }
})
