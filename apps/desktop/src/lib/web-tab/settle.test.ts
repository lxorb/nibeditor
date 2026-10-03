import { describe, expect, test } from 'vitest'
import { sameSite, sameWebNote, settleShortcuts } from './settle'
import { readShortcut } from './shortcut'

/** Two copies of one web note made into one: the newer stands, and what only the
 *  older said comes across. See settle.ts. */

const PATH = '/Notes/Docs.url'
const file = (rows: string[]) => `[InternetShortcut]\r\n${rows.join('\r\n')}\r\n`

const OLDER = file([
  'URL=https://docs.dev/a',
  'Title=Docs',
  'Nib-Added=2026-09-01T00:00:00.000Z',
  'Nib-Home=https://docs.dev/',
  'Nib-Icon=data:older',
])
const NEWER = file([
  'URL=https://docs.dev/b',
  'Title=Docs, renamed',
  'Nib-Added=2026-09-05T00:00:00.000Z',
  'Nib-Home=https://docs.dev/',
])

describe('two copies of a web note', () => {
  test('come to the newer one, with the mark and the first day only the older said', () => {
    const one = readShortcut(settleShortcuts(PATH, OLDER, NEWER, true))

    expect(one).toEqual({
      url: 'https://docs.dev/b',
      title: 'Docs, renamed',
      added: '2026-09-01T00:00:00.000Z',
      home: 'https://docs.dev/',
      icon: 'data:older',
    })
  })

  test('come to the same file whichever side is ours', () => {
    expect(settleShortcuts(PATH, OLDER, NEWER, true)).toBe(
      settleShortcuts(PATH, NEWER, OLDER, false),
    )
  })

  test('leave the newer file exactly as written when the older adds nothing', () => {
    const newer = file([
      'URL=https://docs.dev/b',
      'Title=Docs',
      'Nib-Added=2026-09-01T00:00:00.000Z',
    ])
    const older = file([
      'URL=https://docs.dev/a',
      'Title=Docs',
      'Nib-Added=2026-09-02T00:00:00.000Z',
    ])

    expect(settleShortcuts(PATH, older, newer, true)).toBe(newer)
  })

  test('let the newer stand whole where the other is not a shortcut', () => {
    expect(settleShortcuts(PATH, 'broken by hand', NEWER, true)).toBe(NEWER)
    expect(settleShortcuts(PATH, 'broken by hand', NEWER, false)).toBe('broken by hand')
  })

  test('are one note when they point at the same place, wherever the reading is', () => {
    expect(sameWebNote(PATH, OLDER, NEWER)).toBe(true)
    expect(sameWebNote(PATH, OLDER, file(['URL=https://other.dev/']))).toBe(false)
  })
})

describe('one site', () => {
  test('is the host, www aside, and never something that is not the web', () => {
    expect(sameSite('https://www.docs.dev/a', 'http://docs.dev/b?q=1')).toBe(true)
    expect(sameSite('https://docs.dev/', 'https://api.docs.dev/')).toBe(false)
    expect(sameSite('file:///C:/a', 'file:///C:/a')).toBe(false)
    expect(sameSite(null, 'https://docs.dev/')).toBe(false)
  })
})
