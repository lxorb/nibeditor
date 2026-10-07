import type { Message, Who } from '@nib/chats'
import { describe, expect, it } from 'vitest'
import type { Notice } from '../notify'
import { type Chosen, ChatNotices, lineOf, type NoticeWorld, type Told } from './notify'

const ME: Who = 'user:me'
const LUCILE: Who = 'user:lucile'
const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'

/** Tuesday 7 October 2026, 14:00 here. */
const NOW = new Date(2026, 9, 6, 14, 0).getTime()

function message(seq: number, change: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    seq,
    at: NOW,
    author: LUCILE,
    body: `message ${seq}`,
    alsoToChat: false,
    files: [],
    mentions: [],
    reactions: {},
    pinned: false,
    history: [],
    deleted: false,
    replies: 0,
    ...change,
  }
}

/** A world of one chat of three with nothing chosen, and a log of `log`. */
function world(log: Message[], change: Partial<Told> = {}, chosen: Partial<Chosen> = {}) {
  const shown: Notice[] = []
  const unshown: string[] = []
  const opened: string[] = []
  const replies: { body: string; parent?: string }[] = []
  const reads: number[] = []
  const asked: number[] = []
  let seen = false

  const made: NoticeWorld = {
    me: () => ME,
    chat: () =>
      Promise.resolve({
        place: '#thesis',
        members: 3,
        notify: null,
        mutedUntil: null,
        readSeq: 0,
        ...change,
      }),
    after: (_chat, seq) => {
      asked.push(seq)
      return Promise.resolve(log.filter((one) => one.seq > seq))
    },
    authorOf: (_chat, id) => Promise.resolve(log.find((one) => one.id === id)?.author ?? null),
    nameOf: (_chat, who) => Promise.resolve(who === LUCILE ? 'Lucile' : 'Mia'),
    chosen: () => ({
      keywords: [],
      hours: null,
      dndUntil: null,
      previews: true,
      sound: false,
      ...chosen,
    }),
    active: () => true,
    seen: () => seen,
    now: () => NOW,
    show: (notice) => shown.push(notice),
    unshow: (tag) => unshown.push(tag),
    open: (_chat, id) => opened.push(id),
    reply: (_chat, body, parent) => {
      replies.push(parent ? { body, parent } : { body })
      return Promise.resolve()
    },
    read: (_chat, seq) => reads.push(seq),
  }
  const notices = new ChatNotices(made, () => ({
    hidden: 'New message',
    reply: 'Reply',
    send: 'Send',
  }))
  return {
    notices,
    shown,
    unshown,
    opened,
    replies,
    reads,
    asked,
    look: (on: boolean) => (seen = on),
  }
}

const poke = (seq: number, by: Who = LUCILE) => ({
  t: 'chat' as const,
  chat: CHAT,
  seq,
  at: NOW,
  by,
  mention: false,
})

/** Every turn the notices have queued, run out. */
const settled = () => new Promise((done) => setTimeout(done, 0))

