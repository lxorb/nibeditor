import { describe, expect, test } from 'vitest'
import {
  beside,
  isRefused,
  movedTo,
  said,
  systemName,
  type EngineState,
  type Refused,
} from './engine'

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
    expect(systemName('macos')).toBe('')
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

  test('Chromium fetched for the update waiting offers the relaunch into it', () => {
    expect(beside(on({ chosen: 'chromium', installed: false }), false, true)).toBe('relaunch')
  })
})

describe('a fetch that failed', () => {
  const refused = (reason: Refused['reason']): Refused => ({ reason, version: null, detail: 'x' })

  test('is told apart from any other error', () => {
    expect(isRefused(refused('offline'))).toBe(true)
    expect(isRefused('this machine has no folder')).toBe(false)
    expect(isRefused(null)).toBe(false)
  })

  test('says what went wrong in a few words, and nothing when it was stopped', () => {
    expect(said(refused('offline'))).toBe('No connection')
    expect(said(refused('missing'))).toBe('Not in this release')
    expect(said(refused('moved'))).toBe('Needs an update')
    expect(said(refused('unsigned'))).toBe('Signature did not match')
    expect(said(refused('full'))).toBe('Disk full')
    expect(said(refused('failed'))).toBe('Could not be installed')
    expect(said(refused('stopped'))).toBe('')
  })

  test('says which version a release moved on to, and nothing for any other failure', () => {
    expect(movedTo({ ...refused('moved'), version: '0.9.3-12' })).toBe('0.9.3-12')
    expect(movedTo(refused('offline'))).toBeNull()
    expect(movedTo('not a refusal')).toBeNull()
  })
})
