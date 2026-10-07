import { describe, expect, it } from 'vitest'
import { hasModifiers, hasOf, type Hit, matches, parseSearch, type SearchQuery } from './search'
import type { Message, Who } from './types'

const TODAY = '2026-10-07'

/** A query with nothing in it but what a test names. */
function query(fields: Partial<SearchQuery>): SearchQuery {
  return {
    words: [],
    phrases: [],
    without: [],
    from: [],
    in: [],
    has: [],
    isReply: false,
    mentions: [],
    ...fields,
  }
}

describe('parseSearch', () => {
  it('reads words, phrases and words left out', () => {
    expect(parseSearch('figures "page 4" -draft -"old copy"', TODAY)).toEqual(
      query({ words: ['figures'], phrases: ['page 4'], without: ['draft', 'old copy'] }),
    )
  })

  it.each([
    ['from:@Lucile', { from: ['Lucile'] }],
    ['from:me', { from: ['me'] }],
    ['from:"@Lucile Martin"', { from: ['Lucile Martin'] }],
    ['in:#thesis', { in: ['thesis'] }],
    ['in:"#the defence"', { in: ['the defence'] }],
    ['mentions:me', { mentions: ['me'] }],
    ['mentions:@Mia', { mentions: ['Mia'] }],
    ['is:reply', { isReply: true }],
    ['IS:Reply', { isReply: true }],
  ] as [string, Partial<SearchQuery>][])('reads %s', (text, fields) => {
    expect(parseSearch(text, TODAY)).toEqual(query(fields))
  })

  it('reads every has:, once each', () => {
    const text =
      'has:link has:file has:image has:video has:voice has:poll has:pin has:reaction has:pin'
    expect(parseSearch(text, TODAY).has).toEqual([
      'link',
      'file',
      'image',
      'video',
      'voice',
      'poll',
      'pin',
      'reaction',
    ])
  })

  it.each([
    ['before:2026-10-01', { until: '2026-10-01' }],
    ['after:2026-10-01', { since: '2026-10-02' }],
    ['on:2026-02-28', { since: '2026-02-28', until: '2026-03-01' }],
    ['on:today', { since: '2026-10-07', until: '2026-10-08' }],
    ['on:yesterday', { since: '2026-10-06', until: '2026-10-07' }],
    ['during:2026-12', { since: '2026-12-01', until: '2027-01-01' }],
    ['during:2025', { since: '2025-01-01', until: '2026-01-01' }],
    ['during:october', { since: '2026-10-01', until: '2026-11-01' }],
    ['during:sep', { since: '2026-09-01', until: '2026-10-01' }],
    ['during:November', { since: '2025-11-01', until: '2025-12-01' }],
    ['during:2026-10-03', { since: '2026-10-03', until: '2026-10-04' }],
    [
      'after:2026-09-01 before:2026-09-10 during:2026-09',
      { since: '2026-09-02', until: '2026-09-10' },
    ],
  ] as [string, Partial<SearchQuery>][])('reads the days of %s', (text, fields) => {
    expect(parseSearch(text, TODAY)).toEqual(query(fields))
  })

  it('crosses a year going back from the first of January', () => {
    expect(parseSearch('on:yesterday', '2027-01-01')).toEqual(
      query({ since: '2026-12-31', until: '2027-01-01' }),
    )
  })

  it.each([
    ['has:everything', ['has:everything']],
    ['is:pinned', ['is:pinned']],
    ['on:2026-02-30', ['on:2026-02-30']],
    ['during:2026-13', ['during:2026-13']],
    ['during:ma', ['during:ma']],
    ['before:soon', ['before:soon']],
    ['from:', ['from:']],
    ['from:@', ['from:@']],
    ['colour:red', ['colour:red']],
    ['http://example.com', ['http://example.com']],
  ])('searches for %s as a word, as it cannot read it', (text, words) => {
    expect(parseSearch(text, TODAY)).toEqual(query({ words }))
  })

  it('keeps an unknown quoted modifier as a phrase', () => {
    expect(parseSearch('colour:"dark red"', TODAY)).toEqual(query({ phrases: ['colour:dark red'] }))
  })

  it('runs an unclosed quote to the end, and asks nothing of a dash alone', () => {
    expect(parseSearch('"page 4 - ', TODAY)).toEqual(query({ phrases: ['page 4 -'] }))
    expect(parseSearch('- ""', TODAY)).toEqual(query({}))
  })

  it('says when a query asks more than words', () => {
    expect(hasModifiers(parseSearch('just words', TODAY))).toBe(false)
    expect(hasModifiers(parseSearch('words is:reply', TODAY))).toBe(true)
    expect(hasModifiers(parseSearch('before:2026-01-01', TODAY))).toBe(true)
  })
})