describe('ChatNotices', () => {
  it('tells the newest message a poke says arrived, by name, in its chat', async () => {
    const one = world([message(1), message(2, { body: '**Draft** of [chapter 3](x) is up' })])
    one.notices.heard(poke(2))
    await settled()

    expect(one.asked).toEqual([0])
    expect(one.shown).toHaveLength(1)
    expect(one.shown[0]).toMatchObject({
      title: 'Lucile',
      body: 'Draft of chapter 3 is up',
      tag: CHAT,
      from: '#thesis',
      silent: true,
    })
  })

  it('asks from the read place and never tells a message twice', async () => {
    const one = world([message(4), message(5)], { readSeq: 4 })
    one.notices.heard(poke(5))
    one.notices.heard(poke(5))
    await settled()
    expect(one.asked).toEqual([4])
    expect(one.shown).toHaveLength(1)
    expect(one.shown[0]?.body).toBe('message 5')
  })

  it('tells nothing for your own message from another device, nor what came before it', async () => {
    const one = world([message(1), message(2, { author: ME })])
    one.notices.heard(poke(2, ME))
    await settled()
    one.notices.heard(poke(2))
    await settled()
    expect(one.shown).toHaveLength(0)
  })

  it('tells nothing for a chat in front of the reader', async () => {
    const one = world([message(1)])
    one.look(true)
    one.notices.heard(poke(1))
    await settled()
    expect(one.shown).toHaveLength(0)
  })

  it('in a chat set to mentions, tells an older message that called the reader', async () => {
    const one = world([message(1, { mentions: [ME], body: '@me look' }), message(2)], {
      notify: 'mentions',
    })
    one.notices.heard(poke(2))
    await settled()
    expect(one.shown.map((notice) => notice.body)).toEqual(['@me look'])
  })

  it('counts a reply to the reader as calling them', async () => {
    const one = world([message(1, { author: ME }), message(2, { parent: 'm1', body: 'agreed' })], {
      notify: 'mentions',
      readSeq: 1,
    })
    one.notices.heard(poke(2))
    await settled()
    expect(one.shown.map((notice) => notice.body)).toEqual(['agreed'])
  })

  it('holds back what a mute, Do not disturb and the hours say', async () => {
    const muted = world([message(1)], { mutedUntil: NOW + 1000 })
    const dnd = world([message(1)], {}, { dndUntil: NOW + 1000 })
    const hours = world([message(1)], {}, { hours: { days: [1, 2, 3, 4, 5], from: 540, to: 600 } })
    for (const one of [muted, dnd, hours]) one.notices.heard(poke(1))
    await settled()
    expect([muted, dnd, hours].map((one) => one.shown.length)).toEqual([0, 0, 0])
  })

  it('says only that something came when previews are off', async () => {
    const one = world([message(1)], {}, { previews: false, sound: true })
    one.notices.heard(poke(1))
    await settled()
    expect(one.shown[0]).toMatchObject({ title: 'New message', body: '', from: '', silent: false })
  })

  it('opens the message on a press', async () => {
    const one = world([message(1)])
    one.notices.heard(poke(1))
    await settled()
    one.shown[0]?.opened?.()
    expect(one.opened).toEqual(['m1'])
  })

  it('answers in the same place, marks the chat read and takes the notification back', async () => {
    const one = world([message(1, { parent: 'm0' })])
    one.notices.heard(poke(1))
    await settled()
    one.shown[0]?.reply?.replied(' on it ')
    await settled()
    expect(one.replies).toEqual([{ body: 'on it', parent: 'm0' }])
    expect(one.reads).toEqual([1])
    expect(one.unshown).toEqual([CHAT])
  })

  it('takes a notification back once the chat is read past it, and only then', async () => {
    const one = world([message(1), message(2)])
    one.notices.heard(poke(2))
    await settled()
    one.notices.read(CHAT, 1)
    expect(one.unshown).toEqual([])
    one.notices.read(CHAT, 2)
    expect(one.unshown).toEqual([CHAT])
    one.notices.heard(poke(2))
    await settled()
    expect(one.shown).toHaveLength(1)
  })

  it('tells what an open chat placed, skipping what was deleted', async () => {
    const one = world([])
    one.notices.arrived(CHAT, [message(3), message(4, { deleted: true })])
    await settled()
    expect(one.shown.map((notice) => notice.body)).toEqual(['message 3'])
  })
})

describe('lineOf', () => {
  it('is the first line a reader would read', () => {
    expect(lineOf(message(1, { body: '\n# Plan\nsecond' }))).toBe('Plan')
    expect(lineOf(message(1, { body: '> quoted ~~old~~ `code` ||secret||' }))).toBe(
      'quoted old code secret',
    )
    expect(lineOf(message(1, { body: '- [x] task' }))).toBe('[x] task')
    expect(lineOf(message(1, { body: 'x'.repeat(300) }))).toHaveLength(200)
  })

  it('is the poll or the file where there are no words', () => {
    const poll = { question: 'Lunch?', answers: ['a', 'b'], several: false, votes: {} }
    expect(lineOf(message(1, { body: '', poll }))).toBe('Lunch?')
    const file = { hash: 'h', name: 'figure.png', size: 1, type: 'image/png' }
    expect(lineOf(message(1, { body: '', files: [file] }))).toBe('figure.png')
  })
})
