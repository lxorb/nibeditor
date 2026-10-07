import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, type ChatState, chatState } from './reduce'
import type { Event, Logged, Message, Post, Posting, Who } from './types'

const EMIL: Who = 'user:emil'
const LUCILE: Who = 'user:lucile'
const MIA: Who = 'user:mia'
const PAUL: Who = 'user:paul'

/** A log written in order: each event placed at the next seq, a second apart. */
function log(...events: [Who, Event][]): Logged[] {
  return events.map(([author, event], index) => ({
    ...event,
    seq: index + 1,
    at: (index + 1) * 1000,
    author,
  }))
}

function stateOf(events: readonly Logged[]): ChatState {
  const state = chatState()
  for (const event of events) apply(state, event)
  return state
}

function message(state: ChatState, id: string): Message {
  const found = state.messages.get(id)
  if (!found) throw new Error(`no message ${id}`)
  return found
}

const post = (
  id: string,
  body: string,
  extra: Partial<Extract<Event, { kind: 'post' }>> = {},
): Event => ({
  kind: 'post',
  id: `p-${id}`,
  message: id,
  body,
  ...extra,
})

describe('a post', () => {
  it('is a message with its place, time and author', () => {
    const state = stateOf(log([EMIL, post('m1', 'Draft is up')]))
    expect(message(state, 'm1')).toEqual({
      id: 'm1',
      seq: 1,
      at: 1000,
      author: EMIL,
      body: 'Draft is up',
      alsoToChat: false,
      files: [],
      mentions: [],
      reactions: {},
      pinned: false,
      history: [],
      deleted: false,
      replies: 0,
    })
  })

  it('is placed once, at its first place, however often it is placed', () => {
    const [first] = log([EMIL, post('m1', 'one')])
    if (!first) throw new Error('no event')
    const state = chatState()
    expect(apply(state, { ...first, seq: 7 })).toHaveLength(1)
    expect(apply(state, first)).toHaveLength(1)
    expect(apply(state, { ...first, seq: 9 })).toEqual([])
    expect(message(state, 'm1').seq).toBe(1)
  })

  it('keeps what it carries', () => {
    const state = stateOf(
      log([
        EMIL,
        post('m1', 'see @Lucile', {
          quote: 'm0',
          mentions: [LUCILE],
          via: { agent: 'Claude Code' },
          preview: { url: 'https://example.com', title: 'Example' },
          files: [{ hash: 'a'.repeat(64), name: 'a.png', size: 3, type: 'image/png' }],
        }),
      ]),
    )
    const m1 = message(state, 'm1')
    expect(m1.quote).toBe('m0')
    expect(m1.mentions).toEqual([LUCILE])
    expect(m1.via).toEqual({ agent: 'Claude Code' })
    expect(m1.preview?.title).toBe('Example')
    expect(m1.files).toHaveLength(1)
  })
})

describe('replies', () => {
  it('are counted on their parent, with the latest time', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'Draft')],
        [LUCILE, post('m2', 'Reading', { parent: 'm1' })],
        [MIA, post('m3', 'Same', { parent: 'm1', alsoToChat: true })],
      ),
    )
    expect(message(state, 'm1')).toMatchObject({ replies: 2, lastReplyAt: 3000 })
    expect(message(state, 'm3')).toMatchObject({ parent: 'm1', alsoToChat: true })
  })

  it('change their parent too, as the reducer answers', () => {
    const state = stateOf(log([EMIL, post('m1', 'Draft')]))
    const changed = apply(state, {
      ...post('m2', 'Reading', { parent: 'm1' }),
      seq: 2,
      at: 2000,
      author: LUCILE,
    })
    expect(changed.map((one) => one.id)).toEqual(['m2', 'm1'])
  })

  it('stop counting once deleted', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'Draft')],
        [LUCILE, post('m2', 'Reading', { parent: 'm1' })],
        [MIA, post('m3', 'Same', { parent: 'm1' })],
        [MIA, { kind: 'delete', id: 'd', target: 'm3' }],
      ),
    )
    expect(message(state, 'm1')).toMatchObject({ replies: 1, lastReplyAt: 2000 })
  })

  it('wait for a parent that has not arrived', () => {
    const [parent, reply] = log(
      [EMIL, post('m1', 'Draft')],
      [LUCILE, post('m2', 'Reading', { parent: 'm1' })],
    )
    if (!parent || !reply) throw new Error('no events')
    const state = chatState()
    expect(apply(state, reply).map((one) => one.id)).toEqual(['m2'])
    expect(apply(state, parent)[0]?.replies).toBe(1)
  })
})

