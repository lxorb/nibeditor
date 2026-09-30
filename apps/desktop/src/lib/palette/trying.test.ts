import { describe, expect, test } from 'vitest'
import { lookOf } from './trying'
import { command } from './world.fixture'

const KEPT = { id: 'default', scheme: 'system' as const, accent: 'violet' }

const row = (id: string, disabled = false) => ({
  kind: 'command' as const,
  command: command(id, id, { disabled }),
})

describe('the look a row is', () => {
  test('is the theme, the mode or the accent it names, over what was kept', () => {
    expect(lookOf(row('theme:sepia'), KEPT)).toEqual({ ...KEPT, id: 'sepia' })
    expect(lookOf(row('scheme:dark'), KEPT)).toEqual({ ...KEPT, scheme: 'dark' })
    expect(lookOf(row('accent:teal'), KEPT)).toEqual({ ...KEPT, accent: 'teal' })
  })

  test('is nothing for any other row, or a mode the theme cannot show', () => {
    expect(lookOf(row('themes'), KEPT)).toBeNull()
    expect(lookOf(row('reopen'), KEPT)).toBeNull()
    expect(lookOf(row('scheme:sepia'), KEPT)).toBeNull()
    expect(lookOf(row('scheme:dark', true), KEPT)).toBeNull()
    expect(lookOf(undefined, KEPT)).toBeNull()
  })
})
