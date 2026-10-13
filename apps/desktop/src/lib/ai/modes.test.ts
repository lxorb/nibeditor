import { describe, expect, test } from 'vitest'
import { actsAlone, FIRST_MODE, MODES, modeIn, modeOfGrant, nextMode } from './modes'

describe('the permission modes', () => {
  test('are Approve, Auto and Full permissions, least to most, and then Plan', () => {
    expect(MODES).toEqual(['approve', 'auto', 'full', 'plan'])
    expect(FIRST_MODE).toBe('approve')
  })

  test('read the words older threads and notes wrote', () => {
    expect(modeIn('ask')).toBe('approve')
    expect(modeIn('agent')).toBe('full')
    expect(modeIn('auto')).toBe('auto')
    expect(modeIn('bypassPermissions')).toBeNull()
    expect(modeIn(3)).toBeNull()
  })

  test('step with Shift+Tab through Approve, Auto and Plan, never into Full permissions', () => {
    const seen = new Set<string>()
    let mode = FIRST_MODE
    for (let step = 0; step < 6; step++) {
      seen.add(mode)
      mode = nextMode(mode)
    }
    expect([...seen].sort()).toEqual(['approve', 'auto', 'plan'])
    expect(nextMode('full')).toBe('plan')
  })

  test('say which make changes without asking', () => {
    expect(MODES.filter(actsAlone)).toEqual(['auto', 'full'])
  })

  test('are what an outside agent’s grant supervises its helper as', () => {
    expect(modeOfGrant('confirm')).toBe('approve')
    expect(modeOfGrant('unsupervised')).toBe('auto')
    expect(modeOfGrant('autonomous')).toBe('full')
  })
})
