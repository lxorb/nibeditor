import { describe, expect, test } from 'vitest'
import { taskText } from './task'

describe('a page as a task', () => {
  test('the page, by its title', () => {
    expect(taskText({ title: 'How [not] to bake', url: 'https://example.com/bake' })).toBe(
      '[How not to bake](https://example.com/bake)',
    )
  })

  test('the link under the cursor, and the words chosen as its words', () => {
    expect(
      taskText({
        title: 'A page',
        url: 'https://example.com/',
        link: 'https://example.com/form',
        selection: '  Renew   the passport ',
      }),
    ).toBe('[Renew the passport](https://example.com/form)')
  })

  test('a page with no address worth linking is its words alone', () => {
    expect(taskText({ title: 'Settings', url: 'chrome://settings' })).toBe('Settings')
  })
})
