/** Matching a query loosely: the letters in order but not next to each other,
 *  so a typo or a half-remembered word still finds the line.
 *
 *  A term is matched against one line rather than against a whole note. Letters
 *  gathered from across a megabyte are not a match anybody meant, and a line is
 *  also what the panel shows, so the span that scored is the span it emphasises.
 *
 *  The score is fzf's shape: a run of letters next to each other is worth much
 *  more than the same letters apart, a letter that opens a word is worth more
 *  than one inside it, and a gap costs. Which of the several ways a term fits a
 *  line is the one that counts is settled by trying each place its first letter
 *  sits and keeping the best, so `rdm` prefers `read me` to `nerd model`.
 *
 *  fuzzy.rs is the twin of this on the Rust side, down to the cases its tests
 *  use. The desktop's notes are on disk behind the crate and the browser's are
 *  in front of it, so the scan has to live at both ends: two files that score
 *  the same way are the price of not sending a space of notes across the bridge
 *  on every keystroke.
 *
 *  Nothing here allocates per line. A note is folded once and then read through
 *  offsets, because a space of ten thousand notes is fifty megabytes and a
 *  string per line of it is the whole budget. */

import { fold, type Range, type SearchNote } from './match'
import type { Query } from './query'

/** What a matched letter is worth before any bonus, which is fzf's own base.
 *  It keeps a real match's score above zero, so a list cut short reads as the
 *  best of what was found rather than as a column of minus signs. */
const LETTER = 16

/** A letter next to the one before it. The big bonus, and deliberately worth
 *  more than a word start: a term found whole in one word has to beat the same
 *  letters picked one from each of six words, or `quater plan` would rank
 *  `q u a t e r and a plan` alongside `The quarter plan`. */
const RUN = 12

/** A letter that opens a word. What lets initials work: `rdm` finds `read me`
 *  by its word starts rather than by three letters in a row. Doubled for the
 *  first letter of the term, the way fzf weighs it, because where a term begins
 *  says more about the line than where it goes on. */
const START = 8
const FIRST = 2

/** What the first missing letter of a gap costs and what each one after it
 *  costs. Two rates rather than one, so a term broken in two places is worse
 *  than a term broken once by twice as much - fzf's weighting, and the reason
 *  `meting` finds `Meeting` rather than losing to a line that merely holds the
 *  letters. */
const GAP = 3
const GAP_ON = 1

/** Past this a gap is as bad as it gets. Without a floor a match near the end of
 *  a long line would score worse than one that is not a match at all. */
const WORST = 12

/** What ends a word, so the letter after it opens one. A newline is here
 *  because offsets are into the whole note: the first letter of a line opens a
 *  word like the first letter of the note does. */
const BOUNDARY = new Set([
  '\n',
  '\r',
  ' ',
  '\t',
  '/',
  '\\',
  '_',
  '-',
  '.',
  ',',
  ':',
  ';',
  '(',
  '[',
  '{',
  '#',
  '*',
  '>',
  '"',
  "'",
])

/** How much of a line is worth scoring. A line longer than this is a paragraph
 *  nobody wrapped, and the letters at its far end are not what the reader is
 *  pointing at. The panel cuts its preview at 200 for the same reason; this is
 *  wider, so a match just past the preview is still found. */
const SCORED = 400

/** How much of a matching line a row shows. The same cut the exact side makes,
 *  so two rows of one list are trimmed the same way. */
const SHOWN = 200

/** The same set as a table, read by character code. Asked once per matched
 *  letter over a whole space of notes, which is often enough that a lookup in a
 *  byte array is worth having over one in a set of strings. */
const ENDS = new Uint8Array(128)
for (const one of BOUNDARY) ENDS[one.charCodeAt(0)] = 1

const SMALL_A = 97
const SMALL_Z = 122
const ASCII = 128

/** What a loose walk did, counted. */
export interface Work {
  /** Notes it was asked about. */
  notes: number
  /** Lines of them it looked at, which is every line with words on it up to the
   *  one that answers the note. */
  lines: number
  /** Terms it scored against a line: a two-word query scoring one line is two of
   *  these, so what a second word costs is a number rather than a feeling. */
  terms: number
  /** Characters it read looking for a term's letters. The one that says a walk
   *  given a line stopped at the end of it: a walk that ran on to the end of the
   *  note instead reads a note's length per line of it, which is the quadratic
   *  this file is written to avoid and which shows up here as a factor of
   *  hundreds. The newlines the lines are found by are not in it; those are one
   *  pass over the note however the scoring goes. */
  characters: number
}

function nothing(): Work {
  return { notes: 0, lines: 0, terms: 0, characters: 0 }
}

const work = nothing()