describe('an edit', () => {
  it('is the author’s, and the latest stands, with the earlier wordings kept', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one')],
        [EMIL, { kind: 'edit', id: 'e1', target: 'm1', body: 'two' }],
        [EMIL, { kind: 'edit', id: 'e2', target: 'm1', body: 'three' }],
      ),
    )
    expect(message(state, 'm1')).toMatchObject({
      body: 'three',
      editedAt: 3000,
      history: [
        { body: 'one', at: 1000 },
        { body: 'two', at: 2000 },
      ],
    })
  })

  it('by anybody else is no edit', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one')],
        [LUCILE, { kind: 'edit', id: 'e1', target: 'm1', body: 'mine now' }],
      ),
    )
    expect(message(state, 'm1')).toMatchObject({ body: 'one', history: [] })
    expect(message(state, 'm1').editedAt).toBeUndefined()
  })

  it('replaces the files only when it names files', () => {
    const file = (name: string) => ({ hash: 'b'.repeat(64), name, size: 1, type: 'text/plain' })
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one', { files: [file('a.txt')] })],
        [EMIL, { kind: 'edit', id: 'e1', target: 'm1', body: 'two' }],
      ),
    )
    expect(message(state, 'm1').files.map((one) => one.name)).toEqual(['a.txt'])
    apply(state, {
      kind: 'edit',
      id: 'e2',
      target: 'm1',
      body: 'three',
      files: [],
      seq: 3,
      at: 3000,
      author: EMIL,
    })
    expect(message(state, 'm1').files).toEqual([])
  })
})

describe('a delete', () => {
  it('takes everything the message said and keeps its place', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one', { poll: { question: 'q', answers: ['a', 'b'], several: false } })],
        [LUCILE, { kind: 'react', id: 'r', target: 'm1', emoji: '👍', on: true }],
        [LUCILE, { kind: 'pin', id: 'p', target: 'm1', on: true }],
        [LUCILE, post('m2', 'reply', { parent: 'm1' })],
        [EMIL, { kind: 'delete', id: 'd', target: 'm1' }],
      ),
    )
    expect(message(state, 'm1')).toEqual({
      id: 'm1',
      seq: 1,
      at: 1000,
      author: EMIL,
      body: '',
      alsoToChat: false,
      files: [],
      mentions: [],
      reactions: {},
      pinned: false,
      history: [],
      deleted: true,
      replies: 1,
      lastReplyAt: 4000,
    })
  })

  it('stands over an edit that comes after it', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one')],
        [EMIL, { kind: 'delete', id: 'd', target: 'm1' }],
        [EMIL, { kind: 'edit', id: 'e', target: 'm1', body: 'back' }],
      ),
    )
    expect(message(state, 'm1')).toMatchObject({ deleted: true, body: '' })
  })
})

describe('reactions, pins and votes', () => {
  it('are a set per person and emoji, the later standing', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one')],
        [LUCILE, { kind: 'react', id: 'r1', target: 'm1', emoji: '👍', on: true }],
        [MIA, { kind: 'react', id: 'r2', target: 'm1', emoji: '👍', on: true }],
        [MIA, { kind: 'react', id: 'r3', target: 'm1', emoji: '👀', on: true }],
        [LUCILE, { kind: 'react', id: 'r4', target: 'm1', emoji: '👍', on: false }],
        [LUCILE, { kind: 'react', id: 'r5', target: 'm1', emoji: '👍', on: true }],
      ),
    )
    expect(message(state, 'm1').reactions).toEqual({ '👍': [MIA, LUCILE], '👀': [MIA] })
  })

  it('pin by the later', () => {
    const state = stateOf(
      log(
        [EMIL, post('m1', 'one')],
        [LUCILE, { kind: 'pin', id: 'p1', target: 'm1', on: true }],
        [MIA, { kind: 'pin', id: 'p2', target: 'm1', on: false }],
      ),
    )
    expect(message(state, 'm1').pinned).toBe(false)
  })

  it('count only votes the poll takes', () => {
    const state = stateOf(
      log(
        [
          EMIL,
          post('m1', 'lunch?', {
            poll: { question: 'Where', answers: ['A', 'B', 'C'], several: false, ends: 6000 },
          }),
        ],
        [LUCILE, { kind: 'vote', id: 'v1', target: 'm1', answers: [0] }],
        [MIA, { kind: 'vote', id: 'v2', target: 'm1', answers: [0, 1] }],
        [EMIL, { kind: 'vote', id: 'v3', target: 'm1', answers: [5] }],
        [LUCILE, { kind: 'vote', id: 'v4', target: 'm1', answers: [2] }],
        [MIA, { kind: 'pin', id: 'p', target: 'm1', on: true }],
        [PAUL, { kind: 'vote', id: 'v5', target: 'm1', answers: [1] }],
      ),
    )
    // Mia's two answers are refused by a poll of one, Emil's names no answer, and Paul's
    // came after the poll ended; Lucile's later vote stands over her first.
    expect(message(state, 'm1').poll?.votes).toEqual({ [LUCILE]: [2] })
  })

  it('take several answers where the poll does, and a vote of none takes it back', () => {
    const state = stateOf(
      log(
        [
          EMIL,
          post('m1', 'when?', {
            poll: { question: 'When', answers: ['Mon', 'Tue'], several: true },
          }),
        ],
        [LUCILE, { kind: 'vote', id: 'v1', target: 'm1', answers: [1, 0] }],
        [MIA, { kind: 'vote', id: 'v2', target: 'm1', answers: [1] }],
        [MIA, { kind: 'vote', id: 'v3', target: 'm1', answers: [] }],
        [EMIL, { kind: 'vote', id: 'v4', target: 'm1', answers: [1, 1] }],
      ),
    )
    expect(message(state, 'm1').poll?.votes).toEqual({ [LUCILE]: [0, 1] })
  })
})

