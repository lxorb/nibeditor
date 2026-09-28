import { describe, expect, test } from 'vitest'
import { mayCarryAddress } from '../drag-paths'
import { droppedAddress } from './dropped'

/** A drop, as the types it was written under and what each holds. */
const drop = (data: Record<string, string>) => (type: string) => data[type] ?? ''

describe('a link dragged onto the strip from another app', () => {
  test('may be carried by a browser s list or by plain text', () => {
    expect(mayCarryAddress(['text/uri-list', 'text/plain'])).toBe(true)
    expect(mayCarryAddress(['text/plain'])).toBe(true)
  })

  /** A file out of Explorer, and the app's own drags, are somebody else's. */
  test('is not a file, nor one of the app s own drags', () => {
    expect(mayCarryAddress(['Files', 'text/uri-list'])).toBe(false)
    expect(mayCarryAddress(['text/nib-path', 'text/plain'])).toBe(false)
    expect(mayCarryAddress(['text/html'])).toBe(false)
  })

  test('opens the first address the list holds, past its comments', () => {
    const read = drop({ 'text/uri-list': '# from a page\r\nhttps://svelte.dev/docs\r\n' })
    expect(droppedAddress(read)).toBe('https://svelte.dev/docs')
  })

  test('opens an address written as plain text', () => {
    expect(droppedAddress(drop({ 'text/plain': '  https://example.com/a  ' }))).toBe(
      'https://example.com/a',
    )
  })

  /** Only a page: the test every web tab is held to. */
  test('opens nothing that is not a page on the web', () => {
    expect(droppedAddress(drop({ 'text/plain': 'a sentence out of a note' }))).toBeNull()
    expect(droppedAddress(drop({ 'text/uri-list': 'file:///C:/notes/a.md' }))).toBeNull()
    expect(droppedAddress(drop({ 'text/plain': 'javascript:alert(1)' }))).toBeNull()
  })
})
