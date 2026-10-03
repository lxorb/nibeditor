import { describe, expect, test } from 'vitest'
import { writeShortcut } from '../web-tab/shortcut'
import { judge } from './kinds'

/** A web note under v2 settles the way v1's does since 2026-10-03: the newer copy
 *  stands and nothing is kept beside it (web-tab/settle.ts). */
describe('a web note changed on two devices', () => {
  const when = new Date('2026-10-01T10:00:00Z')
  const base = writeShortcut(
    'https://docs.example.com/a',
    'Docs',
    when,
    'https://docs.example.com/',
  )
  const here = writeShortcut(
    'https://docs.example.com/b',
    'Docs B',
    when,
    'https://docs.example.com/',
  )
  const there = writeShortcut(
    'https://docs.example.com/c',
    'Docs C',
    when,
    'https://docs.example.com/',
  )

  test('the newer copy stands and nothing is lost to a version', () => {
    const newerThere = judge('link', base, here, there, { local: 1, remote: 2 })
    expect(newerThere.verdict).toBe('minor')
    expect(newerThere.resolution).toContain('docs.example.com/c')
    expect(newerThere.lost).toEqual({ local: false, remote: false })

    const newerHere = judge('link', base, here, there, { local: 3, remote: 2 })
    expect(newerHere.resolution).toContain('docs.example.com/b')
  })

  test('one side unchanged is the other side, asked nothing', () => {
    expect(judge('link', base, base, there, { local: 1, remote: 2 })).toMatchObject({
      verdict: 'clean',
      resolution: there,
    })
  })
})