describe('settings', () => {
  it('are last writer per key', () => {
    const state = stateOf(
      log(
        [EMIL, { kind: 'meta', id: 'a', topic: 'Chapters', posting: 'owner' }],
        [EMIL, { kind: 'meta', id: 'b', topic: 'Deadlines' }],
        [EMIL, { kind: 'meta', id: 'c', slowmode: 30 }],
      ),
    )
    expect(state.meta).toEqual({ topic: 'Deadlines', posting: 'owner', slowmode: 30 })
  })

  it('and a schedule change no message', () => {
    const state = chatState()
    const changed = apply(state, {
      kind: 'schedule',
      id: 's',
      sendAt: 9000,
      post: { kind: 'post', id: 'p', message: 'm9', body: 'later' },
      seq: 1,
      at: 1000,
      author: EMIL,
    })
    expect(changed).toEqual([])
    expect(state.messages.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Any order of the same placed events gives one state.

const PEOPLE: Who[] = [EMIL, LUCILE, MIA]
const IDS = ['m1', 'm2', 'm3', 'm4']

const person = fc.constantFrom(...PEOPLE)
const id = fc.constantFrom(...IDS)

const aPost: fc.Arbitrary<[Who, Event]> = fc
  .tuple(
    person,
    id,
    fc.string({ maxLength: 6 }),
    fc.option(id, { nil: undefined }),
    fc.option(
      fc.tuple(fc.boolean(), fc.option(fc.integer({ min: 0, max: 40_000 }), { nil: undefined })),
      {
        nil: undefined,
      },
    ),
  )
  .map(([who, message, body, parent, poll]) => {
    const event: Post = { kind: 'post', id: `p-${message}`, message, body }
    if (parent !== undefined) event.parent = parent
    if (poll) {
      const [several, ends] = poll
      event.poll = { question: 'q', answers: ['a', 'b', 'c'], several }
      if (ends !== undefined) event.poll.ends = ends
    }
    return [who, event]
  })

const aMeta: fc.Arbitrary<[Who, Event]> = fc
  .tuple(
    person,
    fc.option(fc.string({ maxLength: 4 }), { nil: undefined }),
    fc.option(fc.constantFrom<Posting>('writers', 'owner'), { nil: undefined }),
    fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
  )
  .map(([who, topic, posting, slowmode]) => {
    const event: Event = { kind: 'meta', id: 't' }
    if (topic !== undefined) event.topic = topic
    if (posting !== undefined) event.posting = posting
    if (slowmode !== undefined) event.slowmode = slowmode
    return [who, event]
  })

const anEvent: fc.Arbitrary<[Who, Event]> = fc.oneof(
  aPost,
  fc.tuple(
    person,
    fc.record({
      kind: fc.constant('edit' as const),
      id: fc.constant('e'),
      target: id,
      body: fc.string({ maxLength: 6 }),
    }),
  ),
  fc.tuple(
    person,
    fc.record({ kind: fc.constant('delete' as const), id: fc.constant('d'), target: id }),
  ),
  fc.tuple(
    person,
    fc.record({
      kind: fc.constant('react' as const),
      id: fc.constant('r'),
      target: id,
      emoji: fc.constantFrom('👍', '👀'),
      on: fc.boolean(),
    }),
  ),
  fc.tuple(
    person,
    fc.record({
      kind: fc.constant('pin' as const),
      id: fc.constant('p'),
      target: id,
      on: fc.boolean(),
    }),
  ),
  fc.tuple(
    person,
    fc.record({
      kind: fc.constant('vote' as const),
      id: fc.constant('v'),
      target: id,
      answers: fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 3 }),
    }),
  ),
  aMeta,
)

/** A log, and the same log in another order with some events delivered twice. */
const shuffled = fc
  .array(anEvent, { minLength: 1, maxLength: 40 })
  .map((events) => log(...events))
  .chain((events) =>
    fc.tuple(
      fc.constant(events),
      fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }),
      fc.subarray(events),
    ),
  )

function comparable(state: ChatState) {
  return {
    messages: [...state.messages.values()].sort((a, b) => a.id.localeCompare(b.id)),
    meta: state.meta,
    seq: state.seq,
  }
}

describe('order', () => {
  it('never changes the state the same placed events make', () => {
    fc.assert(
      fc.property(shuffled, ([inOrder, reordered, again]) => {
        expect(comparable(stateOf([...reordered, ...again]))).toEqual(comparable(stateOf(inOrder)))
      }),
      { numRuns: 400 },
    )
  })
})
