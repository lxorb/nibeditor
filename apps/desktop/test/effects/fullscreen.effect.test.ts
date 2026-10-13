import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { closeOnBack } from '../../src/lib/backstack.svelte'
import { fullscreen } from '../../src/lib/fullscreen.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { reactive, root, watch } from './runes.svelte'

/** Two of App.svelte's effects about the screen with nothing on it but the
 *  document, both of which are a store method called from an effect.
 *
 *  `fullscreen.follow` is the shape said.svelte.ts got wrong: it reads the state it
 *  writes. Called from an effect, `on` and the panes become that effect's
 *  dependencies, and it writes `fills` and, through `leave()`, `on` - so the effect
 *  runs again, and the only reason it stops is that what it writes is already what it
 *  reads the second time. What is asserted here is that it does stop, and in how many
 *  runs: src/lib/fullscreen.test.ts calls the same method by hand, which cannot tell a
 *  store that settles from one that would not.
 *
 *  `closeOnBack` is the other half: an effect whose teardown is a layer of history
 *  given back, which wants a real `history` and a real popstate to be honest
 *  about. Neither needs a window measured or a pixel painted. */

beforeEach(() => {
  viewport.device = 'desktop'
})

/** Panes as the store has them, reactive: two, the left one worked in. */
function panes() {
  return reactive<{
    fills: string | null
    focusedId: string
    focused: { activeTabId: string | null }
  }>({
    fills: null,
    focusedId: 'left',
    focused: { activeTabId: 'a' },
  })
}

afterEach(async () => {
  await fullscreen.leave()
  viewport.device = 'desktop'
})

test('full screen follows the pane worked in, and settles every time', async () => {
  const two = panes()
  let runs = 0

  const stop = root(() => {
    watch(() => {
      runs++
      fullscreen.follow()
    })
  })

  flushSync()
  expect(runs).toBe(1)

  await fullscreen.enter(two)
  flushSync()
  expect(two.fills).toBe('left')
  // Entering wrote `on`, which the effect read through `follow`.
  expect(runs).toBe(2)

  // Another pane worked in: the screen goes with it, in two runs - the one that moved
  // it, and the one the move woke, which found nothing left to do.
  two.focusedId = 'right'
  flushSync()
  expect(two.fills).toBe('right')
  expect(runs).toBe(4)

  // That pane showing nothing brings the app back. A method that decided from the
  // state it writes - said.svelte.ts's bug - is how this becomes a thousand.
  two.focused.activeTabId = null
  flushSync()
  expect(fullscreen.on).toBe(false)
  expect(two.fills).toBe(null)
  expect(runs).toBe(6)

  stop()
})

test('on a phone, back leaves full screen rather than the app', async () => {
  viewport.device = 'phone'

  const stop = root(() => {
    watch(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))
  })

  flushSync()
  const before = history.length

  // A layer that is open takes an entry, so back has something of its own to
  // answer.
  await fullscreen.enter(panes())
  flushSync()
  expect(history.length).toBe(before + 1)

  const heard = new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })
  history.back()
  await heard
  flushSync()

  expect(fullscreen.on).toBe(false)

  stop()
})

test('on a desktop, back means the previous page and nothing is registered', async () => {
  const stop = root(() => {
    watch(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))
  })

  flushSync()
  const before = history.length

  await fullscreen.enter(panes())
  flushSync()
  expect(fullscreen.on).toBe(true)
  expect(history.length).toBe(before)

  stop()
})
