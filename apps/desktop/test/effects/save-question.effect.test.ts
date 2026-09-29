import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The question closing a note with unsaved words asks, as a Mac asks it.
 *
 *  Every Mac document app puts Don't Save apart at the left of the sheet, Cancel and
 *  Save at the right with Save the default at the edge, and gives Don't Save Cmd+D.
 *  The row used to be the order it was asked in - Save, Don't save, Cancel - which is
 *  Windows' order, with Cancel where a Mac hand looks for the default.
 *
 *  In the jsdom project because buttons and a keydown need a document. */

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

async function asked() {
  const { prompt } = await import('../../src/lib/prompt.svelte')
  const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
  const shown = mount(PromptSheet, { target })
  close = () => void unmount(shown)

  const answer = prompt.choose({
    title: 'Save Plan?',
    options: [
      { id: 'save', label: 'Save', primary: true },
      { id: 'discard', label: 'Don’t save', danger: true, discards: true },
      { id: 'cancel', label: 'Cancel' },
    ],
  })
  flushSync()

  return { answer, buttons: () => [...target.querySelectorAll('.row button')] }
}

test('a Mac puts Don’t save apart at the left and Save last, at the right edge', async () => {
  const { buttons } = await asked()

  expect(buttons().map((one) => one.textContent.trim())).toEqual(['Don’t save', 'Cancel', 'Save'])
  expect(buttons()[0]?.classList.contains('apart')).toBe(true)
})

test('Cmd+D answers Don’t save', async () => {
  const { answer } = await asked()

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }))

  expect(await answer).toBe('discard')
})
