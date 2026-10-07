import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { ChatPage } from './chat.svelte'
import { bigChat, LUCILE, seeded } from './seed'
import { useStore } from './source.svelte'

afterEach(() => vi.useRealTimers())

describe('a chat open in a tab', () => {
  test('opens at the New line, with the messages after it unread', () => {
    const { store, thesis } = seeded()
    useStore(store)
    const page = new ChatPage(thesis)
    expect(page.ready).toBe(true)
    const kinds = page.items.map((item) => item.kind)
    expect(kinds).toContain('new')
    const after = page.items.slice(kinds.indexOf('new') + 1)
    expect(after.some((item) => item.kind === 'message' && item.message.author === LUCILE)).toBe(
      true,
    )
    page.close()
  })

  test('a post is drawn from the outbox at once and takes its place when placed', async () => {
    vi.useFakeTimers()
    const { store, general } = seeded()
    useStore(store)
    const page = new ChatPage(general)
    page.post('hello **team**')
    await vi.advanceTimersByTimeAsync(1)
    expect(page.items.at(-1)).toMatchObject({ kind: 'message', pending: true })
    await vi.advanceTimersByTimeAsync(store.delay + 10)
    const last = page.items.at(-1)
    expect(last).toMatchObject({ kind: 'message', pending: false })
    expect(last?.kind === 'message' && last.message.body).toBe('hello **team**')
    page.close()
  })

  test('a quote goes with the next post and leaves the composer', async () => {
    vi.useFakeTimers()
    const { store, general } = seeded()
    useStore(store)
    const page = new ChatPage(general)
    const first = page.messages[0]
    if (!first) throw new Error('no message')
    page.aside = { kind: 'quote', message: first }
    page.post('yes')
    expect(page.aside).toBeNull()
    await vi.advanceTimersByTimeAsync(store.delay + 10)
    expect(page.messages.at(-1)?.quote).toBe(first.id)
    page.close()
  })

  test('a reaction goes on and comes off; a delete stands', async () => {
    const { store, general } = seeded()
    useStore(store)
    const page = new ChatPage(general)
    const first = page.messages[0]
    if (!first) throw new Error('no message')
    page.react(first, '👍')
    await Promise.resolve()
    expect(page.messages[0]?.reactions['👍']).toEqual(['user:emil'])
    page.react(page.messages[0] ?? first, '👍')
    await Promise.resolve()
    expect(page.messages[0]?.reactions['👍']).toBeUndefined()
    page.remove(first.id)
    await Promise.resolve()
    expect(page.messages[0]?.deleted).toBe(true)
    page.close()
  })

  test('↑ edits the reader’s own last message', () => {
    const { store, thesis } = seeded()
    useStore(store)
    const page = new ChatPage(thesis)
    expect(page.lastOwn()?.author).toBe('user:emil')
    page.close()
  })
})

describe('a chat of 100,000 messages', () => {
  let made: ReturnType<typeof bigChat>
  beforeAll(() => {
    made = bigChat(100_000)
  }, 60_000)

  test('opens with a window, holds at most a thousand, and pages back to the start', async () => {
    useStore(made.store)
    const page = new ChatPage(made.chat)
    expect(page.messages.length).toBe(100)
    expect(page.before).toBe(true)
    for (let step = 0; step < 8; step++) await page.older()
    expect(page.messages.length).toBe(1000)
    expect(page.after).toBe(true)
    const started = performance.now()
    const items = page.items
    expect(items.length).toBeGreaterThan(1000)
    // Rows for a whole window are a pass over it, never over the chat.
    expect(performance.now() - started).toBeLessThan(200)
    await page.bottom()
    expect(page.after).toBe(false)
    page.close()
  })
})
