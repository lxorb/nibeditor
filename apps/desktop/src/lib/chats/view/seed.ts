/** A team's chats, said in a store in memory: what the surfaces' tests, the drive and
 *  the screenshots read (docs/chats.md 6.2, lane 5). Every kind of message a chat
 *  draws is in `thesis` - words in markdown, code, a mention, an edit, a quote, a reply
 *  and its replies, a gallery and a picture alone, a voice message, a file, a link's
 *  preview, a poll with votes, reactions, a pin - over two days, with the reader's read
 *  place partway through so the New line shows; and `big` is a chat of as many messages
 *  as a test asks for. Times are counted back from `now`. */

import type { Who } from '@nib/chats'
import type { ChatMember } from '../api'
import { FixtureChats, fixtureFile } from './fixture.svelte'

const EMIL: Who = 'user:emil'
export const LUCILE: Who = 'user:lucile'
const MIA: Who = 'user:mia'
const PAUL: Who = 'user:paul'

const TEAM: ChatMember[] = [
  { who: EMIL, name: 'Emil Vinu', role: 'owner' },
  { who: LUCILE, name: 'Lucile', role: 'write' },
  { who: MIA, name: 'Mia Keller', role: 'write' },
  { who: PAUL, name: 'Paul Okafor', role: 'write' },
]

const MINUTE = 60_000

/** Sixty-four bars of a voice, rising and falling like speech. */
function voice(random: () => number): number[] {
  return Array.from({ length: 64 }, (_, at) =>
    Math.round(60 + 150 * Math.abs(Math.sin(at / 3.1)) * (0.5 + random() / 2)),
  )
}

