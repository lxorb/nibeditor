import { expect, test } from 'vitest'
import { candidates } from './kinds'
import { MOST, ranked } from './rank'
import { command, file, setting, visit, world } from './world.fixture'

/** What a keystroke in the palette costs over a big space.
 *
 *  Ten thousand files, three hundred commands, the history full at five hundred pages
 *  and a hundred settings: more than anybody's palette holds. Every keystroke scores
 *  every one of them once, and a query nothing matches as typed pays for a second pass
 *  that forgives a slip. Building the candidates - folding every name, weighing every
 *  use - is done once when the palette opens, not per keystroke.
 *
 *  On the machine this was written on, a Snapdragon X Elite, with the suite idle:
 *  opening 21 to 26 ms; a key 3 to 4 ms typing `lecture 12` a letter at a time, and
 *  14 ms for a word nothing has, which is the slip pass. The palette before this one,
 *  which listed notes and nothing else, took 6 to 8.5 ms a key over the same ten
 *  thousand notes, because it folded every name again on every key. The clock is asked
 *  only of a run that set `NIB_PERF=1`, for the reason search/fuzzy.perf.test.ts gives;
 *  the bound is generous, and a change of shape - work that grew with something other
 *  than the rows - misses it by far more than a busy machine does. */
const CLOCKED = process.env.NIB_PERF === '1'

const WORDS = ['plan', 'lecture', 'tax', 'notes', 'draft', 'ideas', 'meeting', 'journal']

const BIG = world({
  files: Array.from({ length: 10_000 }, (_, index) =>
    file(`Folder ${String(index % 40)}/${WORDS[index % WORDS.length] ?? ''} ${String(index)}.md`),
  ),
  commands: Array.from({ length: 300 }, (_, index) =>
    command(`c${String(index)}`, `Do the thing number ${String(index)}`),
  ),
  pages: Array.from({ length: 500 }, (_, index) =>
    visit(
      `https://site${String(index)}.example.com/page/${String(index)}`,
      `Page ${String(index)}`,
    ),
  ),
  settings: Array.from({ length: 100 }, (_, index) =>
    setting(`Setting ${String(index)}`, 'Editor', { names: ['word'] }),
  ),
})

/** Milliseconds per call, over a few calls. */
function timed(run: () => unknown, times = 5): number {
  const started = performance.now()
  for (let one = 0; one < times; one++) run()
  return (performance.now() - started) / times
}

test('opening builds every candidate once', () => {
  let built = candidates(BIG)
  const each = timed(() => (built = candidates(BIG)), 3)

  expect(built.length).toBe(10_000 + 300 + 500 + 100)
  if (CLOCKED) expect(each).toBeLessThan(150)
})

test('a keystroke scores every candidate once, and lists at most a screenful', () => {
  const all = candidates(BIG)
  const typing = 'lecture 12'
  let longest = 0

  for (let length = 1; length <= typing.length; length++) {
    const term = typing.slice(0, length)
    const each = timed(() => ranked(term, all))
    longest = Math.max(longest, each)
    expect(ranked(term, all).length).toBeLessThanOrEqual(MOST)
  }

  if (CLOCKED) expect(longest).toBeLessThan(60)
})

test('a word nothing has pays for one more pass, not more', () => {
  const all = candidates(BIG)
  const each = timed(() => ranked('qwertz', all))

  expect(ranked('qwertz', all)).toEqual([])
  if (CLOCKED) expect(each).toBeLessThan(120)
})
