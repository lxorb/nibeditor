import type { Message } from '@nib/chats'
import { expect, test } from 'vitest'
import { estimate } from './estimate'
import type { Item } from './rows'

function row(more: Partial<Message> = {}, head = true): Item {
  return {
    kind: 'message',
    key: 'm',
    head,
    pending: false,
    seen: [],
    message: {
      id: 'm',
      seq: 1,
      at: 0,
      author: 'user:emil',
      body: 'hello',
      alsoToChat: false,
      files: [],
      mentions: [],
      reactions: {},
      pinned: false,
      history: [],
      deleted: false,
      replies: 0,
      ...more,
    },
  }
}

test('a group’s first row is taller than the rows that follow it', () => {
  expect(estimate(row(), 800)).toBeGreaterThan(estimate(row({}, false), 800))
})

test('long words wrap into more lines at a narrower column', () => {
  const long = row({ body: 'word '.repeat(200) })
  expect(estimate(long, 400)).toBeGreaterThan(estimate(long, 1200))
})

test('a picture is as tall as it will be drawn, from the size the sender stated', () => {
  const picture = row({
    body: '',
    files: [{ hash: 'a', name: 'p', size: 1, type: 'image/webp', width: 960, height: 720 }],
  })
  expect(estimate(picture, 1000)).toBe(30 + 360 + 6)
})

test('a day and the New line are their own heights', () => {
  expect(estimate({ kind: 'day', key: 'd', day: '2026-10-07', at: 0 }, 800)).toBe(36)
  expect(estimate({ kind: 'new', key: 'new' }, 800)).toBe(22)
})
