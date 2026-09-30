/** A page's dialogs: read off the crate's event, answered once, and cancelled with the
 *  tab. The behaviour worth being sure of is the page's - a `confirm()` answered Cancel
 *  is a `false`, never a yes nobody gave. See dialogs.svelte.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const told: { id: number; accept: boolean; text: unknown }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'web_dialog_answer') {
      told.push({ id: Number(args.id), accept: args.accept === true, text: args.text })
    }
    return Promise.resolve(undefined)
  },
}))

const { dialogs, readDialog } = await import('./dialogs.svelte')

let next = 1

function opened(kind: string, tab = 'a', text = '') {
  const said = readDialog({
    tab,
    id: next++,
    kind,
    message: 'Delete this?',
    text,
    origin: 'https://a.example/page',
  })
  expect(said).not.toBe(null)
  return said!
}

beforeEach(() => {
  told.length = 0
  dialogs.open = []
})

test('reads a dialog and names its site the way the bar does', () => {
  expect(
    readDialog({
      tab: 'a',
      id: 3,
      kind: 'confirm',
      message: 'Delete this?',
      text: '',
      origin: 'https://www.a.example/page',
    }),
  ).toEqual({
    id: 3,
    tab: 'a',
    kind: 'confirm',
    message: 'Delete this?',
    text: '',
    site: 'a.example',
  })
})

test('throws out anything that is not one', () => {
  for (const value of [
    null,
    'confirm',
    { tab: 'a', id: '3', kind: 'confirm', message: '', text: '', origin: '' },
    { tab: 'a', id: 3, kind: 'print', message: '', text: '', origin: '' },
    { tab: 'a', id: 3, kind: 'alert', message: 1, text: '', origin: '' },
    { tab: 'a', id: 3, kind: 'alert', message: '', origin: '' },
  ]) {
    expect(readDialog(value)).toBe(null)
  }
})

test('Cancel is a no, and nothing else is sent with it', () => {
  const one = opened('confirm')
  dialogs.heard(one)
  dialogs.answer(one, false)

  expect(dialogs.open).toEqual([])
  expect(told).toEqual([{ id: one.id, accept: false, text: null }])
})

test('OK on a prompt sends the words, and only a prompt sends any', () => {
  const asked = opened('prompt', 'a', 'Ada')
  const confirmed = opened('confirm')
  dialogs.heard(asked)
  dialogs.heard(confirmed)

  dialogs.answer(asked, true, 'Grace')
  dialogs.answer(confirmed, true, 'ignored')

  expect(told).toEqual([
    { id: asked.id, accept: true, text: 'Grace' },
    { id: confirmed.id, accept: true, text: null },
  ])
})

test('a tab that closes cancels its own dialogs and no other', () => {
  const mine = opened('alert', 'a')
  const theirs = opened('leave', 'b')
  dialogs.heard(mine)
  dialogs.heard(theirs)

  dialogs.dropped('a')

  expect(dialogs.open).toEqual([theirs])
  expect(told).toEqual([{ id: mine.id, accept: false, text: null }])
})
