import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** A question with a few answers, as a Mac asks it: the default last, at the right
 *  edge of the row, where the eye and Return look for it. Elsewhere the row is the
 *  order it was asked in.
 *
 *  In the jsdom project because buttons need a document. */

vi.mock('../../src/lib/tauri', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => 'macos',
}))

/** The sheet rises through the Web Animations API, which jsdom does not implement. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

test('a Mac puts the default last, at the right edge', async () => {
  const { prompt } = await import('../../src/lib/prompt.svelte')
  const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
  const shown = mount(PromptSheet, { target })
  close = () => void unmount(shown)

  const answer = prompt.choose({
    title: 'Plan',
    options: [
      { id: 'mine', label: 'Keep mine', primary: true },
      { id: 'both', label: 'Keep both' },
      { id: 'cancel', label: 'Cancel' },
    ],
  })
  flushSync()

  const buttons = [...target.querySelectorAll('.row button')]
  expect(buttons.map((one) => one.textContent.trim())).toEqual(['Keep both', 'Cancel', 'Keep mine'])

  const last = buttons.at(-1)
  if (last instanceof HTMLButtonElement) last.click()
  expect(await answer).toBe('mine')
})
