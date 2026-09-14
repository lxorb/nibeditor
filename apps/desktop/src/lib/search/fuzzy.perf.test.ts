import { describe, expect, test } from 'vitest'
import { Fuzzy, fuzzyTerms, workDone } from './fuzzy'
import { fold, Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

/** What a loose search costs over a space of ten thousand notes.
 *
 *  Counted rather than timed. What a walk costs is the notes it folds, the lines
 *  it looks at, the terms it scores against them and the characters it reads, and
 *  each of those is the same number on a machine running the whole suite at once
 *  as on an idle one. A timing held against another timing is a proxy for those
 *  counts and a poor one: the suite runs several files over whatever cores are
 *  left, a walk that was descheduled halfway through says nothing about the walk,
 *  and two figures a fraction of a percent apart fail a test that has found
 *  nothing wrong.
 *
 *  What the counts say, in the order the tests say it: the loose pass folds
 *  nothing the exact pass in front of it has folded already, it looks at each
 *  line of the space once and no line twice, a second word is a second scoring of
 *  a line rather than a second walk of the space, a term the space has not got
 *  costs one pass and no scoring at all, and a walk given a line stops at the end
 *  of it.
 *
 *  One clock is left, on the worst case, with a wide margin around it, and it is
 *  asked only of a run that set `NIB_PERF=1`: a count cannot tell a walk that has
 *  got slower from one that has not, and a walk that has changed shape misses that
 *  margin by a factor of hundreds rather than by a percent - but a loaded machine
 *  misses it too, which is a failure about the machine. See `CLOCKED` below. The
 *  absolute figures, on the machine this was written on: 47.6 MB in
 *  10,000 notes, one loose term 128 ms, two loose terms 158 ms, and a term the
 *  space does not hold 6 ms. The browser's budget is 300 ms and it runs this in a
 *  worker; the crate has its own twin and its own tests. */

/** Whether the one clock may be asserted on at all.
 *
 *  The counts are the test and they are always checked: each of them is the same
 *  number on a machine running the whole suite at once as on an idle one. The
 *  clock is not - a walk descheduled halfway through says nothing about the walk,
 *  and this file failed a gate at 3.9 seconds with every count right. So the
 *  elapsed bound is asked only where somebody is measuring rather than checking:
 *  set `NIB_PERF=1` to turn it on, which is what a speed run does and what a run
 *  of the suite beside thirty other files does not.
 *
 *  It is a bound and not a measurement either way: what the walk actually took is
 *  in the figures at the top of this file, taken by hand on a quiet machine. */
const CLOCKED = process.env.NIB_PERF === '1'

/** The folded copy of a note, made when it is first wanted and counted.
 *
 *  `foldedOnce` from match.ts with a count around the fold itself, because what a
 *  test wants to know is how many times the note was folded and not how many
 *  times the copy was asked for. Notes are given one because that is how the app
 *  hands them over, and it is what keeps the two passes to one folded copy
 *  between them; see `searchRows` in web/search.ts. */
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

/** A space of ten thousand notes and about fifty megabytes of words, and how many
 *  of them have been folded.
 *
 *  Built out of a few paragraphs rather than out of random letters, so the lines
 *  are the length real lines are and the scorer walks over the mixture of hits
 *  and misses it would walk over in a space of notes. */
function corpus(): { notes: SearchNote[]; folds: () => number } {
  const paragraphs = [
    'The quarter plan came together on Monday, with a note about the budget.',
    'Beta wrote the meeting up and left the actions at the end of it.',
    'A canvas of the release, with the blockers arranged down the left.',
    'Reading the draft again, the second half is the half that works.',
    'Numbers for the month: seventeen open, four closed, one waiting.',
  ]

  const notes: SearchNote[] = []
  let folds = 0

  for (let index = 0; index < 10_000; index++) {
    const lines: string[] = [`# Note ${index}`, '']
    // Enough paragraphs that a note is about five kilobytes, which is a long
    // note rather than a short one.
    for (let line = 0; line < 70; line++) {
      lines.push(paragraphs[(index + line) % paragraphs.length] ?? '', '')
    }

    const body = lines.join('\n')

    notes.push({
      path: `/space/folder-${index % 50}/note-${index}.md`,
      relative: `folder-${index % 50}/note-${index}.md`,
      name: `note-${index}.md`,
      body,
      folded: shared(body, () => folds++),
    })
  }

  return { notes, folds: () => folds }
}

/** How many lines of a space have words on them, which is how many a loose walk
 *  has to look at. Counted the way the walk finds them, blank lines and all, so
 *  the number a test holds it to is the number of lines and not an idea of one. */
function withWords(notes: readonly SearchNote[]): number {
  let count = 0

  for (const note of notes) {
    let from = 0
    for (;;) {
      const broke = note.body.indexOf('\n', from)
      const end = broke === -1 ? note.body.length : broke
      if (end > from) count++
      if (broke === -1) break

      from = broke + 1
    }
  }

  return count
}

/** One walk of the whole space: what it did, how long it took, and how many notes
 *  answered loosely. */
function once(source: string, notes: readonly SearchNote[]) {
  const query = parseQuery(source)
  const matcher = new Matcher(query)
  const fuzzy = new Fuzzy(fuzzyTerms(query))

  // Whatever an earlier walk left counted, dropped, so what comes back is this
  // walk's own.
  workDone()
  const started = performance.now()
  let found = 0

  for (const note of notes) {
    // The walk the search does: a note the query answers is never scored
    // loosely, so the loose pass only ever sees the notes without a row.
    if (matcher.hits(note, 1).length) continue
    if (fuzzy.best(note)) found++
  }

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

describe('a loose search over ten thousand notes', () => {
  // Built once: it is fifty megabytes, and building it belongs to no one test.
  const { notes, folds } = corpus()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)
  const lines = withWords(notes)

  /** One loose term over the whole space, which is what the tests below are held
   *  against: every note folded by the pass in front of it, every line with words
   *  on it looked at, and the term scored against the lines its first letter
   *  reaches. Timed as well as counted, because the one clock in this file is
   *  on this walk. */
  const yardstick = timed('quater', notes)

  test('is a space of the size the figures are about', () => {
    expect(notes).toHaveLength(10_000)
    expect(bytes).toBeGreaterThan(45_000_000)
    expect(lines).toBe(710_000)
  })

  test('costs about what an exact one does, for a typo', () => {
    // Every note answers this one loosely, which is the worst case: every line
    // of the space is looked at rather than a note giving up early.
    const { ms, found, work } = yardstick

    expect(found).toBe(10_000)
    expect(work.notes).toBe(10_000)
    // What the loose pass adds to an exact search is the scoring and not a second
    // fold of the space: one fold a note, over both passes and every run above.
    expect(folds()).toBe(10_000)
    // Each line with words on it looked at once, and no line twice.
    expect(work.lines).toBe(lines)
    // A pass over the space and a little: the term's first letter is looked for
    // once over each note, and the letters after it only inside a line.
    expect(work.characters).toBeLessThan(bytes * 2)
    // The one clock, on the walk that costs the most, and fifteen times the
    // figure above rather than one and a half: the counts say what the walk did,
    // and this only has to catch a walk that has become a different shape. Asked
    // of a speed run and not of a gate; see `CLOCKED` above.
    if (CLOCKED) expect(ms).toBeLessThan(2_000)
  })

  test('and for two words, which is two scans of every line', () => {
    const { found, work } = once('quater plna', notes)

    expect(found).toBe(10_000)
    // The same lines looked at, and every line the first word reaches scored
    // twice. A second word is a second scoring of a line rather than a second
    // walk of the space.
    expect(work.lines).toBe(yardstick.work.lines)
    expect(work.terms).toBe(yardstick.work.terms * 2)
    // And short of twice the characters, because the second term's first letter
    // is looked for from where the cursor was left rather than from the top.
    expect(work.characters).toBeLessThan(yardstick.work.characters * 2)
  })

  test('and almost nothing for a word nothing holds, because it gives up', () => {
    // A letter missing from a note takes the note out before a line of it has
    // been scored, so a query that finds nothing is the cheapest kind rather
    // than the dearest.
    const { found, work } = once('zzzqx', notes)

    expect(found).toBe(0)
    expect(work.notes).toBe(10_000)
    expect(work.lines).toBe(0)
    expect(work.terms).toBe(0)
    // The space read once looking for a letter it has not got, and nothing else
    // at all: exactly its own size, not a character more.
    expect(work.characters).toBe(bytes)
  })
})

/** Four notes of nearly a megabyte each: a whole book, or years of a journal in
 *  one file. Long notes are where the difference between a walk that stops at the
 *  end of the line it was given and one that carries on to the end of the note is
 *  the difference between a search and a hang, because that difference grows with
 *  the square of the note. */
function longNotes(): { notes: SearchNote[]; folds: () => number } {
  const lines: string[] = []
  for (let line = 0; line < 12_000; line++) {
    lines.push('The meeting came together on Monday, with a note about the budget for it.')
  }

  const body = lines.join('\n')
  let folds = 0

  return {
    notes: Array.from({ length: 4 }, (_unused, index) => ({
      path: `/space/long-${index}.md`,
      relative: `long-${index}.md`,
      name: `long-${index}.md`,
      body,
      folded: shared(body, () => folds++),
    })),
    folds: () => folds,
  }
}

describe('a loose search over long notes', () => {
  const { notes, folds } = longNotes()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)
  const lines = withWords(notes)

  /** A term of letters the notes are full of, which is the walk doing its work:
   *  every place the first letter sits is tried, and the letters after it are
   *  found a few characters along. */
  const yardstick = once('ate', notes)

  test('is a corpus of the size the figures are about', () => {
    expect(notes[0]?.body.length).toBeGreaterThan(800_000)
    expect(lines).toBe(48_000)
    expect(folds()).toBe(4)
    expect(yardstick.work.lines).toBe(lines)
  })

  test('costs no more for a letter the note has not got after one it has', () => {
    // `a` sits on every line and `q` nowhere, so the walk fails on its second
    // letter once per line. Failing has to cost the line, not the rest of the
    // note: the walk is given a line and must stop at the end of it.
    const { found, work } = once('aqx', notes)

    expect(found).toBe(0)
    // The same lines, and one scoring apiece.
    expect(work.lines).toBe(yardstick.work.lines)
    expect(work.terms).toBe(work.lines)
    // Less than the term the notes are full of costs, and about the corpus read
    // once over. A walk that ran on to the end of the note would read a note's
    // length per line of it, which is this a thousand times.
    expect(work.characters).toBeLessThan(yardstick.work.characters)
    expect(work.characters).toBeLessThan(bytes * 2)
  })
})