/** What the walks since this was last asked did, and zero from here.
 *
 *  Here for fuzzy.perf.test.ts, which asserts these rather than a stopwatch: two
 *  timings held against each other say as much about the queue in front of the
 *  code as about the code, and a fraction of a percent of drift under a loaded
 *  machine fails a test that has found nothing wrong. A count is the same number
 *  on a busy machine as on an idle one. The counting itself is four adds over a
 *  pass that reads megabytes. */
export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

/** Whether `letter` is one with a small and a capital form, and is the small
 *  one. Reading the pair rather than a range, so it holds outside ASCII. */
function isLower(letter: string): boolean {
  return letter !== '' && letter === letter.toLowerCase() && letter !== letter.toUpperCase()
}

/** Whether the letter at `at` opens a word: the start of the note, a letter
 *  after something that ends a word, or a capital after a small letter, so
 *  `readMe` has two word starts. Read off the note as written, not the folded
 *  copy, which is why the fold keeps its length.
 *
 *  By code inside ASCII and by the pair of cases outside it. Both say the same
 *  thing; the first says it without turning two characters into four strings, and
 *  notes are mostly ASCII. */
function opens(body: string, at: number): boolean {
  if (at === 0) return true

  const before = body.charCodeAt(at - 1)
  if (before >= ASCII) return isLower(body.charAt(at - 1)) && !isLower(body.charAt(at))
  if (ENDS[before]) return true
  if (before < SMALL_A || before > SMALL_Z) return false

  const here = body.charCodeAt(at)
  return here >= ASCII ? !isLower(body.charAt(at)) : here < SMALL_A || here > SMALL_Z
}

/** Where a letter next sits at or after `from` in the whole note, or -1.
 *
 *  The one place a walk reads past the line it was given: a term's first letter
 *  is looked for over the note, and the cursor every caller keeps is what holds
 *  that to one pass over the note rather than one pass per line. */
function seek(folded: string, letter: string, from: number): number {
  const at = folded.indexOf(letter, from)
  work.characters += (at === -1 ? folded.length : at + letter.length) - from
  return at
}

/** Where a letter next sits between `cursor` and `to`, or -1.
 *
 *  Walked here rather than handed to `indexOf`, which takes a place to start from
 *  and none to stop at: a letter the rest of the note has not got is a walk of
 *  the rest of the note, and this runs once per line, which is the quadratic this
 *  file is written to avoid. A line is four hundred characters at most, so
 *  scanning the line is cheaper than scanning everything after it. */
function placeIn(folded: string, letter: string, cursor: number, to: number): number {
  if (letter.length === 1) {
    const code = letter.charCodeAt(0)
    for (let at = cursor; at < to; at++) {
      if (folded.charCodeAt(at) === code) return at
    }

    return -1
  }

  // A character written as a pair of code units, which `lettersOf` keeps whole.
  for (let at = cursor; at + letter.length <= to; at++) {
    if (folded.startsWith(letter, at)) return at
  }

  return -1
}

/** Where `term`'s letters sit in `folded`, starting at `at` and staying inside
 *  `to`: each letter at the first place it sits after the last. Null when one
 *  of them is not there.
 *
 *  Greedy is what makes this cheap, and the loop in `fitAt` is what makes it
 *  right: every place the first letter sits is tried, so the run the reader
 *  meant is among the ones weighed. */
function walk(letters: readonly string[], folded: string, at: number, to: number, out: number[]) {
  out.length = 1
  out[0] = at
  let cursor = at + 1

  for (let index = 1; index < letters.length; index++) {
    const letter = letters[index] ?? ''
    const found = placeIn(folded, letter, cursor, to)
    // Counted out here rather than inside the search, which is the hottest loop
    // in the file: what it read is where it stopped, or the rest of the line.
    work.characters += (found === -1 ? to : found + letter.length) - cursor
    if (found === -1) return false

    out.push(found)
    cursor = found + 1
  }

  return true
}

/** What one set of positions is worth.
 *
 *  Where in the line the term sits is deliberately not in the number. It is a
 *  tiebreak instead - `fitAt` keeps the earliest of the places that score alike -
 *  the way fzf settles it, because a penalty for sitting late in a line is a
 *  penalty on the second word of every two-word query, and that drowns out what
 *  the bonuses are trying to say. */
function worth(body: string, at: readonly number[]): number {
  let score = at.length * LETTER
  let previous = -2

  for (let index = 0; index < at.length; index++) {
    const position = at[index] ?? 0

    if (index > 0 && position === previous + 1) score += RUN
    else if (opens(body, position)) score += START * (index === 0 ? FIRST : 1)

    if (index > 0) score -= gap(position - previous - 1)
    previous = position
  }

  return score
}

/** What `missing` letters skipped between two matches cost. */
function gap(missing: number): number {
  if (missing <= 0) return 0

  const counted = Math.min(missing, WORST)
  return GAP + (counted - 1) * GAP_ON
}

