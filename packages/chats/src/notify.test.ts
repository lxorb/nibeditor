import { describe, expect, it } from 'vitest'
import {
  type Asked,
  callOf,
  decide,
  type Hours,
  inHours,
  isHours,
  isKeywords,
  keywordIn,
  levelOf,
  MUTED_FOR_GOOD,
  owesPush,
  type Ping,
} from './notify'
import type { Mention, Notify } from './types'

const ME = 'user:me'
const LUCILE = 'user:lucile'
const NOW = 1_790_000_000_000

/** Tuesday 14:00 on the reader's calendar. */
const TUESDAY_TWO = { now: NOW, day: 2, minute: 14 * 60 }

/** A message from Lucile with nothing in it for anybody, in a chat of three where the
 *  reader chose nothing, seen by nobody, on a Tuesday afternoon. */
function asked(change: {
  author?: Asked['message']['author']
  body?: string
  mentions?: Mention[]
  repliesTo?: Asked['message']['author']
  notify?: Notify | null
  mutedUntil?: number | null
  members?: number
  keywords?: string[]
  hours?: Hours | null
  pausedUntil?: number | null
  moment?: Asked['moment']
  active?: boolean
  seen?: boolean
}): Asked {
  return {
    me: ME,
    message: {
      author: change.author ?? LUCILE,
      body: change.body ?? 'The figures are in',
      mentions: change.mentions ?? [],
      repliesTo: change.repliesTo ?? null,
    },
    chat: {
      notify: change.notify ?? null,
      mutedUntil: change.mutedUntil ?? null,
      members: change.members ?? 3,
    },
    hush: {
      keywords: change.keywords ?? [],
      hours: change.hours ?? null,
      pausedUntil: change.pausedUntil ?? null,
    },
    moment: change.moment ?? TUESDAY_TWO,
    active: change.active ?? true,
    seen: change.seen ?? false,
  }
}

const WORKING: Hours = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 18 * 60 }

describe('decide', () => {
  // Every row of the table: the level, mute, the pause, the hours and focus, each
  // against a message that calls for the reader and one that does not.
  it.each<[string, Parameters<typeof asked>[0], Ping]>([
    ['a message in a small chat', {}, 'show'],
    ['your own message', { author: ME }, 'own'],
    ['your own message, even naming you', { author: ME, mentions: [ME] }, 'own'],
    ['a chat on screen in front of you', { seen: true }, 'seen'],
    ['a chat on screen, naming you', { seen: true, mentions: [ME] }, 'seen'],
    ['a muted chat', { mutedUntil: NOW + 60_000 }, 'muted'],
    ['a muted chat, naming you', { mutedUntil: NOW + 60_000, mentions: [ME] }, 'muted'],
    ['a chat muted for good', { mutedUntil: MUTED_FOR_GOOD }, 'muted'],
    ['a mute that has run out', { mutedUntil: NOW - 1 }, 'show'],
    ['a mute ending now', { mutedUntil: NOW }, 'show'],
    ['level nothing', { notify: 'nothing' }, 'level'],
    ['level nothing, naming you', { notify: 'nothing', mentions: [ME] }, 'level'],
    ['level mentions, nothing for you', { notify: 'mentions' }, 'level'],
    ['level mentions, naming you', { notify: 'mentions', mentions: [ME] }, 'show'],
    ['level mentions, @everyone', { notify: 'mentions', mentions: ['everyone'] }, 'show'],
    ['level mentions, @here while active', { notify: 'mentions', mentions: ['here'] }, 'show'],
    [
      'level mentions, @here while away',
      { notify: 'mentions', mentions: ['here'], active: false },
      'level',
    ],
    ['level mentions, a reply to you', { notify: 'mentions', repliesTo: ME }, 'show'],
    [
      'level mentions, a reply to somebody else',
      { notify: 'mentions', repliesTo: LUCILE },
      'level',
    ],
    ['level mentions, a keyword', { notify: 'mentions', keywords: ['figures'] }, 'show'],
    ['level all, naming nobody', { notify: 'all' }, 'show'],
    ['a big chat by default, nothing for you', { members: 11 }, 'level'],
    ['a big chat by default, naming you', { members: 11, mentions: [ME] }, 'show'],
    ['a chat of ten by default', { members: 10 }, 'show'],
    ['a big chat set to all', { members: 200, notify: 'all' }, 'show'],
    ['paused', { pausedUntil: NOW + 60_000 }, 'paused'],
    ['paused, naming you', { pausedUntil: NOW + 60_000, mentions: [ME] }, 'paused'],
    ['a pause that has run out', { pausedUntil: NOW - 1 }, 'show'],
    [
      'paused, but the level says nothing anyway',
      { pausedUntil: NOW + 1, notify: 'nothing' },
      'level',
    ],
    ['inside the hours', { hours: WORKING }, 'show'],
    [
      'outside the hours',
      { hours: WORKING, moment: { now: NOW, day: 2, minute: 20 * 60 } },
      'quiet',
    ],
    [
      'outside the hours, naming you',
      { hours: WORKING, mentions: [ME], moment: { now: NOW, day: 0, minute: 10 * 60 } },
      'quiet',
    ],
    [
      'muted outweighs quiet',
      { hours: WORKING, mutedUntil: NOW + 1, moment: { now: NOW, day: 0, minute: 0 } },
      'muted',
    ],
  ])('%s', (_name, change, ping) => {
    expect(decide(asked(change))).toBe(ping)
  })
})

