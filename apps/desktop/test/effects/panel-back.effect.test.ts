/** The drawer over a phone's document, and the history entry it stands on.
 *
 *  On a phone the sidebar is a layer over the note, so back closes it rather than
 *  leaving the app: App.svelte registers it with `closeOnBack`, which takes a
 *  history entry while the layer is open and gives it back when it closes.
 *
 *  The bug this file is here to keep from coming back: the effect was written as
 *  `closeOnBack(!!workspace.panel, …)`, and a `!!` does not narrow what an effect
 *  depends on - it read `panel`, so asking for *another* panel while the drawer
 *  stood re-ran it. The teardown gave an entry back and the body took a new one, in
 *  one turn, with `history.back()` answered a turn later: the count drifted, and the
 *  third panel in a row walked the window off the end of its own history and out of
 *  the app. `window.nibApp` went with it, with nothing in the console to say why -
 *  `outline, links, outline` on a 390-wide window was enough.
 *
 *  What is asserted is the entry count, because that is the fact: one layer open is
 *  one entry, however many times the panel inside it changes. */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { closeOnBack } from '../../src/lib/backstack.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'
import { computed, root, watch } from './runes.svelte'

beforeEach(() => {
  viewport.device = 'phone'
  workspace.panel = null
})

afterEach(() => {
  workspace.panel = null
  viewport.device = 'desktop'
})

/** App.svelte's own pair of lines, as the app writes them: the boolean is derived
 *  first, so the effect depends on whether a side is covered and not on which panel
 *  covers it. `computed` is what a `$derived` is in a file the compiler does not
 *  read as a component; see runes.svelte.ts. */
function registerAsTheAppDoes(): () => void {
  return root(() => {
    const covered = computed(() => !!workspace.panel)
    watch(() => closeOnBack(covered(), () => workspace.closePanel()))
  })
}

test('one drawer is one history entry, however often the panel inside it changes', () => {
  const stop = registerAsTheAppDoes()
  flushSync()

  const before = history.length

  // The drawer opens: one entry, so back has something of its own to answer.
  workspace.showPanel('outline')
  flushSync()
  expect(workspace.panel).toBe('outline')
  expect(history.length).toBe(before + 1)

  // And now the panel inside the same drawer, twice. This is the gesture that took
  // the app away: a third request is where the drift became fatal.
  workspace.showPanel('links')
  flushSync()
  expect(workspace.panel).toBe('links')
  expect(history.length).toBe(before + 1)

  workspace.showPanel('outline')
  flushSync()
  expect(workspace.panel).toBe('outline')
  expect(history.length).toBe(before + 1)

  workspace.showPanel('search')
  flushSync()
  expect(workspace.panel).toBe('search')
  expect(history.length).toBe(before + 1)

  stop()
})

test('and the entry is given back when the drawer itself closes', async () => {
  const stop = registerAsTheAppDoes()
  flushSync()

  const before = history.length
  workspace.showPanel('outline')
  flushSync()
  expect(history.length).toBe(before + 1)

  const heard = new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })

  workspace.closePanel()
  flushSync()
  await heard
  flushSync()

  expect(workspace.panel).toBe(null)

  stop()
})
