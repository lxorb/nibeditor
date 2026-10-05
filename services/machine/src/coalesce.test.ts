import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Coalescer, ECHO_MS, ECHO_SENDS, FRAME_MS } from './coalesce'

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

/** A coalescer on a clock of the test's own, moved with the timers. */
function clocked() {
  const sent: { at: number; text: string }[] = []
  let now = 1000
  const coalescer = new Coalescer(
    (data) => sent.push({ at: now, text: text(data) }),
    () => now,
  )
  const pass = (ms: number) => {
    for (let step = 0; step < ms; step++) {
      now += 1
      vi.advanceTimersByTime(1)
    }
  }
  return { sent, coalescer, pass }
}

test('a key’s echo goes at once even inside a busy frame, not up to a frame later', () => {
  const { sent, coalescer, pass } = clocked()
  // A spinner printed 2 ms ago; the key's echo follows.
  coalescer.push(bytes('-'))
  pass(2)
  coalescer.typed()
  pass(1)
  coalescer.push(bytes('a'))
  expect(sent).toEqual([
    { at: 1000, text: '-' },
    { at: 1003, text: 'a' },
  ])
})

test('without a key the same output waits for the frame', () => {
  const { sent, coalescer, pass } = clocked()
  coalescer.push(bytes('-'))
  pass(3)
  coalescer.push(bytes('|'))
  expect(sent).toHaveLength(1)
  pass(FRAME_MS)
  expect(sent.map((one) => one.at)).toEqual([1000, 1000 + FRAME_MS])
})

test('an echo in two reads goes as two sends, and a flood after them is coalesced', () => {
  const { sent, coalescer, pass } = clocked()
  coalescer.push(bytes('prompt'))
  coalescer.typed()
  for (let read = 0; read < ECHO_SENDS; read++) coalescer.push(bytes(String(read)))
  expect(sent).toHaveLength(1 + ECHO_SENDS)
  for (let read = 0; read < 100; read++) {
    coalescer.push(bytes('x'))
    pass(1)
  }
  pass(FRAME_MS)
  expect(
    sent
      .slice(1 + ECHO_SENDS)
      .map((one) => one.text)
      .join(''),
  ).toBe('x'.repeat(100))
  expect(sent.length - 1 - ECHO_SENDS).toBeLessThanOrEqual(Math.ceil(100 / FRAME_MS) + 2)
})

test('output long after a key is no echo of it', () => {
  const { sent, coalescer, pass } = clocked()
  coalescer.typed()
  pass(ECHO_MS + 1)
  coalescer.push(bytes('a'))
  coalescer.push(bytes('b'))
  expect(sent.map((one) => one.text)).toEqual(['a'])
  pass(FRAME_MS)
  expect(sent.map((one) => one.text)).toEqual(['a', 'b'])
})

test('every key buys its own echo: fast typing is never a frame behind', () => {
  const { sent, coalescer, pass } = clocked()
  for (const key of 'hello') {
    coalescer.typed()
    pass(1)
    coalescer.push(bytes(key))
    pass(4)
  }
  expect(sent.map((one) => one.text)).toEqual(['h', 'e', 'l', 'l', 'o'])
  // Each echo went one millisecond after its key.
  expect(sent.map((one) => one.at)).toEqual([1001, 1006, 1011, 1016, 1021])
})
