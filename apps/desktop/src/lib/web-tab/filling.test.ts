/** A page holding the whole screen, and the window following it: full screen while a
 *  page holds it, and back to what it was when the page lets go. See filling.svelte.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const frame = {
  full: false,
  asked: [] as boolean[],
  isFullscreen() {
    return Promise.resolve(this.full)
  },
  setFullscreen(on: boolean) {
    this.asked.push(on)
    this.full = on
    return Promise.resolve()
  },
}

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  currentWindow: () => Promise.resolve(frame),
}))

const { filling } = await import('./filling.svelte')

beforeEach(async () => {
  if (filling.by !== null) await filling.give(filling.by)
  frame.full = false
  frame.asked = []
})

test('a page taking the screen takes the window with it, and gives both back', async () => {
  await filling.take('a')
  expect(filling.by).toBe('a')
  expect(frame.full).toBe(true)

  await filling.give('a')
  expect(filling.by).toBe(null)
  expect(frame.full).toBe(false)
})

/** The reader had put the app full screen themselves: a video ending leaves it there. */
test('a window already full screen stays so', async () => {
  frame.full = true
  await filling.take('a')
  await filling.give('a')
  expect(frame.full).toBe(true)
  expect(frame.asked).toEqual([true])
})

test('only the page holding the screen can give it back', async () => {
  await filling.take('a')
  await filling.give('b')
  expect(filling.by).toBe('a')
  expect(frame.full).toBe(true)
})

test('a second say of the same thing changes nothing', async () => {
  await filling.take('a')
  await filling.take('a')
  expect(frame.asked).toEqual([true])
})