export function seeded(now = Date.now()): { store: FixtureChats; thesis: string; general: string } {
  let at = now
  const store = new FixtureChats(EMIL, { seed: 11, now: () => at })
  let state = 7
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
  const thesis = store.add('thesis', TEAM, {
    meta: { topic: 'Chapters, deadlines, the defence', posting: 'writers', slowmode: 0 },
  })
  const general = store.add('general', TEAM)
  store.add('design', TEAM)

  const yesterday = new Date(now - 24 * 60 * MINUTE)
  yesterday.setHours(16, 40, 0, 0)
  const start = yesterday.getTime()
  const say = (minutes: number, who: Who, body: string, more = {}) => {
    at = start + minutes * MINUTE
    return store.speak(thesis, who, body, more)
  }
  const event = (minutes: number, who: Who, made: Parameters<FixtureChats['place']>[2]) => {
    at = start + minutes * MINUTE
    store.place(thesis, who, made)
  }

  const draft = say(
    0,
    EMIL,
    'Draft of chapter 3 is up: [[Chapter 3]] has the second experiment in it.',
  )
  event(1, EMIL, { kind: 'react', id: store.id(), target: draft, emoji: '🎉', on: true })
  event(2, LUCILE, { kind: 'react', id: store.id(), target: draft, emoji: '🎉', on: true })
  event(3, MIA, { kind: 'react', id: store.id(), target: draft, emoji: '👀', on: true })
  say(1, EMIL, 'The figures are still the **old** ones, I’ll redo them tomorrow.')
  const reading = say(12, LUCILE, 'Reading it tonight')
  say(22, MIA, 'Same, the figures look good already', { parent: reading })
  say(30, LUCILE, 'Section 3.2 needs a citation for the solver', { parent: reading })
  say(14, MIA, 'Here is the plot script, in case anybody wants to rerun it:')
  say(14.5, MIA, '```python\nfor run in runs:\n    plot(run.residuals, label=run.name)\n```')
  const poll = say(40, PAUL, '', {
    poll: {
      question: 'When do we meet about the defence?',
      answers: ['Monday morning', 'Tuesday after lunch', 'Thursday'],
      several: false,
      ends: now + 2 * 24 * 60 * MINUTE,
    },
  })
  for (const [who, answer] of [
    [EMIL, 1],
    [LUCILE, 1],
    [MIA, 0],
  ] as const) {
    event(41, who, { kind: 'vote', id: store.id(), target: poll, answers: [answer] })
  }
  const pinned = say(
    43,
    PAUL,
    'Defence is on **14 November**, room HG F 3. Slides due the week before.',
  )
  event(44, PAUL, { kind: 'pin', id: store.id(), target: pinned, on: true })
  event(45, LUCILE, { kind: 'react', id: store.id(), target: pinned, emoji: '👍', on: true })
  event(45, MIA, { kind: 'react', id: store.id(), target: pinned, emoji: '👍', on: true })
  event(46, EMIL, { kind: 'react', id: store.id(), target: pinned, emoji: '❤️', on: true })
  const edited = say(50, EMIL, 'I moved the related work into chapter 2')
  event(52, EMIL, {
    kind: 'edit',
    id: store.id(),
    target: edited,
    body: 'I moved the related work into chapter 2, and cut a page from it',
  })
  say(55, LUCILE, 'Photos from the lab today', {
    files: [1, 2, 3, 4].map((n) =>
      fixtureFile(random, {
        name: `lab-${n}.webp`,
        size: 240_000,
        type: 'image/webp',
        width: 1200,
        height: 900,
        preview: `${n * 2}a`.repeat(32),
      }),
    ),
  })
  say(58, PAUL, 'The paper Lucile mentioned:', {
    preview: {
      url: 'https://arxiv.org/abs/2410.01234',
      title: 'Sparse solvers at scale: a survey',
      site: 'arXiv',
      text: 'We review iterative and direct methods for large sparse linear systems arising in simulation.',
    },
  })
  say(60, MIA, 'and the dataset', {
    files: [
      fixtureFile(random, { name: 'residuals-2026-10.csv', size: 1_840_000, type: 'text/csv' }),
    ],
  })

  // This morning, after where the reader read to.
  const morning = new Date(now)
  morning.setHours(9, 0, 0, 0)
  const later = (minutes: number) => (morning.getTime() - start) / MINUTE + minutes
  store.readHere(thesis, store.must(thesis).state.seq)
  const quoted = say(later(14), MIA, '', {
    files: [
      fixtureFile(random, {
        name: 'voice.webm',
        size: 96_000,
        type: 'audio/webm',
        seconds: 42,
        wave: voice(random),
      }),
    ],
  })
  say(later(16), LUCILE, '@Emil Vinu can you look at the conclusion before Friday?', {
    mentions: [EMIL],
  })
  say(later(17), LUCILE, '', {
    files: [
      fixtureFile(random, {
        name: 'whiteboard.webp',
        size: 310_000,
        type: 'image/webp',
        width: 1600,
        height: 1000,
        preview: '9c'.repeat(32),
      }),
    ],
  })
  say(later(19), PAUL, 'Seen the voice note, agree with all of it', { quote: quoted })
  say(later(20), PAUL, '🎉🎉')

  store.readTo(thesis, LUCILE, store.must(thesis).state.seq)
  store.readTo(thesis, MIA, store.must(thesis).state.seq - 2)

  at = now - 3 * 60 * MINUTE
  store.speak(general, LUCILE, 'Lunch at 12?')
  at = now - 2 * 60 * MINUTE
  store.speak(general, PAUL, 'Yes')
  store.readHere(general, store.must(general).state.seq)

  at = now
  return { store, thesis, general }
}

/** A chat of `count` messages from four people, for the window's tests and the drive. */
export function bigChat(count: number, now = Date.now()): { store: FixtureChats; chat: string } {
  let at = now - count * MINUTE
  const store = new FixtureChats(EMIL, { seed: 5, now: () => at })
  const chat = store.add('big', TEAM)
  const people = [EMIL, LUCILE, MIA, PAUL]
  for (let n = 0; n < count; n++) {
    at += MINUTE / 2 + (n % 7) * 9000
    store.speak(
      chat,
      people[n % 4] ?? EMIL,
      `Message ${n + 1}${n % 5 === 0 ? '\nwith a second line' : ''}`,
    )
  }
  store.readHere(chat, store.must(chat).state.seq)
  at = now
  return { store, chat }
}
