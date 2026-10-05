import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Coalescer, FRAME_MS } from './coalesce'

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function sender() {
  const sent: string[] = []
  const coalescer = new Coalescer(
    (data) => sent.push(text(data)),
    () => performance.now(),
  )
  return { sent, coalescer }
}

test('the first output after a quiet frame goes at once: an echo is never held', () => {
  const { sent, coalescer } = sender()
  coalescer.push(bytes('a'))
  expect(sent).toEqual(['a'])
})

test('what comes inside a frame waits for its end and goes as one', () => {
  const { sent, coalescer } = sender()
  coalescer.push(bytes('a'))
  coalescer.push(bytes('b'))
  coalescer.push(bytes('c'))
  expect(sent).toEqual(['a'])
  vi.advanceTimersByTime(FRAME_MS)
  expect(sent).toEqual(['a', 'bc'])
})

test('a flood is a frame at a time, not a send per read', () => {
  const { sent, coalescer } = sender()
  for (let i = 0; i < 1000; i++) {
    coalescer.push(bytes('x'))
    vi.advanceTimersByTime(1)
  }
  vi.advanceTimersByTime(FRAME_MS)
  expect(sent.join('')).toBe('x'.repeat(1000))
  expect(sent.length).toBeLessThanOrEqual(Math.ceil(1000 / FRAME_MS) + 2)
})

test('a flush of part sends that part now and the rest at the next frame', () => {
  const { sent, coalescer } = sender()
  coalescer.push(bytes('a'))
  coalescer.push(bytes('bcd'))
  coalescer.flush(2)
  expect(sent).toEqual(['a', 'bc'])
  vi.advanceTimersByTime(FRAME_MS)
  expect(sent).toEqual(['a', 'bc', 'd'])
})
