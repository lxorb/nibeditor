import { afterEach, describe, expect, test } from 'vitest'
import { settings } from '../settings.svelte'

/** A page that became part of another is still opened by its old id - a command, an
 *  agent's `open` and a link all say it - and lands where its rows went. */
describe('a page by the id it had', () => {
  afterEach(() => {
    settings.open = false
  })

  test.each([
    ['spelling', 'editor'],
    ['remote', 'terminal'],
    ['online', 'terminal'],
    ['import', 'export'],
    ['agents', 'ai'],
    ['llm', 'ai'],
  ] as const)('%s opens %s', (old, now) => {
    settings.show(old)
    expect(settings.section).toBe(now)
    expect(settings.open).toBe(true)
  })

  test('Spelling is marked for the page to land on, partway down Editor', () => {
    settings.show('spelling')
    expect(settings.at).toBe('spelling')
  })

  test('a page by its own id opens itself', () => {
    settings.show('browser')
    expect(settings.section).toBe('browser')
    expect(settings.at).toBeNull()
  })
})
