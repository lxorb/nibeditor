import { describe, expect, test } from 'vitest'
import { beside, systemName, type EngineState } from './engine'

const on = (state: Partial<EngineState>): EngineState => ({
  running: 'system',
  chosen: 'system',
  offered: true,
  installed: false,
  fellBack: false,
  ...state,
})

describe('the engine row', () => {
  test('the system engine is named after its browser, and there is no row without one', () => {
    expect(systemName('windows')).toBe('Edge')
    expect(systemName('macos')).toBe('Safari')
    expect(systemName('linux')).toBe('')
    expect(systemName('android')).toBe('')
    expect(systemName('')).toBe('')
  })

  test('nothing sits beside the control while the chosen engine is the running one', () => {
    expect(beside(on({}), false)).toBe('nothing')
    expect(beside(on({ running: 'chromium', chosen: 'chromium', installed: true }), false)).toBe(
      'nothing',
    )
  })

  test('Relaunch appears once the chosen engine can be started', () => {
    expect(beside(on({ chosen: 'chromium', installed: true }), false)).toBe('relaunch')
    // The system's engine is always there to go back to.
    expect(beside(on({ running: 'chromium', chosen: 'system' }), false)).toBe('relaunch')
  })

  test('Chromium not fetched yet offers no relaunch, and a fetch shows its ring', () => {
    expect(beside(on({ chosen: 'chromium', installed: false }), false)).toBe('nothing')
    expect(beside(on({ chosen: 'chromium', installed: false }), true)).toBe('fetching')
  })
})
