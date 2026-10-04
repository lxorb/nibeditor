import { describe, expect, test } from 'vitest'
import type { Row } from '@nib/bases'
import { rowsIn } from './fixtures'
import type { Reminder } from './plan'
import { type Host, QUIET, Scheduler } from './scheduler'

const NOW = new Date(2026, 9, 4, 12, 0).getTime()

interface Rig {
  handed: Reminder[][]
  rung: Reminder[][]
  waiting: boolean[]
  set(rows: Row[]): void
  ready(on: boolean): void
  /** Lets every timer due within `ms` run, and what each started settle. */
  advance(ms: number): Promise<void>
}

/** A scheduler over rows set by hand, a clock moved by hand, and a system that rings
 *  (or not) and says what it was handed. */
function rig(system = true): Rig {
  let rows: Row[] = []
  let ready = true
  let now = NOW
  const listeners = new Set<() => void>()
  const timers: { at: number; run: () => void; live: boolean }[] = []
  const handed: Reminder[][] = []
  const rung: Reminder[][] = []
  const waiting: boolean[] = []

  const host: Host = {
    rows: () => rows,
    ready: () => ready,
    watch(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    auto: () => 0,
    now: () => now,
    hand(plan) {
      handed.push([...plan])
      return Promise.resolve(system)
    },
    ring: (plan) => rung.push([...plan]),
    waiting: (any) => waiting.push(any),
    later(run, ms) {
      const timer = { at: now + ms, run, live: true }
      timers.push(timer)
      return () => (timer.live = false)
    },
  }

  new Scheduler(host).start()

  const tell = () => {
    for (const listener of listeners) listener()
  }

  return {
    handed,
    rung,
    waiting,
    set(next) {
      rows = next
      tell()
    },
    ready(on) {
      ready = on
      tell()
    },
    async advance(ms) {
      const until = now + ms
      for (;;) {
        const due = timers
          .filter((one) => one.live && one.at <= until)
          .sort((a, b) => a.at - b.at)[0]
        if (!due) break
        due.live = false
        now = due.at
        due.run()
        await new Promise((go) => setTimeout(go, 0))
      }
      now = until
    },
  }
}

const call = (time: string) => rowsIn('W', 'P.md', `- [ ] Call [time:: ${time}] 📅 2026-10-06\n`)
const hours = (plans: Reminder[][]) =>
  plans.map((plan) => plan.map((one) => new Date(one.at).getHours()))

describe('Scheduler', () => {
  test('hands nothing until every space is read', async () => {
    const one = rig()
    one.ready(false)
    one.set(call('16:00'))
    await one.advance(QUIET)
    expect(one.handed).toEqual([])

    one.ready(true)
    await one.advance(QUIET)
    expect(hours(one.handed)).toEqual([[16]])
    expect(one.waiting.at(-1)).toBe(true)
  })

  test('a burst of changes is one plan, and the same plan is not handed twice', async () => {
    const one = rig()
    one.set(call('16:00'))
    one.set(call('16:00'))
    one.set(call('16:00'))
    await one.advance(QUIET)
    one.set(call('16:00'))
    await one.advance(QUIET)
    expect(one.handed).toHaveLength(1)
  })

  test('a moved task hands the new minute, a ticked one hands nothing', async () => {
    const one = rig()
    one.set(call('16:00'))
    await one.advance(QUIET)
    one.set(call('17:00'))
    await one.advance(QUIET)
    one.set(rowsIn('W', 'P.md', '- [x] Call [time:: 17:00] 📅 2026-10-06 ✅ 2026-10-04\n'))
    await one.advance(QUIET)

    expect(hours(one.handed)).toEqual([[16], [17], []])
    expect(one.waiting.at(-1)).toBe(false)
  })

  test('the system rings it, or else the page does', async () => {
    const system = rig(true)
    system.set(call('16:00'))
    await system.advance(QUIET)
    expect(system.rung).toEqual([[]])

    const page = rig(false)
    page.set(call('16:00'))
    await page.advance(QUIET)
    expect(hours(page.rung)).toEqual([[16]])
  })

  test('plans again once the first reminder has passed', async () => {
    const one = rig()
    one.set([
      ...rowsIn('W', 'A.md', '- [ ] First [remind:: 2026-10-04 12:30]\n'),
      ...rowsIn('W', 'B.md', '- [ ] Second [remind:: 2026-10-04 13:00]\n'),
    ])
    await one.advance(QUIET)
    expect(one.handed.at(-1)?.map((r) => r.title)).toEqual(['First', 'Second'])

    await one.advance(31 * 60_000)
    expect(one.handed.at(-1)?.map((r) => r.title)).toEqual(['Second'])
  })
})
