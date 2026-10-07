import type { Message, Who } from '@nib/chats'
import { describe, expect, test } from 'vitest'
import { type Item, rowsOf, type Rowing } from './rows'

const EMIL: Who = 'user:emil'
const LUCILE: Who = 'user:lucile'
const MIA: Who = 'user:mia'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const START = Date.UTC(2026, 9, 2, 9, 0)

function message(seq: number, author: Who, minutes: number, more: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    seq,
    at: START + minutes * MINUTE,
    author,
    body: `words ${seq}`,
    alsoToChat: false,
    files: [],
    mentions: [],
    reactions: {},
    pinned: false,
    history: [],
    deleted: false,
    replies: 0,
    ...more,
  }
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)

function rows(messages: Message[], more: Partial<Rowing> = {}): Item[] {
  return rowsOf({
    messages,
    outbox: [],
    me: EMIL,
    readAtOpen: null,
    dayOf,
    reads: new Map(),
    ...more,
  })
}

/** The rows as short words: a day, the line, a head with its author, or a follower. */
function said(items: Item[]): string[] {
  return items.map((item) => {
    if (item.kind === 'day') return `day ${item.day}`
    if (item.kind === 'new') return 'new'
    const what = item.head ? `head ${item.message.author.slice(5)}` : 'more'
    return `${what} ${item.message.id}${item.pending ? ' pending' : ''}${
      item.seen.length ? ` seen ${item.seen.map((who) => who.slice(5)).join(',')}` : ''
    }`
  })
}

describe('rows', () => {
  test('one person within five minutes is one group, under the day it is on', () => {
    expect(
      said(
        rows([
          message(1, EMIL, 0),
          message(2, EMIL, 2),
          message(3, EMIL, 8),
          message(4, LUCILE, 9),
          message(5, LUCILE, 10),
        ]),
      ),
    ).toEqual([
      'day 2026-10-02',
      'head emil m1',
      'more m2',
      'head emil m3',
      'head lucile m4',
      'more m5',
    ])
  })

  test('a new day starts a group, and says the day', () => {
    expect(said(rows([message(1, EMIL, 0), message(2, EMIL, DAY / MINUTE)]))).toEqual([
      'day 2026-10-02',
      'head emil m1',
      'day 2026-10-03',
      'head emil m2',
    ])
  })

  test('the New line sits above the first unread message somebody else wrote', () => {
    const list = [message(1, LUCILE, 0), message(2, EMIL, 1), message(3, LUCILE, 2)]
    expect(said(rows(list, { readAtOpen: 1 }))).toEqual([
      'day 2026-10-02',
      'head lucile m1',
      'head emil m2',
      'new',
      'head lucile m3',
    ])
    expect(said(rows(list, { readAtOpen: 3 }))).not.toContain('new')
  })

  test('a deleted message goes, unless replies hang from it', () => {
    const list = [
      message(1, EMIL, 0),
      message(2, EMIL, 1, { deleted: true }),
      message(3, EMIL, 2, { deleted: true, replies: 2 }),
      message(4, EMIL, 3),
    ]
    expect(said(rows(list))).toEqual([
      'day 2026-10-02',
      'head emil m1',
      'head emil m3',
      'head emil m4',
    ])
  })

  test('an agent writing for a person starts a group of its own', () => {
    const list = [message(1, EMIL, 0), message(2, EMIL, 1, { via: { agent: 'Claude Code' } })]
    expect(said(rows(list))).toEqual(['day 2026-10-02', 'head emil m1', 'head emil m2'])
  })

  test('posts in the outbox come last and group with the reader’s own', () => {
    const list = [message(1, EMIL, 0)]
    const outbox = [message(0, EMIL, 1, { id: 'out1' })]
    expect(said(rows(list, { outbox, readAtOpen: 0 }))).toEqual([
      'day 2026-10-02',
      'head emil m1',
      'more out1 pending',
    ])
  })

  test('receipts sit under the newest message each person has read', () => {
    const list = [message(1, EMIL, 0), message(2, LUCILE, 1), message(4, EMIL, 2)]
    const reads = new Map<Who, number>([
      [LUCILE, 3],
      [MIA, 4],
      [EMIL, 4],
    ])
    expect(said(rows(list, { reads }))).toEqual([
      'day 2026-10-02',
      'head emil m1',
      'head lucile m2 seen lucile',
      'head emil m4 seen mia',
    ])
  })

  test('nobody who read to before the first message drawn is drawn', () => {
    const reads = new Map<Who, number>([[LUCILE, 3]])
    expect(said(rows([message(5, EMIL, 0)], { reads }))).toEqual(['day 2026-10-02', 'head emil m5'])
  })
})
