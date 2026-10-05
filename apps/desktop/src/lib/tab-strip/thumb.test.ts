import { beforeAll, expect, test } from 'vitest'

/** No page here to decode a picture in: every still falls back to the photograph, which
 *  is what a window that cannot draw one does too. */
class Undecodable {
  src = ''
  decode(): Promise<void> {
    return Promise.reject(new Error('nothing to decode with'))
  }
}

beforeAll(() => {
  Object.assign(globalThis, { Image: Undecodable, window: { devicePixelRatio: 2 } })
})

const { drawn, stillOf } = await import('./thumb')

test('a page taller than sixteen by nine is drawn across the whole still, from its top', () => {
  expect(drawn(1600, 1200, 512, 288)).toEqual({ x: 0, width: 512, height: 384 })
})

test('a page wider than sixteen by nine is drawn from its middle', () => {
  expect(drawn(2000, 500, 512, 288)).toEqual({ x: -320, width: 1152, height: 288 })
})

test('one still per photograph, kept until the tab has a new one', async () => {
  const first = stillOf('kept', 'data:one', 256)
  expect(stillOf('kept', 'data:one', 256)).toBe(first)
  expect(await first).toBe('data:one')

  const next = stillOf('kept', 'data:two', 256)
  expect(next).not.toBe(first)
  expect(await next).toBe('data:two')
})

test('only the newest tabs’ stills are kept', () => {
  const oldest = stillOf('tab 0', 'data:0', 256)
  for (let index = 1; index <= 32; index++) void stillOf(`tab ${index}`, `data:${index}`, 256)
  expect(stillOf('tab 0', 'data:0', 256)).not.toBe(oldest)
  expect(stillOf('tab 32', 'data:32', 256)).toBe(stillOf('tab 32', 'data:32', 256))
})
