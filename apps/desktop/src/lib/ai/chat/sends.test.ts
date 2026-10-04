import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { answeringAt, onSend, watching } from './sends'
import type { Engine, Thread } from './types'

function fakeEngine(): Engine & { extra: () => string } {
  return {
    models: () => Promise.resolve([]),
    send: () => new Promise((done) => setTimeout(done, 5)),
    steer: () => Promise.resolve(),
    compact: () => Promise.resolve(),
    extra: () => 'kept',
  }
}

const thread = (id: string, provider: string) => ({ id, provider }) as Thread

describe('which thread was answering when', () => {
  // A clock of its own: a send is stamped as it starts and as it ends, and a real
  // clock could tick between the test reading it and the send stamping it, which a
  // loaded machine did.
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('is every send of an engine, from its start to its end', async () => {
    const engine = watching(fakeEngine())
    const heard = vi.fn()
    const stop = onSend(heard)

    const before = Date.now()
    const sending = engine.send(
      thread('t1', 'own'),
      { text: '', attachments: [] },
      () => undefined,
      new AbortController().signal,
    )
    expect(answeringAt('own', before)).toBe('t1')
    expect(heard).toHaveBeenCalledWith('t1')
    await vi.advanceTimersByTimeAsync(5)
    await sending
    const after = Date.now()
    expect(answeringAt('own', before - 1)).toBeNull()
    expect(answeringAt('own', before)).toBe('t1')
    expect(answeringAt('own', after)).toBe('t1')
    expect(answeringAt('own', after + 1)).toBeNull()
    expect(answeringAt('other', before)).toBeNull()
    stop()
  })

  test('keeps the engine’s own, whatever it grows, and is the same engine twice', () => {
    const raw = fakeEngine()
    const engine = watching(raw) as typeof raw
    expect(engine.extra()).toBe('kept')
    expect(watching(raw)).toBe(engine)
  })
})
