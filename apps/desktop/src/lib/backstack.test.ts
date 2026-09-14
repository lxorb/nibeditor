/** The history a phone's layers stand on, as the app registers them.
 *
 *  The stack itself is driven in test/effects/panel-back.effect.test.ts, where there
 *  is a real `history` and a real popstate to be honest about. This is the other
 *  half, and it is about a shape rather than a behaviour: `closeOnBack` takes a
 *  boolean, and where that boolean comes from decides what the effect around it
 *  depends on.
 *
 *  Written inline as `closeOnBack(!!workspace.panel, …)`, the effect reads `panel`
 *  itself - a `!!` narrows the value and not the dependency - so asking for another
 *  panel while the drawer stood re-ran it: the teardown gave the entry back and the
 *  body took a new one, in one turn, with `history.back()` answered a turn later. The
 *  count drifted, and the third panel in a row walked the window off the end of its
 *  own history and out of the app - the drawer gone, `window.nibApp` gone, and
 *  nothing in the console to say so. `outline, links, outline` on a phone was enough.
 *
 *  An effect inside a component cannot be reached from a test, so the line is read as
 *  text; src/lib/fullscreen.test.ts asserts its own the same way. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../', import.meta.url))
const app = readFileSync(`${SOURCE}App.svelte`, 'utf8')

test('the drawer is registered on whether a side is covered, not on which panel', () => {
  expect(app).toContain('const covered = $derived(!!workspace.panel)')
  expect(app).toContain('closeOnBack(covered, () => workspace.closePanel())')

  expect(app).toContain('const coveredRight = $derived(!!workspace.rightPanel)')
  expect(app).toContain("closeOnBack(coveredRight, () => workspace.closePanel('right'))")
})

test('and never on the panel itself, which is what took the app away', () => {
  expect(app).not.toContain('closeOnBack(!!workspace.panel')
  expect(app).not.toContain('closeOnBack(!!workspace.rightPanel')
})
