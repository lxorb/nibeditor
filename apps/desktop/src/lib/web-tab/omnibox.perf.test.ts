import { expect, test } from 'vitest'
import { completion, suggested } from './omnibox'
import { MOST_VISITS, type Visit } from './visits'

/** What a keystroke in the address field costs with the history full.
 *
 *  Both halves run on every key: the rest of the address in the field and the pages
 *  under it. The history is bounded (see visits.ts), so the worst case is a full one,
 *  and this types an address a letter at a time into it. On the machine this was
 *  written on, a Snapdragon X Elite: 500 rows, 0.35 ms a key over the whole address with
 *  the first key's work - every row's parts - in it, and 0.3 ms a key once warm.
 *
 *  The clock is asked only of a run that set `NIB_PERF=1`, for the reason
 *  search/fuzzy.perf.test.ts gives: a loaded machine misses a bound for reasons that
 *  are about the machine. The bound is a frame's worth, which a change of shape - a
 *  scan that grew with something other than the rows - misses by far more than that. */
const CLOCKED = process.env.NIB_PERF === '1'

const NOW = Date.UTC(2026, 8, 27)

const full: Visit[] = Array.from({ length: MOST_VISITS }, (_, index) => ({
  url: `https://site${String(index)}.example.com/section/${String(index)}/page?id=${String(index)}`,
  title: `Page number ${String(index)} of a site somebody reads`,
  visits: 1 + (index % 7),
  typed: index % 3,
  last: NOW - index * 60_000,
}))

test('a keystroke with the history full is a frame at most', () => {
  const address = 'site499.example.com/section/4'
  const started = performance.now()

  for (let length = 1; length <= address.length; length++) {
    const typed = address.slice(0, length)
    completion(full, typed, NOW)
    suggested(full, typed, NOW)
  }

  const each = (performance.now() - started) / address.length

  expect(completion(full, address, NOW)?.url).toBe(
    'https://site499.example.com/section/499/page?id=499',
  )
  if (CLOCKED) expect(each).toBeLessThan(16)
})
