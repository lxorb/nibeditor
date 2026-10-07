import { describe, expect, it } from 'vitest'
import { MOST_BODY, MOST_FILES, MOST_POSTED, WAVE_BARS } from './limits'
import { apply, chatState } from './reduce'
import type { Event, FileRef, Logged, Message } from './types'
import {
  type ChatPoke,
  chatListOf,
  chatPokeOf,
  type ClientFrame,
  clientFrameOf,
  eventOf,
  eventsPageOf,
  fileRefOf,
  isWho,
  loggedOf,
  messageOf,
  newChatOf,
  postEventsOf,
  resultsOf,
  type ServerFrame,
  serverFrameOf,
  socketPath,
  statePageOf,
  text,
} from './wire'

const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'
const HASH = 'ab'.repeat(32)
const PICTURE: FileRef = {
  hash: HASH,
  name: 'figure-4.png',
  size: 48_213,
  type: 'image/png',
  width: 1200,
  height: 800,
  preview: HASH,
}
const VOICE: FileRef = {
  hash: HASH,
  name: 'voice.ogg',
  size: 9000,
  type: 'audio/ogg',
  seconds: 42,
  wave: Array.from({ length: WAVE_BARS }, (_, i) => i * 4),
}

const EVENTS: Event[] = [
  { kind: 'post', id: 'e1', message: 'm1', body: 'Draft is up' },
  {
    kind: 'post',
    id: 'e2',
    message: 'm2',
    body: 'Same, @Lucile',
    parent: 'm1',
    quote: 'm1',
    files: [PICTURE, VOICE],
    poll: { question: 'Fix it?', answers: ['yes', 'no'], several: false, ends: 99 },
    preview: {
      url: 'https://example.com/a',
      title: 'A',
      site: 'Example',
      text: 'about',
      picture: HASH,
    },
    via: { agent: 'Claude Code' },
    alsoToChat: true,
    mentions: ['user:lucile', 'here'],
  },
  { kind: 'edit', id: 'e3', target: 'm1', body: 'Draft 2 is up' },
  { kind: 'edit', id: 'e4', target: 'm1', body: '', files: [] },
  { kind: 'delete', id: 'e5', target: 'm2' },
  { kind: 'react', id: 'e6', target: 'm1', emoji: '👍🏽', on: true },
  { kind: 'react', id: 'e7', target: 'm1', emoji: ':party:', on: false },
  { kind: 'pin', id: 'e8', target: 'm1', on: true },
  { kind: 'vote', id: 'e9', target: 'm2', answers: [0] },
  { kind: 'vote', id: 'e10', target: 'm2', answers: [] },
  { kind: 'meta', id: 'e11', topic: 'Chapters', posting: 'owner', slowmode: 30 },
  { kind: 'meta', id: 'e12', topic: '' },
  {
    kind: 'schedule',
    id: 'e13',
    sendAt: 5000,
    post: { kind: 'post', id: 'e14', message: 'm3', body: 'later' },
  },
]

