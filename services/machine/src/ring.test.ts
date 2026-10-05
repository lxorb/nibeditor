import { expect, test } from 'vitest'
import { Ring } from './ring'

const bytes = (text: string) => new TextEncoder().encode(text)
const textOf = (data: Uint8Array | null) => (data ? new TextDecoder().decode(data) : null)

test('a frame is numbered by the offset of its first byte', () => {
  const ring = new Ring()
  expect(ring.append(bytes('abc'))).toBe(0)
  expect(ring.append(bytes('de'))).toBe(3)
  expect(ring.end).toBe(5)
})

test('everything after an offset comes back as one run, from inside a frame too', () => {
  const ring = new Ring()
  ring.append(bytes('abc'))
  ring.append(bytes('def'))
  expect(textOf(ring.since(0))).toBe('abcdef')
  expect(textOf(ring.since(2))).toBe('cdef')
  expect(textOf(ring.since(6))).toBe('')
})

test('an offset the session never reached, or a broken one, is no answer', () => {
  const ring = new Ring()
  ring.append(bytes('abc'))
  expect(ring.since(4)).toBeNull()
  expect(ring.since(-1)).toBeNull()
  expect(ring.since(1.5)).toBeNull()
})

test('the oldest frames go once the rest still cover the limit, and not before', () => {
  const ring = new Ring(0, 10)
  ring.append(bytes('aaaa'))
  ring.append(bytes('bbbb'))
  ring.append(bytes('cccc'))
  // Twelve bytes held; dropping the first four would leave eight, under ten.
  expect(ring.start).toBe(0)
  ring.append(bytes('dddd'))
  expect(ring.start).toBe(4)
  expect(ring.since(3)).toBeNull()
  expect(textOf(ring.since(4))).toBe('bbbbccccdddd')
})

test('the last megabyte is always kept, whatever the frames were', () => {
  const ring = new Ring()
  const frame = new Uint8Array(4096)
  for (let i = 0; i < 1000; i++) ring.append(frame)
  expect(ring.end - ring.start).toBeGreaterThanOrEqual(1024 * 1024)
  expect(ring.end - ring.start).toBeLessThan(1024 * 1024 + 4096)
  expect(ring.since(ring.end - 1024 * 1024)?.length).toBe(1024 * 1024)
})

test('a restored session numbers on from where it starts', () => {
  const ring = new Ring(500)
  expect(ring.since(0)).toBeNull()
  expect(ring.append(bytes('x'))).toBe(500)
})
