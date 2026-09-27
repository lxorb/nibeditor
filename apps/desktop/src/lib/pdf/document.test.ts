import { describe, expect, test } from 'vitest'
import { current } from './document'

/** Which pdf.js a window loads. The current build calls a handful of the newest
 *  built-ins without asking whether they are there, and a Mac's WebKit is as old as
 *  its macOS; see `current` in document.ts. */
describe('which pdf.js this engine can run', () => {
  const modern = {
    Promise: { try: () => undefined },
    Uint8Array: { fromBase64: () => undefined },
    Math: { sumPrecise: () => 0 },
  }

  test('the current one, where every built-in it relies on is there', () => {
    expect(current(modern)).toBe(true)
  })

  test.each(['Promise', 'Uint8Array', 'Math'] as const)(
    'the legacy one, where %s is missing what it needs',
    (name) => {
      expect(current({ ...modern, [name]: {} })).toBe(false)
    },
  )
})