/** A value as it arrives from the other end: JSON there and back. */
function wired(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe('events', () => {
  it.each(EVENTS.map((event) => [event.kind, event] as const))(
    'a %s reads back as it was sent',
    (_, event) => {
      expect(eventOf(wired(event))).toEqual(event)
    },
  )

  it('drops fields it does not know', () => {
    expect(eventOf({ kind: 'delete', id: 'e', target: 'm', admin: true })).toEqual({
      kind: 'delete',
      id: 'e',
      target: 'm',
    })
    expect(fileRefOf({ ...PICTURE, exif: 'gps' })).toEqual(PICTURE)
  })

  it('names each mention once', () => {
    expect(
      eventOf({ kind: 'post', id: 'e', message: 'm', body: 'hi', mentions: ['here', 'here'] }),
    ).toMatchObject({
      mentions: ['here'],
    })
  })

  it.each([
    ['no kind', { id: 'e', target: 'm' }],
    ['a kind nobody sends', { kind: 'shout', id: 'e', target: 'm' }],
    ['an id with a space', { kind: 'delete', id: 'e 1', target: 'm' }],
    ['an id past 64', { kind: 'delete', id: 'e'.repeat(65), target: 'm' }],
    ['a post of nothing', { kind: 'post', id: 'e', message: 'm', body: '  ' }],
    [
      'words past the limit',
      { kind: 'post', id: 'e', message: 'm', body: 'x'.repeat(MOST_BODY + 1) },
    ],
    [
      'too many files',
      {
        kind: 'post',
        id: 'e',
        message: 'm',
        body: 'x',
        files: Array.from({ length: MOST_FILES + 1 }, () => PICTURE),
      },
    ],
    [
      'a file with no hash',
      { kind: 'post', id: 'e', message: 'm', body: 'x', files: [{ ...PICTURE, hash: 'nope' }] },
    ],
    [
      'a file past 2 GB',
      {
        kind: 'post',
        id: 'e',
        message: 'm',
        body: 'x',
        files: [{ ...PICTURE, size: 2 ** 31 + 1 }],
      },
    ],
    [
      'a wave of the wrong length',
      { kind: 'post', id: 'e', message: 'm', body: 'x', files: [{ ...VOICE, wave: [1, 2] }] },
    ],
    [
      'a bar past 255',
      {
        kind: 'post',
        id: 'e',
        message: 'm',
        body: 'x',
        files: [{ ...VOICE, wave: VOICE.wave?.map(() => 256) }],
      },
    ],
    [
      'a poll of one answer',
      {
        kind: 'post',
        id: 'e',
        message: 'm',
        body: '',
        poll: { question: 'q', answers: ['a'], several: false },
      },
    ],
    [
      'a preview of a file address',
      {
        kind: 'post',
        id: 'e',
        message: 'm',
        body: 'x',
        preview: { url: 'file:///etc/passwd', title: 'x' },
      },
    ],
    [
      'also to the chat without a parent',
      { kind: 'post', id: 'e', message: 'm', body: 'x', alsoToChat: true },
    ],
    [
      'a mention of a name',
      { kind: 'post', id: 'e', message: 'm', body: 'x', mentions: ['Lucile'] },
    ],
    ['a reaction of nothing', { kind: 'react', id: 'e', target: 'm', emoji: ' ', on: true }],
    ['a reaction with a space', { kind: 'react', id: 'e', target: 'm', emoji: '👍 👍', on: true }],
    ['a pin with no answer', { kind: 'pin', id: 'e', target: 'm' }],
    ['a vote for answer eleven', { kind: 'vote', id: 'e', target: 'm', answers: [10] }],
    ['a vote of a fraction', { kind: 'vote', id: 'e', target: 'm', answers: [0.5] }],
    ['settings that set nothing', { kind: 'meta', id: 'e' }],
    ['a posting nobody has', { kind: 'meta', id: 'e', posting: 'guests' }],
    ['a slowmode of a week', { kind: 'meta', id: 'e', slowmode: 7 * 24 * 3600 }],
    [
      'a schedule with no time',
      { kind: 'schedule', id: 'e', post: { kind: 'post', id: 'p', message: 'm', body: 'x' } },
    ],
    [
      'a schedule of an edit',
      {
        kind: 'schedule',
        id: 'e',
        sendAt: 1,
        post: { kind: 'edit', id: 'p', target: 'm', body: 'x' },
      },
    ],
  ])('refuses %s', (_, value) => {
    expect(eventOf(value)).toBeNull()
  })
})

describe('logged events', () => {
  const placed = {
    seq: 4,
    at: 1_759_833_600_000,
    author: 'user:emil',
    device: 'd-laptop',
    madeAt: 1_759_833_500_000,
  }

  it('carry their place', () => {
    const logged = { ...EVENTS[0], ...placed }
    expect(loggedOf(wired(logged))).toEqual(logged)
  })

  it.each([
    ['no place', { seq: 0 }],
    ['no author', { author: 'emil' }],
    ['a time that is no time', { at: 'now' }],
    ['a device of nothing', { device: '' }],
  ])('refuse %s', (_, change) => {
    expect(loggedOf({ ...EVENTS[0], ...placed, ...change })).toBeNull()
  })
})

describe('messages as they stand', () => {
  it('read back as the reducer made them', () => {
    const state = chatState()
    const events: Logged[] = EVENTS.map((event, index) => ({
      ...event,
      seq: index + 1,
      at: (index + 1) * 10,
      author: 'user:emil',
    }))
    for (const event of events) apply(state, event)
    const messages = [...state.messages.values()]
    expect(messages.length).toBeGreaterThan(1)
    for (const message of messages) expect(messageOf(wired(message))).toEqual(message)
  })

  it('refuse one whose reactions name somebody who is nobody', () => {
    const message: Message = {
      id: 'm1',
      seq: 1,
      at: 1,
      author: 'user:emil',
      body: 'x',
      alsoToChat: false,
      files: [],
      mentions: [],
      reactions: { '👍': ['user:emil'] },
      pinned: false,
      history: [],
      deleted: false,
      replies: 0,
    }
    expect(messageOf(message)).toEqual(message)
    expect(messageOf({ ...message, reactions: { '👍': ['Emil'] } })).toBeNull()
    expect(
      messageOf({
        ...message,
        poll: { question: 'q', answers: ['a', 'b'], several: false, votes: { x: [0] } },
      }),
    ).toBeNull()
  })
})

describe('the socket', () => {
  it('is the chat’s own address', () => {
    expect(socketPath(CHAT)).toBe(`/v2/chats/${CHAT}/socket`)
  })

  const client: ClientFrame[] = [
    { t: 'hello' },
    { t: 'hello', since: 41 },
    { t: 'send', event: EVENTS[1] ?? { kind: 'delete', id: 'e', target: 'm' } },
    { t: 'typing' },
    { t: 'typing', parent: 'm1' },
    { t: 'read', seq: 41 },
  ]

  it.each(client.map((frame) => [frame.t, frame] as const))('carries a device’s %s', (_, frame) => {
    expect(clientFrameOf(text(frame))).toEqual(frame)
  })

  const logged: Logged = {
    kind: 'pin',
    id: 'e',
    target: 'm1',
    on: true,
    seq: 3,
    at: 30,
    author: 'guest:g1',
  }
  const server: ServerFrame[] = [
    { t: 'events', events: [logged] },
    { t: 'behind', seq: 12_000 },
    { t: 'placed', id: 'e1', seq: 7, at: 70 },
    { t: 'refused', id: 'e1', error: 'posting' },
    { t: 'refused', id: null, error: 'invalid' },
    { t: 'typing', who: 'user:lucile' },
    { t: 'typing', who: 'user:lucile', parent: 'm1' },
    { t: 'read', who: 'user:lucile', seq: 7 },
    { t: 'here', who: ['user:lucile', 'program:ci'] },
    { t: 'profile', who: 'user:lucile' },
  ]

  it.each(server.map((frame) => [frame.t, frame] as const))(
    'carries the object’s %s',
    (_, frame) => {
      expect(serverFrameOf(text(frame))).toEqual(frame)
    },
  )

  it.each([
    'not json',
    '[]',
    '{"t":"hello","since":-1}',
    '{"t":"send","event":{"kind":"post","id":"e","message":"m","body":""}}',
    '{"t":"typing","parent":7}',
    '{"t":"read"}',
    '{"t":"shout"}',
  ])('drops a device frame %s', (raw) => {
    expect(clientFrameOf(raw)).toBeNull()
  })

  it.each([
    '{"t":"events","events":[{"kind":"pin"}]}',
    '{"t":"refused","id":"e","error":"angry"}',
    '{"t":"typing","who":"lucile"}',
    '{"t":"here","who":"user:lucile"}',
    '{"t":"placed","id":"e","seq":1}',
  ])('drops an object frame %s', (raw) => {
    expect(serverFrameOf(raw)).toBeNull()
  })
})

describe('the hub', () => {
  const poke: ChatPoke = { t: 'chat', chat: CHAT, seq: 9, at: 90, by: 'user:mia', mention: true }

  it('pokes with no words', () => {
    expect(chatPokeOf(wired(poke))).toEqual(poke)
    expect(chatPokeOf({ ...poke, body: 'secret' })).toEqual(poke)
  })

  it('drops a poke that is not one', () => {
    expect(chatPokeOf({ ...poke, t: 'poke' })).toBeNull()
    expect(chatPokeOf({ ...poke, chat: 'c_1' })).toBeNull()
    expect(chatPokeOf({ ...poke, mention: 'yes' })).toBeNull()
  })
})

describe('HTTP', () => {
  const row = {
    id: CHAT,
    space: 'space-1',
    role: 'write',
    members: 4,
    lastSeq: 9,
    lastAt: 90,
    lastBy: 'user:mia',
    readSeq: 7,
    mentions: 1,
    notify: null,
    mutedUntil: null,
    meta: { topic: '', posting: 'writers', slowmode: 0 },
  }

  it('lists chats, leaving out a row that does not read', () => {
    expect(
      chatListOf(wired({ chats: [row, { ...row, id: 'nope' }, { ...row, role: 'admin' }] })),
    ).toEqual({
      chats: [row],
    })
    expect(chatListOf({ chats: 'all' })).toBeNull()
  })

  it('reads a new chat’s space', () => {
    expect(newChatOf({ space: 'space-1' })).toEqual({ space: 'space-1' })
    expect(newChatOf({ space: '' })).toBeNull()
  })

  it('reads pages of events and of messages', () => {
    const logged = { ...EVENTS[0], seq: 1, at: 10, author: 'user:emil' }
    expect(eventsPageOf(wired({ events: [logged], more: true }))).toEqual({
      events: [logged],
      more: true,
    })
    expect(eventsPageOf({ events: [logged] })).toBeNull()

    const state = chatState()
    apply(state, {
      kind: 'post',
      id: 'e1',
      message: 'm1',
      body: 'hi',
      seq: 1,
      at: 10,
      author: 'user:emil',
    })
    const page = { messages: [...state.messages.values()], meta: state.meta, seq: 1, next: null }
    expect(statePageOf(wired(page))).toEqual(page)
    expect(statePageOf({ ...page, meta: {} })).toBeNull()
  })

  it('reads an outbox’s events whole or not at all', () => {
    expect(postEventsOf(wired({ events: EVENTS }))).toEqual({ events: EVENTS })
    expect(postEventsOf({ events: [] })).toBeNull()
    expect(postEventsOf({ events: [...EVENTS, { kind: 'delete' }] })).toBeNull()
    const many = Array.from({ length: MOST_POSTED + 1 }, () => EVENTS[0])
    expect(postEventsOf({ events: many })).toBeNull()
  })

  it('reads each event’s answer', () => {
    const results = {
      results: [
        { id: 'e1', seq: 3, at: 30 },
        { id: 'e2', refused: 'slow' },
      ],
    }
    expect(resultsOf(wired(results))).toEqual(results)
    expect(resultsOf({ results: [{ id: 'e2', refused: 'sad' }] })).toBeNull()
  })
})

describe('who', () => {
  it.each(['user:emil', 'guest:g_1', 'program:ci-bot'])('%s is somebody', (value) => {
    expect(isWho(value)).toBe(true)
  })

  it.each(['emil', 'user:', 'admin:emil', 'user:emil smith', 7])('%s is nobody', (value) => {
    expect(isWho(value)).toBe(false)
  })
})