/** The best a term does inside `body[.., to)`, given the note already folded, or
 *  null when its letters are not all there in order.
 *
 *  `first` is where the term's first letter next sits at or after the region; the
 *  caller keeps it, because looking it up per line is what turns a long note into
 *  a quadratic one. `next` in the answer is the position it stopped at, so the
 *  caller's next line starts from there rather than from its own beginning.
 *
 *  `kept` is where the winning positions are left, and `tried` is scratch. Both
 *  belong to the caller and are reused down a whole note: this runs once per line
 *  per term over a space of notes, and two arrays a call is most of what a loose
 *  search would spend. */
function fitAt(
  letters: readonly string[],
  body: string,
  folded: string,
  to: number,
  first: number,
  kept: number[],
  tried: number[],
): { score: number; next: number } | null {
  work.terms += 1
  let score: number | null = null
  let at = first
  let next = first

  while (at !== -1 && at < to) {
    // No fit from here means none from any later start either: a later one has
    // fewer letters left in front of it.
    if (!walk(letters, folded, at, to, tried)) break

    const worthIt = worth(body, tried)
    // Strictly better, so the earliest of the places that score alike is the one
    // kept; see `worth`.
    if (score === null || worthIt > score) {
      score = worthIt
      kept.length = 0
      for (const one of tried) kept.push(one)
    }

    at = seek(folded, letters[0] ?? '', at + 1)
    next = at
  }

  return score === null ? null : { score, next }
}

/** One term against one line: where it sat and what that was worth. What the
 *  scorer's own tests measure, so the ranking rules are checked without a note
 *  around them. */
export function fit(term: string, line: string): { score: number; ranges: Range[] } | null {
  const letters = lettersOf(term)
  if (!letters.length) return null

  const text = line.length > SCORED ? line.slice(0, SCORED) : line
  const folded = fold(text)
  const first = seek(folded, letters[0] ?? '', 0)
  if (first === -1) return null

  const kept: number[] = []
  const found = fitAt(letters, text, folded, text.length, first, kept, [])
  return found ? { score: found.score, ranges: ranges(kept) } : null
}

/** A term as the single characters the walk looks for, folded. Cut up once
 *  rather than per walk: `charAt` makes a string of one letter, and over a space
 *  of notes that is hundreds of thousands of them. */
function lettersOf(term: string): string[] {
  // Whole characters, so a term holding one written as a pair of code units is
  // looked for as that character rather than as half of it.
  return Array.from(fold(term))
}

/** Positions next to each other gathered into the ranges the panel marks. */
function ranges(at: readonly number[]): Range[] {
  const out: Range[] = []

  for (const position of at) {
    const last = out.at(-1)
    if (last?.to === position) last.to = position + 1
    else out.push({ from: position, to: position + 1 })
  }

  return out
}

/** The bare words of a query, folded, when the query is one loose matching can
 *  be asked about at all.
 *
 *  Nothing is relaxed that the reader asked to be exact. A phrase in quotes, a
 *  `/re/`, a `-` that excludes, an `OR`, a nearness group, `content:` and `case:`
 *  are each somebody being precise, and a loose answer under a precise question is
 *  noise. What is left - bare words, with `path:` `file:` `tag:` and `[key]`
 *  narrowing them - is the ordinary search, and the one a typo lands in. */
export function fuzzyTerms(query: Query): string[] {
  const out: string[] = []
  return gather(query, out) ? out : []
}

/** Fills `out` while the query is still one that can be relaxed. A quoted
 *  phrase and a bare word are both `text` to the parser; the space in one is
 *  what tells them apart. */
function gather(query: Query, out: string[]): boolean {
  switch (query.kind) {
    case 'all':
      return query.of.every((one) => gather(one, out))

    case 'text': {
      if (!query.fold || /\s/.test(query.text)) return false

      out.push(fold(query.text))
      return true
    }

    // These ask about the note rather than about its words, so they go on
    // asking exactly while the words beside them are relaxed.
    case 'path':
    case 'file':
    case 'tag':
    case 'property':
      return true

    // `content:` is somebody saying where to look, and a loose answer under it
    // would be a word the note does not hold, found outside the body they asked
    // about. So it is exact, like the rest of these.
    case 'content':
    case 'any':
    case 'not':
    case 'regex':
    case 'scope':
      return false
  }
}

/** The same query with its bare words taken out: what a note has to answer
 *  before its lines are worth scoring. `path:` and its kind stay, so a narrowed
 *  search stays narrowed; a query of nothing but words becomes the empty `all`,
 *  which every note answers. */
export function withoutWords(query: Query): Query {
  if (query.kind === 'text') return { kind: 'all', of: [] }
  if (query.kind !== 'all') return query

  return { kind: 'all', of: query.of.filter((one) => one.kind !== 'text').map(withoutWords) }
}

