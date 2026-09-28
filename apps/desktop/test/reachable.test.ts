import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What a key can reach and what a screen reader reads out, where the shape of
 *  the build or the shape of the window means it should not.
 *
 *  Both of these are invisible on a screen and so are exactly the kind of thing
 *  that comes back: a button drawn 0 by 0 still answers Tab and is still read
 *  out, and a layer slid off the side of a phone is still in the page. The rule
 *  in each case is to leave the thing out, or to mark the layer inert - never to
 *  hide it with a stylesheet. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

/** What is inside `{#if condition}` in a component, block matched by counting
 *  the `{#` and `{/` that open and close blocks between. */
function branch(text: string, condition: string): string {
  const opening = `{#if ${condition}}`
  const from = text.indexOf(opening)
  expect(from, `no ${opening}`).toBeGreaterThanOrEqual(0)

  let depth = 1
  let at = from + opening.length
  while (depth > 0) {
    const next = /\{[#/]/.exec(text.slice(at))
    if (!next) throw new Error(`${opening} is never closed`)

    at += next.index + 2
    depth += next[0] === '{#' ? 1 : -1
  }

  return text.slice(from, at)
}

describe('the window buttons', () => {
  const titlebar = read('lib/Titlebar.svelte')
  // Not on a Mac either, which keeps its own traffic lights; see Titlebar.svelte.
  const desktop = branch(titlebar, 'isDesktop && !mac')

  /** A browser tab has no window of its own to minimise, maximise or close, and
   *  neither has the phone app. A Mac has them, drawn by the system. Left out rather than hidden: three buttons a
   *  stylesheet has shrunk to nothing are still three buttons a key reaches and
   *  a screen reader reads out. */
  test.each(['Minimize', 'Maximize', 'Restore', 'Close'])(
    'draw %s only where there is a window to press it on',
    (label) => {
      const asked = `t('${label}')`
      expect(titlebar, label).toContain(asked)
      expect(desktop, label).toContain(asked)

      // Once inside the branch and nowhere else outside it.
      expect(titlebar.split(asked).length - 1).toBe(desktop.split(asked).length - 1)
    },
  )

  /** The other half of the rule: nothing hides them instead. */
  test('are never shrunk or hidden by the stylesheet', () => {
    const style = /<style[^>]*>([\s\S]*)<\/style>/.exec(titlebar)?.[1] ?? ''

    // Innermost rules only, which is enough: every rule about these is one.
    const about = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => (rule[1] ?? '').includes('.controls'))
      .map((rule) => rule[2] ?? '')

    expect(about.length).toBeGreaterThan(0)
    for (const declarations of about) {
      expect(declarations).not.toMatch(/width:\s*0[;\s]/)
      expect(declarations).not.toMatch(/height:\s*0[;\s]/)
      expect(declarations).not.toMatch(/display:\s*none/)
      expect(declarations).not.toMatch(/visibility:\s*hidden/)
    }
  })
})

describe('the layer the rail and the file list sit in', () => {
  const app = read('App.svelte')

  /** Wherever the panels are a drawer, a shut drawer is off screen: behind the
   *  note at the narrow end, slid off to the side above that. The hamburger at
   *  the top of the rail is in there, and the only thing a thumb can reach while
   *  it is shut is the bar's own sidebar button - so the whole layer is inert
   *  rather than merely moved, on the same condition that moves it. */
  test('is inert wherever a shut drawer has taken it off screen', () => {
    expect(app).toContain('inert={viewport.drawer && !workspace.panel}')
  })

  /** The condition it used to carry. `narrow` is 460 px and under, which left a
   *  phone held sideways and a tablet held upright announcing a rail nothing
   *  could tap. */
  test('is not inert on the narrow width alone', () => {
    expect(app).not.toContain('inert={viewport.narrow')
  })

  test('is what slides, so the condition and the movement agree', () => {
    expect(app).toContain(':global([data-drawer]) .panels')
  })
})
