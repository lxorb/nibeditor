/** Whether somebody is at this computer: five minutes without a key or the pointer is
 *  idle, and the next key is active again; input to a web page, which the app's own page
 *  never hears, counts through what the system says; and sound or an agent at work keep
 *  the computer in use. Said on the change and only then. */

import { beforeEach, describe, expect, test } from 'vitest'
import { IDLE_AFTER, INPUT_EVERY } from '../backoff'
import { Activity, readSystemInput, type SystemInput } from './activity'

let now: number
let system: SystemInput | null
let busy: boolean
let heard: (() => void) | null
let tick: (() => void) | null

function activity(): Activity {
  return new Activity({
    now: () => now,
    system: () => Promise.resolve(system),
    busy: () => busy,
    listen: (run) => {
      heard = run
      return () => {
        heard = null
      }
    },
    every: (_ms, run) => {
      tick = run
      return () => {
        tick = null
      }
    },
  })
}

beforeEach(() => {
  now = 1_000_000
  system = null
  busy = false
  heard = null
  tick = null
})

describe('activity', () => {
  test('goes idle five minutes after the last input, and comes back on the next', async () => {
    const one = activity()
    const said: boolean[] = []
    one.changed((active) => said.push(active))
    one.start()

    now += IDLE_AFTER - INPUT_EVERY
    await one.check()
    expect(one.active).toBe(true)

    now += INPUT_EVERY
    await one.check()
    expect(one.active).toBe(false)

    heard?.()
    expect(one.active).toBe(true)
    // On the change and only then.
    await one.check()
    expect(said).toEqual([false, true])
  })

  test('counts typing into a web page, which the system hears while nib is in front', async () => {
    const one = activity()
    one.start()
    now += IDLE_AFTER + 1

    system = { idleMs: 2_000, front: true }
    await one.check()
    expect(one.active).toBe(true)

    // The same input with another program in front was not nib's.
    now += IDLE_AFTER + 1
    system = { idleMs: 2_000, front: false }
    await one.check()
    expect(one.active).toBe(false)
  })

  test('stays in use while a page plays sound or an agent works', async () => {
    const one = activity()
    one.start()
    now += IDLE_AFTER * 3
    busy = true
    await one.check()
    expect(one.active).toBe(true)
  })

  test('checks on its own clock once started, and stops', async () => {
    const one = activity()
    const stop = one.start()
    now += IDLE_AFTER + 1
    tick?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(one.active).toBe(false)

    stop()
    expect(tick).toBeNull()
    expect(heard).toBeNull()
  })
})

test('the system’s answer is read, and anything else is nothing', () => {
  expect(readSystemInput({ idleMs: 5, front: true })).toEqual({ idleMs: 5, front: true })
  expect(readSystemInput(null)).toBeNull()
  expect(readSystemInput({ idleMs: '5', front: true })).toBeNull()
})
