import type { Event, Message } from '@nib/chats'
import { describe, expect, test } from 'vitest'
import type { OutboxRow } from './cache'
import { isMain } from './cache'
import type { Kept } from './fold'
import { overlay } from './overlay'

const CHAT = `c_${'b'.repeat(32)}`

function placed(id: string, seq: number, extra: Partial<Message> = {}): Kept {
  return {
    upto: seq,
    marks: { r: [], v: [] },
    message: {
      id,
      seq,
      at: seq * 1000,
      author: 'user:ana',
      body: `words ${id}`,
      alsoToChat: false,
      files: [],
      mentions: [],
      reactions: {},
      pinned: false,
      history: [],
      deleted: false,
      replies: 0,
      ...extra,
    },
  }
}

function row(event: Event, refused: OutboxRow['refused'] = null): OutboxRow {
  return { id: event.id, chat: CHAT, event, madeAt: 99_000, tries: 0, refused }
}

describe('the outbox drawn over the window', () => {
  test('a post is drawn at once under the placed ones, sending', async () => {
    const { messages, pending } = await overlay(
      [placed('m1', 1)],
      [row({ kind: 'post', id: 'e1', message: 'm2', body: 'hello' })],
      'user:ana',
      isMain,
    )
    expect(messages.map((one) => [one.id, one.sending])).toEqual([['m1', false]])
    expect(pending.map((one) => [one.id, one.body, one.sending, one.at])).toEqual([
      ['m2', 'hello', true, 99_000],
    ])
  })

  test('an edit and a reaction are drawn over a placed message', async () => {
    const { messages } = await overlay(
      [placed('m1', 1)],
      [
        row({ kind: 'edit', id: 'e1', target: 'm1', body: 'better words' }),
        row({ kind: 'react', id: 'e2', target: 'm1', emoji: '👍', on: true }),
      ],
      'user:ana',
      isMain,
    )
    expect(messages[0]).toMatchObject({
      body: 'better words',
      reactions: { '👍': ['user:ana'] },
      sending: true,
    })
  })

  test('a refused edit leaves the words as placed, marked', async () => {
    const { messages } = await overlay(
      [placed('m1', 1)],
      [row({ kind: 'edit', id: 'e1', target: 'm1', body: 'nope' }, 'role')],
      'user:ana',
      isMain,
    )
    expect(messages[0]).toMatchObject({ body: 'words m1', sending: false, refused: 'role' })
  })

  test('a reply waiting counts under its message, and is drawn in its replies only', async () => {
    const reply = row({ kind: 'post', id: 'e1', message: 'r1', body: 'yes', parent: 'm1' })
    const chat = await overlay([placed('m1', 1)], [reply], 'user:ana', isMain)
    expect(chat.messages[0]?.replies).toBe(1)
    expect(chat.pending).toEqual([])
    const replies = await overlay([], [reply], 'user:ana', (one) => one.parent === 'm1')
    expect(replies.pending.map((one) => one.id)).toEqual(['r1'])
  })

  test('a refused post stays drawn, marked, with its words', async () => {
    const { pending } = await overlay(
      [],
      [row({ kind: 'post', id: 'e1', message: 'm9', body: 'kept' }, 'rate')],
      'user:ana',
      isMain,
    )
    expect(pending[0]).toMatchObject({ body: 'kept', refused: 'rate', sending: false })
  })
})
