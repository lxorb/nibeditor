import { describe, expect, test } from 'vitest'
import { fold, Matcher, type SearchNote, workDone } from './match'
import { parseQuery } from './query'

/** What `line:` `block:` and `section:` cost over long notes.
 *
 *  Counted rather than timed, for the reason fuzzy.perf.test.ts gives beside its
 *  own counts: the suite runs several files over whatever cores are left, a walk
 *  that was descheduled halfway through says nothing about the walk, and a
 *  yardstick of a millisecond and a half held against a walk of sixty is two
 *  figures whose distance apart says more about the machine than about the code.
 *  What a walk costs is the notes it folds, the regions it is asked about, the
 *  times it looks for a needle and the characters those looks read, and every one
 *  of those is the same number on a busy machine as on an idle one.
 *
 *  A scoped query runs the same walk once per region, and a walk that looks for
 *  its needle again in every one of them is a walk of the note per line of it.
 *  That is the whole question here, and the counts answer it in one number: a
 *  group asked about forty thousand lines looks for its word twenty times, once a
 *  note. The notes are long on purpose, because that is the shape where the
 *  difference between one look and one per line is the difference between a
 *  search and a hang.
 *
 *  One clock is left, on the heaviest of them, with a wide margin around it, and
 *  it is asked only of a run that set `NIB_PERF=1`: a count cannot tell a walk
 *  that has got slower from one that has not, and a walk that looks per line
 *  misses that margin by a factor of hundreds - but a loaded machine misses it
 *  too, which is a failure about the machine. The absolute figures, on the machine
 *  this was written on: 3.4 MB in 20 notes, and the heaviest walk 28 ms. */

/** Whether the one clock may be asserted on at all: `NIB_PERF=1` says somebody is
 *  measuring rather than checking. The counts below are always checked, because a
 *  count is the same number on a loaded machine and an idle one; see `CLOCKED` in
 *  fuzzy.perf.test.ts, which is where the whole of the reasoning is. */
const CLOCKED = process.env.NIB_PERF === '1'

/** The folded copy of a note, made when it is first wanted and counted.
 *
 *  `foldedOnce` with a count around the fold itself, because what a test wants to
 *  know is how many times the note was folded and not how many times the copy was
 *  asked for. Notes are given one because that is how the app hands them over;
 *  see `searchRows` in web/search.ts. */
function shared(body: string, count: () => void): () => string {
  let made: string | null = null

  return () => {
    if (made === null) {
      count()
      made = fold(body)
    }

    return made
  }
}

/** Twenty long notes: two thousand lines of about a hundred characters each, so
 *  a note is a couple of hundred kilobytes - a book chapter, or a year of a
 *  journal in one file. With the folds they have been given counted. */
function corpus(): { notes: SearchNote[]; folds: () => number } {
  const lines: string[] = []
  for (let line = 0; line < 2_000; line++) {
    lines.push(
      `The quarter plan came together on Monday, with a note about the budget for line ${line}.`,
    )
  }

  const body = lines.join('\n')
  let folds = 0

  return {
    notes: Array.from({ length: 20 }, (_unused, index) => ({
      path: `/space/note-${index}.md`,
      relative: `note-${index}.md`,
      name: `note-${index}.md`,
      body,
      folded: shared(body, () => folds++),
    })),
    folds: () => folds,
  }
}

/** How many lines the corpus has, which is how many regions a `line:` group is
 *  asked about. Counted the way `lineStarts` finds them. */
function lineCount(notes: readonly SearchNote[]): number {
  let count = 0

  for (const note of notes) {
    count += 1
    for (let at = note.body.indexOf('\n'); at !== -1; at = note.body.indexOf('\n', at + 1)) {
      count += 1
    }
  }

  return count
}

/** One walk of the whole corpus: what it did, how long it took, and how many
 *  notes answered. */
function once(source: string, notes: readonly SearchNote[]) {
  const matcher = new Matcher(parseQuery(source))

  // Whatever an earlier walk left counted, dropped, so what comes back is this
  // walk's own.
  workDone()
  const started = performance.now()
  let found = 0
  for (const note of notes) found += matcher.hits(note, 1).length

  return { ms: performance.now() - started, found, work: workDone() }
}

/** How many walks to time. */
const RUNS = 3

/** The fastest of a few walks, which is the one least interrupted.
 *
 *  Only the single clock below asks for this. What a walk counted is the same
 *  every run, so every other walk here is walked once. */
function timed(source: string, notes: readonly SearchNote[]) {
  let best = once(source, notes)
  for (let run = 1; run < RUNS; run++) {
    const one = once(source, notes)
    if (one.ms < best.ms) best = one
  }

  return best
}

describe('a scoped search over long notes', () => {
  // Built once: it belongs to no one test.
  const { notes, folds } = corpus()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)
  const lines = lineCount(notes)

  /** One pass over the words for a term nothing holds, asked about the whole note
   *  rather than about its lines: the cheapest a search gets, and what the scoped
   *  walks below are held against. */
  const yardstick = once('zqx', notes)

  test('is a corpus of the size the figures are about', () => {
    expect(notes[0]?.body.length).toBeGreaterThan(150_000)
    expect(lines).toBe(40_000)
    // One fold a note, over every walk in this file.
    expect(folds()).toBe(20)
    // The floor: no region asked about, one look for the word a note, and the
    // notes read once between them.
    expect(yardstick.work.regions).toBe(0)
    expect(yardstick.work.needles).toBe(notes.length)
    expect(yardstick.work.characters).toBe(bytes)
  })

  test('costs one pass for a word nothing holds, not one per line', () => {
    const { found, work } = once('line:(zqx)', notes)

    expect(found).toBe(0)
    // Every line of every note asked about, which is what `line:` means.
    expect(work.regions).toBe(lines)
    // And the word looked for once a note all the same. The places it sits are
    // found from the top of the note and every region reads them, so forty
    // thousand regions cost the twenty looks the yardstick cost.
    expect(work.needles).toBe(yardstick.work.needles)
    expect(work.characters).toBe(yardstick.work.characters)
  })

  test('and one pass for a word every line holds', () => {
    const { ms, found, work } = timed('line:(quarter budget)', notes)

    expect(found).toBe(20)
    expect(work.regions).toBe(lines)
    // Two words, so two looks a note, and still not one a line: a word on every
    // line is the case where looking again per region would read the note forty
    // thousand times over.
    expect(work.needles).toBe(notes.length * 2)
    expect(work.characters).toBe(bytes * 2)
    // The one clock, on the walk that costs the most, and thirty times the figure
    // in the note above rather than one and a half: the counts say what the walk
    // did, and this only has to catch a walk that has become a different shape.
    // Asked of a speed run and not of a gate; see `CLOCKED` above.
    if (CLOCKED) expect(ms).toBeLessThan(1_000)
  })

  test('and for a paragraph, which is the same walk over fewer regions', () => {
    const { work } = once('block:(zqx)', notes)

    // A note with no blank line in it is one paragraph, so the same walk is asked
    // about a region a note rather than a region a line.
    expect(work.regions).toBe(notes.length)
    expect(work.regions).toBeLessThan(lines)
    // And the same walk it is: one look for the word a note, as above.
    expect(work.needles).toBe(yardstick.work.needles)
    expect(work.characters).toBe(yardstick.work.characters)
  })
})
