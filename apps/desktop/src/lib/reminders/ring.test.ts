import { expect, test } from 'vitest'
import type { Reminder } from './plan'
import { type Bell, Ringer } from './ring'

function rig() {
  let now = 0
  const timers: { at: number; run: () => void; live: boolean }[] = []
  const shown: string[] = []
  const bell: Bell = {
    now: () => now,
    show: (one) => shown.push(one.id),
    later(run, ms) {
      const timer = { at: now + ms, run, live: true }
      timers.push(timer)
      return () => (timer.live = false)
    },
  }
  const advance = (to: number) => {
    now = to
    for (const timer of timers) {
      if (timer.live && timer.at <= to) {
        timer.live = false
        timer.run()
      }
    }
  }
  return { ringer: new Ringer(bell), shown, advance, timers }
}

const reminder = (id: string, at: number): Reminder => ({
  id,
  at,
  title: id,
  body: 'Plan',
  space: 'W',
  path: 'P.md',
  hash: 'h',
  line: 0,
})

test('each reminder rings once, at its moment', () => {
  const one = rig()
  one.ringer.ring([reminder('a', 100), reminder('b', 200)])
  one.advance(150)
  expect(one.shown).toEqual(['a'])

  // Handed again: a has rung and does not ring twice.
  one.ringer.ring([reminder('a', 100), reminder('b', 200)])
  one.advance(250)
  expect(one.shown).toEqual(['a', 'b'])
})

test('a plan handed again calls off what it no longer holds', () => {
  const one = rig()
  one.ringer.ring([reminder('a', 100)])
  one.ringer.ring([])
  one.advance(150)
  expect(one.shown).toEqual([])
})

test('nothing past three weeks is waited for', () => {
  const one = rig()
  one.ringer.ring([reminder('far', 30 * 86_400_000)])
  expect(one.timers).toHaveLength(0)
})
