import { describe, expect, test } from 'vitest'
import { about } from './about'

describe('about', () => {
  test('calls a release stable', () => {
    const said = about({
      version: '0.13.1',
      stamp: '0.13.1 1dc30146 2026-10-13T12:00Z',
      engine: 'Chromium',
      os: 'windows',
    })
    expect(said.kind).toBe('stable')
    expect(said.copied).toBe('0.13.1 1dc30146 · Chromium · Windows')
  })

  test('reads the run number off a build of main', () => {
    const said = about({ version: '0.13.2-57', stamp: '0.13.2-57 abc1234 x', engine: '', os: '' })
    expect(said.kind).toEqual({ edge: 57 })
    expect(said.copied).toBe('0.13.2-57 abc1234')
  })

  test('leaves out a dev server’s words, which name no commit', () => {
    const said = about({
      version: '0.13.1',
      stamp: '0.13.1 dev server started 2026-10-13T12:00Z',
      engine: '',
      os: 'linux',
    })
    expect(said.copied).toBe('0.13.1 · Linux')
  })
})
