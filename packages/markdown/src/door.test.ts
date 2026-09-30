import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { door } from './door'

/** A load that fails the first `failures` times it is called and then hands back what
 *  it was asked for, counting every call: a simulated import. */
function flaky<T>(value: T, failures: number) {
  const load = vi.fn(() =>
    load.mock.calls.length <= failures
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
      : Promise.resolve(value),
  )
  return load
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a door', () => {
  test('fetches once however many ask', async () => {
    const load = flaky('palette', 0)
    const open = door(load)

    const [first, second] = await Promise.all([open(), open()])
    await open()

    expect([first, second]).toEqual(['palette', 'palette'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('tries a second time before it gives up', async () => {
    const load = flaky('palette', 1)
    const asked = door(load)()

    await vi.runAllTimersAsync()

    await expect(asked).resolves.toBe('palette')
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('forgets a fetch that failed twice, so the next ask fetches again', async () => {
    const load = flaky('palette', 2)
    const open = door(load)

    const failed = open()
    const settled = expect(failed).rejects.toThrow('Failed to fetch')
    await vi.runAllTimersAsync()
    await settled
    expect(load).toHaveBeenCalledTimes(2)

    await expect(open()).resolves.toBe('palette')
    expect(load).toHaveBeenCalledTimes(3)
  })

  test('keeps what arrived: a success is never fetched again', async () => {
    const load = flaky('palette', 1)
    const open = door(load)

    const first = open()
    await vi.runAllTimersAsync()
    await first

    await open()
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('takes a load that throws before it has a promise as a failed one', async () => {
    let calls = 0
    const open = door(() => {
      calls++
      if (calls < 3) throw new Error('not in this build')
      return Promise.resolve('here')
    })

    const failed = open()
    const settled = expect(failed).rejects.toThrow('not in this build')
    await vi.runAllTimersAsync()
    await settled

    await expect(open()).resolves.toBe('here')
  })
})