/** A note's best loose line, ready for a row in the panel. The same shape the
 *  exact side sends, with the score that ordered it. */
export interface FuzzyHit {
  path: string
  name: string
  line: number
  text: string
  ranges: Range[]
  score: number
}

/** A query's loose terms, asked about one note at a time.
 *
 *  Built once per search, with the terms already folded, so a space of ten
 *  thousand notes folds a handful of words rather than folding them ten
 *  thousand times. */
export class Fuzzy {
  /** Each term as the single characters the walk looks for; see `lettersOf`. */
  private readonly words: string[][]

  constructor(terms: readonly string[]) {
    this.words = terms.map(lettersOf).filter((one) => one.length > 0)
  }

  get asks(): boolean {
    return this.words.length > 0
  }

  /** The note's best line, or null when no single line holds every term.
   *
   *  One line rather than all of them: a loose match is a guess, and a guess is
   *  worth one row. A note that deserves more rows is one the exact search has
   *  already found. */
  best(note: SearchNote): FuzzyHit | null {
    const words = this.words
    if (!words.length) return null

    work.notes += 1
    const body = note.body
    // The copy the exact pass already made, when it made one; see `foldedOnce`
    // in match.ts. Folding a space of notes twice over was most of what a loose
    // search spent.
    const folded = note.folded?.() ?? fold(body)

    // Where each term's first letter next sits. Only ever moves forward, so
    // the whole note costs one pass per term rather than one pass per line.
    const next: number[] = []
    for (const letters of words) {
      const at = seek(folded, letters[0] ?? '', 0)
      // A letter the note does not hold at all takes the note out before a
      // single line of it has been scored.
      if (at === -1) return null
      next.push(at)
    }

    let bestScore = 0
    let bestLine = -1
    let bestFrom = 0
    let bestEnd = 0
    let bestPositions: number[] = []

    // Indexed loops and arrays reused down the whole note, rather than the
    // iterators and the fresh arrays a line at a time would read better as. The
    // lines are walked rather than gathered first, for the same reason: a space of
    // ten thousand notes is a million and a half lines, and an array of where each
    // one starts is a million and a half numbers written down to be read once.
    const positions: number[] = []
    const kept: number[] = []
    const tried: number[] = []

    let line = 0
    let from = 0
    /** Set when a term's first letter has run out for the rest of the note, so
     *  no later line can hold every term and the note is answered. */
    let gone = false

    while (from <= body.length) {
      const broke = folded.indexOf('\n', from)
      const end = broke === -1 ? body.length : broke

      if (end > from) {
        work.lines += 1
        const to = end - from > SCORED ? from + SCORED : end
        positions.length = 0
        let score = 0
        let all = true

        for (let which = 0; which < words.length; which++) {
          const letters = words[which] ?? []
          let at = next[which] ?? -1

          if (at < from) {
            at = seek(folded, letters[0] ?? '', from)
            if (at === -1) {
              gone = true
              all = false
              break
            }
            next[which] = at
          }

          if (at >= to) {
            all = false
            break
          }

          const found = fitAt(letters, body, folded, to, at, kept, tried)
          if (!found) {
            all = false
            break
          }

          next[which] = found.next === -1 ? body.length : found.next
          score += found.score
          for (const one of kept) positions.push(one)
        }

        if (all && (bestLine === -1 || score > bestScore)) {
          bestScore = score
          bestLine = line
          bestFrom = from
          bestEnd = end
          // Copied only when this line is the best so far, which is rare.
          bestPositions = positions.slice()
        }

        if (gone) break
      }

      if (broke === -1) break
      from = broke + 1
      line++
    }

    if (bestLine === -1) return null
    return this.row(note, bestLine, bestFrom, bestEnd, bestScore, bestPositions)
  }

  /** The line as a row shows it, with the marks moved to where trimming left
   *  them. The exact side's `row` does the same for its own hits, cutting at
   *  the same place, so one list reads as one list. */
  private row(
    note: SearchNote,
    line: number,
    from: number,
    end: number,
    score: number,
    positions: readonly number[],
  ): FuzzyHit {
    const raw = note.body.slice(from, end)
    const lead = raw.length - raw.trimStart().length
    const text = Array.from(raw.trim()).slice(0, SHOWN).join('')

    const moved: Range[] = []
    for (const range of ranges([...positions].sort((a, b) => a - b))) {
      const start = Math.max(range.from - from - lead, 0)
      const end = Math.min(range.to - from - lead, text.length)
      if (start >= end) continue

      const last = moved.at(-1)
      if (last && last.to >= start) last.to = Math.max(last.to, end)
      else moved.push({ from: start, to: end })
    }

    return { path: note.path, name: note.name, line, text, ranges: moved, score }
  }
}