describe('levelOf', () => {
  it('defaults by the chat size and keeps a choice', () => {
    expect(levelOf(null, 1)).toBe('all')
    expect(levelOf(null, 10)).toBe('all')
    expect(levelOf(null, 11)).toBe('mentions')
    expect(levelOf('nothing', 2)).toBe('nothing')
    expect(levelOf('all', 200)).toBe('all')
  })
})

describe('callOf', () => {
  const heard = (mentions: Mention[], body = 'hi', repliesTo: string | null = null) => ({
    author: LUCILE as 'user:lucile',
    body,
    mentions,
    repliesTo: repliesTo as 'user:me' | null,
  })

  it('names the strongest reason first', () => {
    expect(callOf(heard([ME, 'everyone']), ME, true, [])).toBe('name')
    expect(callOf(heard(['everyone', 'here']), ME, true, [])).toBe('everyone')
    expect(callOf(heard(['here']), ME, true, [])).toBe('here')
    expect(callOf(heard(['here']), ME, false, [])).toBeNull()
    expect(callOf(heard([], 'hi', ME), ME, true, [])).toBe('reply')
    expect(callOf(heard([], 'the thesis'), ME, true, ['Thesis'])).toBe('keyword')
    expect(callOf(heard(['user:mia']), ME, true, [])).toBeNull()
  })
})

describe('keywordIn', () => {
  it('finds whole words in any case, phrases too', () => {
    expect(keywordIn('Is the Deadline moved?', ['deadline'])).toBe('deadline')
    expect(keywordIn('nib, again', ['nib'])).toBe('nib')
    expect(keywordIn('a nibble', ['nib'])).toBeNull()
    expect(keywordIn('see the final draft today', ['final draft'])).toBe('final draft')
    expect(keywordIn('Grüße aus Zürich', ['zürich'])).toBe('zürich')
    expect(keywordIn('c++ or rust', ['c++'])).toBe('c++')
    expect(keywordIn('anything', ['', '  '])).toBeNull()
  })
})

describe('inHours', () => {
  const at = (day: number, hour: number) => ({ now: NOW, day, minute: hour * 60 })

  it('lets pings through on the listed days between the two times', () => {
    expect(inHours(null, at(0, 3))).toBe(true)
    expect(inHours(WORKING, at(1, 9))).toBe(true)
    expect(inHours(WORKING, at(1, 8))).toBe(false)
    expect(inHours(WORKING, at(5, 18))).toBe(false)
    expect(inHours(WORKING, at(6, 12))).toBe(false)
  })

  it('carries a window past midnight into the next day', () => {
    const nights: Hours = { days: [5], from: 22 * 60, to: 2 * 60 }
    expect(inHours(nights, at(5, 23))).toBe(true)
    expect(inHours(nights, at(6, 1))).toBe(true)
    expect(inHours(nights, at(6, 2))).toBe(false)
    expect(inHours(nights, at(5, 1))).toBe(false)
    const sunday: Hours = { days: [6], from: 22 * 60, to: 60 }
    expect(inHours(sunday, at(0, 0))).toBe(true)
  })

  it('reads a window that ends where it starts as the whole day', () => {
    const weekends: Hours = { days: [0, 6], from: 0, to: 0 }
    expect(inHours(weekends, at(6, 13))).toBe(true)
    expect(inHours(weekends, at(1, 13))).toBe(false)
  })
})

describe('owesPush', () => {
  it('pushes only what pings and only where no desktop was active', () => {
    expect(owesPush('show', false)).toBe(true)
    expect(owesPush('show', true)).toBe(false)
    expect(owesPush('quiet', false)).toBe(false)
  })
})

describe('checks', () => {
  it('keeps keyword lists of words', () => {
    expect(isKeywords(['thesis', 'final draft'])).toBe(true)
    expect(isKeywords([])).toBe(true)
    expect(isKeywords([''])).toBe(false)
    expect(isKeywords(['x'.repeat(61)])).toBe(false)
    expect(isKeywords(Array.from({ length: 51 }, (_, at) => `w${at}`))).toBe(false)
    expect(isKeywords('thesis')).toBe(false)
  })

  it('keeps hours inside a day and days of the week', () => {
    expect(isHours(WORKING)).toBe(true)
    expect(isHours({ days: [], from: 0, to: 0 })).toBe(true)
    expect(isHours({ days: [7], from: 0, to: 60 })).toBe(false)
    expect(isHours({ days: [1, 1], from: 0, to: 60 })).toBe(false)
    expect(isHours({ days: [1], from: 0, to: 1440 })).toBe(false)
    expect(isHours({ days: [1], from: 0.5, to: 60 })).toBe(false)
    expect(isHours(null)).toBe(false)
  })
})
