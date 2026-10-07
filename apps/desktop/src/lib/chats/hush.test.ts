/** What pings for every chat: kept from what the reader typed, handed to the account,
 *  and taken from it only where it reads. */

import { describe, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('../account.svelte', () => ({ account: { accountToken: 'token' } }))
vi.mock('../api', () => ({
  api: {
    saveSettings: (_token: string, patch: Record<string, unknown>) => {
      saved.push(patch)
      return Promise.resolve({ settings: {} })
    },
  },
}))

const { hush, WEEKDAYS } = await import('./hush.svelte')

describe('hush', () => {
  it('reads keywords off a line, each once, and tells the account', () => {
    hush.setKeywords(' thesis, final draft,, thesis ,')
    expect(hush.keywords).toEqual(['thesis', 'final draft'])
    expect(saved.at(-1)).toEqual({ chatKeywords: ['thesis', 'final draft'] })

    // The same words again say nothing new.
    const before = saved.length
    hush.setKeywords('thesis, final draft')
    expect(saved).toHaveLength(before)
  })

  it('keeps hours that read, and null for every hour', () => {
    hush.setHours({ days: WEEKDAYS, from: 540, to: 1080 })
    expect(saved.at(-1)).toEqual({ chatHours: { days: WEEKDAYS, from: 540, to: 1080 } })
    hush.setHours({ days: [9], from: 0, to: 0 })
    expect(hush.hours).toEqual({ days: WEEKDAYS, from: 540, to: 1080 })
    hush.setHours(null)
    expect(hush.hours).toBeNull()
  })

  it('takes over what the account holds, and only what reads', () => {
    hush.receive({
      chatKeywords: ['deadline'],
      chatHours: { days: [0, 6], from: 600, to: 1200 },
      chatPreviews: false,
      chatSound: true,
    })
    expect([hush.keywords, hush.hours, hush.previews, hush.sound]).toEqual([
      ['deadline'],
      { days: [0, 6], from: 600, to: 1200 },
      false,
      true,
    ])

    hush.receive({})
    expect(hush.keywords).toEqual(['deadline'])
    hush.receive({ chatHours: null })
    expect(hush.hours).toBeNull()
  })
})