// ---------------------------------------------------------------------------

const EMIL: Who = 'user:emil'
const LUCILE: Who = 'user:lucile'

function messageOf(fields: Partial<Message>): Message {
  return {
    id: 'm1',
    seq: 1,
    at: Date.UTC(2026, 9, 2, 16, 40),
    author: LUCILE,
    body: '',
    alsoToChat: false,
    files: [],
    mentions: [],
    reactions: {},
    pinned: false,
    history: [],
    deleted: false,
    replies: 0,
    ...fields,
  }
}

const NAMES: Record<Who, string[]> = { [EMIL]: ['Emil'], [LUCILE]: ['Lucile Martin', 'Lu'] }

function hit(message: Message): Hit {
  return {
    message,
    chat: 'thesis',
    me: EMIL,
    namesOf: (who) => NAMES[who] ?? [],
    dayOf: (at) => new Date(at).toISOString().slice(0, 10),
  }
}

function found(text: string, message: Message): boolean {
  return matches(parseSearch(text, TODAY), hit(message))
}

describe('hasOf', () => {
  const file = (type: string) => ({ hash: 'a'.repeat(64), name: 'x', size: 1, type })

  it('reads what a message has', () => {
    expect(hasOf(messageOf({ body: 'see https://example.com' }))).toEqual(['link'])
    expect(hasOf(messageOf({ preview: { url: 'https://a.ch', title: 'A' } }))).toEqual(['link'])
    expect(hasOf(messageOf({ files: [file('image/webp'), file('audio/ogg')] }))).toEqual([
      'file',
      'image',
      'voice',
    ])
    expect(hasOf(messageOf({ files: [file('video/mp4')] }))).toEqual(['file', 'video'])
    expect(
      hasOf(messageOf({ poll: { question: 'q', answers: ['a', 'b'], several: false, votes: {} } })),
    ).toEqual(['poll'])
    expect(hasOf(messageOf({ pinned: true, reactions: { '👍': [EMIL] } }))).toEqual([
      'pin',
      'reaction',
    ])
  })

  it('reads nothing on a deleted message', () => {
    expect(hasOf(messageOf({ deleted: true, pinned: true }))).toEqual([])
  })
})

describe('matches', () => {
  const draft = messageOf({ body: 'The figures on page 4 look off, café later?' })

  it('finds words as the start of words, without case or accents', () => {
    expect(found('figure', draft)).toBe(true)
    expect(found('FIGURES cafe', draft)).toBe(true)
    expect(found('igures', draft)).toBe(false)
  })

  it('finds a phrase only as written', () => {
    expect(found('"page 4"', draft)).toBe(true)
    expect(found('"4 page"', draft)).toBe(false)
  })

  it('leaves out what it is told to', () => {
    expect(found('figures -cafe', draft)).toBe(false)
    expect(found('figures -"page 5"', draft)).toBe(true)
  })

  it('finds by author, by any name they answer to, or me', () => {
    expect(found('from:@Lu', draft)).toBe(true)
    expect(found('from:"Lucile Martin"', draft)).toBe(true)
    expect(found('from:me', draft)).toBe(false)
    expect(found('from:me', messageOf({ author: EMIL }))).toBe(true)
    expect(found('from:Emil from:Lu', draft)).toBe(true)
  })

  it('finds by chat', () => {
    expect(found('in:#Thesis', draft)).toBe(true)
    expect(found('in:#general', draft)).toBe(false)
  })

  it('finds by who was called, never by @here alone', () => {
    expect(found('mentions:me', messageOf({ mentions: [EMIL] }))).toBe(true)
    expect(found('mentions:me', messageOf({ mentions: ['here', 'everyone'] }))).toBe(false)
    expect(found('mentions:Lu', messageOf({ mentions: [LUCILE] }))).toBe(true)
  })

  it('finds by what a message has, and replies', () => {
    expect(found('has:pin', messageOf({ pinned: true }))).toBe(true)
    expect(found('has:pin has:reaction', messageOf({ pinned: true }))).toBe(false)
    expect(found('is:reply', messageOf({ parent: 'm0' }))).toBe(true)
    expect(found('is:reply', draft)).toBe(false)
  })

  it('finds by the reader’s day', () => {
    expect(found('on:2026-10-02', draft)).toBe(true)
    expect(found('before:2026-10-02', draft)).toBe(false)
    expect(found('after:2026-10-01', draft)).toBe(true)
    expect(found('during:october', draft)).toBe(true)
    expect(found('during:september', draft)).toBe(false)
  })

  it('never finds a deleted message', () => {
    expect(found('', messageOf({ deleted: true }))).toBe(false)
  })

  it('finds everything with an empty query', () => {
    expect(found('', draft)).toBe(true)
  })
})
