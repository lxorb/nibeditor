/** Escape a page let go by, as the window reads it: the crate says it only while the
 *  app holds the screen (`nib-escape` in src-tauri/src/web_opens.rs), and the window
 *  gives the screen back. See passed.svelte.ts. */

import { expect, test, vi } from 'vitest'

const left = vi.hoisted(() => ({ times: 0 }))

vi.mock('../fullscreen.svelte', () => ({
  fullscreen: {
    leave: () => {
      left.times += 1
      return Promise.resolve()
    },
  },
}))

const { answer, readAsk } = await import('./passed.svelte')

test('Escape is one of the words a page can say, and nothing new besides', () => {
  expect(readAsk({ tab: 'web-1', key: 'escape' })).toEqual({ tab: 'web-1', key: 'escape' })
  expect(readAsk({ tab: 'web-1', key: 'fullscreen' })).toBeNull()
})

test('and it gives the screen back', () => {
  answer('web-1', {} as never, 'escape')
  expect(left.times).toBe(1)
})
