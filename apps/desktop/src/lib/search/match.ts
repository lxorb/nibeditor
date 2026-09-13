/** Running a parsed query over one note: whether it answers, and where.
 *
 *  Every operator answers with the places it matched rather than with a yes,
 *  which is what lets a hit emphasise the words that were found and what lets
 *  a replacement know exactly what to put back. An operator that asks about
 *  the note rather than its words - `path:`, `file:`, `tag:`, `[key]` - answers
 *  with no places at all, so a note found only by its name still counts as
 *  found and simply has nothing to underline.
 *
 *  A term is looked for inside a region, and `line:` `block:` `section:` are
 *  nothing more than the same walk over a smaller one. That is the whole of
 *  nearness here: one recursion, no second pass.
 *
 *  query.rs is the twin of this on the Rust side, and match.test.ts holds the
 *  two to the same answers. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { taskAt } from '@nib/markdown/tasks'
import { isEmpty, type Query, type Unit } from './query'
import { tagsIn } from './tags'

export interface SearchNote {
  /** What opening the hit asks for: the note's path as this machine spells it. */
  path: string
  /** How `path:` reads the note: relative to the space, `/`-separated. */
  relative: string
  name: string
  body: string
  /** The body folded, made the first time it is asked for and then kept; see
   *  `foldedOnce`. A note walked by both the exact pass and the loose one is
   *  given this so the two share one copy, because folding a space of ten
   *  thousand notes twice over is most of what a loose search would spend.
   *  Absent for a note nobody offered it to, which folds its own. */
  folded?: (() => string) | undefined
  /** Where every line of the note starts, made the first time it is asked for
   *  and then kept; see `startsOnce`. A `line:` `block:` `section:` or `task:`
   *  group asks for it, and so does every hit that becomes a row, so a note the
   *  search field asks about on every keystroke would otherwise be walked for its
   *  newlines once per keystroke. Made the same way the fold is, and kept beside
   *  it; see `Held` in web/space-cache.ts and `Facts::starts` in matcher.rs, which
   *  is a `OnceCell` for the same reason. Absent for a note nobody offered one,
   *  which counts its own. */
  starts?: (() => readonly number[]) | undefined
}

/** A note's folded text, made when it is first wanted and then the same string
 *  every time after. Lazy rather than folded up front, because a query that asks
 *  only about a note's path or its tags never looks at a letter of it. */
export function foldedOnce(body: string): () => string {
  let made: string | null = null
  return () => (made ??= fold(body))
}

export interface Range {
  from: number
  to: number
}

/** Where one match sits, and what a `/re/` caught on the way, so a replacement
 *  can put `$1` back. */
export interface Span extends Range {
  groups?: readonly string[]
}

export interface Hit {
  path: string
  name: string
  line: number
  /** Which page of a paper the row is, counting from one, and absent for a note.
   *  What says a row opens a PDF rather than a note; see pdf/papers.ts. A paper's
   *  words are not on disk as text, so nothing on the other side of the bridge
   *  sends one of these. */
  page?: number
  /** The line as a row shows it: trimmed, and cut short. */
  text: string
  /** Where in `text` the match sits. Empty for a note found by its path, its
   *  name or a tag, which no line of it says. */
  ranges: Range[]
  /** What a loose match was worth, when the hit is one; see fuzzy.ts. Absent on
   *  a hit that answers the query exactly, which is what tells the two apart in
   *  the list and what keeps an exact hit's shape unchanged on the wire. */
  score?: number
}

/** How much of a matching line is worth showing. The Rust side cuts here too. */
const LINE = 200

const HEADING = /^ {0,3}#{1,6}(\s|$)/

/** What a walk over a note did, counted. */
export interface Work {
  /** Notes it was asked about. */
  notes: number
  /** Regions of them a `line:` `block:` or `section:` group was asked about, so
   *  what asking per line adds is a number rather than a feeling. */
  regions: number
  /** Times a needle was looked for over a note. One per needle per note is the
   *  whole point of `placesIn`: a group that asks about every line asks about
   *  the same needle in every one of them, and looking again per region is the
   *  quadratic this file is written to avoid. */
  needles: number
  /** Characters read looking for a needle, which is a note's length per look. A
   *  `/re/` is the engine's own walk and is not counted here. */
  characters: number
}

function nothing(): Work {
  return { notes: 0, regions: 0, needles: 0, characters: 0 }
}

const work = nothing()

/** What the walks since this was last asked did, and zero from here.
 *
 *  Here for match.perf.test.ts, which asserts these rather than a stopwatch, for
 *  the reason fuzzy.ts gives beside its own: a walk held against a timing of
 *  another walk fails when the machine was busy for one of them and not for the
 *  other, and a count is the same number either way. */
export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

/** Lowercase without changing the length, so an offset in the folded text is
 *  the same offset in the note. A handful of letters lowercase into two - the
 *  Turkish dotted capital I among them - and those are left as they are rather
 *  than shifting every match after them by one.
 *
 *  Lowercasing never shortens a letter, so a note that came back the length it
 *  went in is one where every letter kept its own. That is the ordinary case,
 *  and it costs a single call rather than a pass letter by letter, which over
 *  the megabytes a space of notes comes to is most of what a search would
 *  otherwise spend. */
export function fold(text: string): string {
  const lowered = text.toLowerCase()
  if (lowered.length === text.length) return lowered

  let out = ''
  for (const letter of text) {
    const lower = letter.toLowerCase()
    out += lower.length === letter.length ? lower : letter
  }

  return out
}

/** Where every line of a note starts. Built once per note that has a hit. */
export function lineStarts(body: string): number[] {
  const starts = [0]
  for (let at = body.indexOf('\n'); at !== -1; at = body.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }

  return starts
}

/** Which line an offset is on. A search rather than a walk, because a replace
 *  asks it once per match and a note can be long. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }

  return low
}

/** Which tasks a unit asks for, and nothing for a unit that is not a task at all.
 *  The twin of `Wanted` in matcher.rs, which says the same three words. */
const A_TASK: Partial<Record<Unit, 'any' | 'todo' | 'done'>> = {
  task: 'any',
  'task-todo': 'todo',
  'task-done': 'done',
}

/** The regions a group of terms looks inside: a line, a paragraph, a heading's
 *  section, or a task item. */
function unitsIn(body: string, starts: readonly number[], unit: Unit): Range[] {
  const ends = starts.map((_start, index) => {
    const next = starts[index + 1]
    return next === undefined ? body.length : next - 1
  })

  if (unit === 'line') {
    return starts.map((from: number, index: number) => ({ from, to: ends[index] ?? body.length }))
  }

  const state = A_TASK[unit]
  if (state) {
    const found: Range[] = []

    for (const [index, start] of starts.entries()) {
      const end = ends[index] ?? body.length
      const task = taskAt(body.slice(start, end))
      if (!task) continue
      if (state === 'todo' && task.done) continue
      if (state === 'done' && !task.done) continue

      // The task's own words, not its marker, so `task-done:x` does not answer
      // itself out of the box every done task carries.
      found.push({ from: start + task.marker, to: end })
    }

    return found
  }

  const out: Range[] = []
  let open: number | null = null

  const close = (to: number) => {
    if (open !== null) out.push({ from: open, to })
    open = null
  }

  for (const [index, start] of starts.entries()) {
    const end = ends[index] ?? body.length
    const text = body.slice(start, end)

    if (unit === 'block') {
      // A paragraph is what blank lines leave between them.
      if (text.trim() === '') close(ends[index - 1] ?? start)
      else open ??= start
      continue
    }

    // A section runs from a heading to the next one, and whatever comes before
    // the first heading is a section of its own.
    if (HEADING.test(text)) {
      close(ends[index - 1] ?? start)
      open = start
    } else open ??= start
  }

  close(body.length)
  return out
}

/** Front matter as a map, for `[key]` and `[key:value]`.
 *
 *  The block is front-matter.ts's to find, rather than found a second time here:
 *  a block nobody closed is a note that opens with a rule, so `[status:done]`
 *  answers for exactly the notes whose properties table shows that row. Found
 *  twice, the operator and the table were reading two different notes.
 *
 *  The plain `key: value` lines and nothing else. A value written as a list
 *  underneath its key is left out: reading YAML properly is a parser, and the
 *  operator is worth a few lines, not a dependency. */
function frontMatter(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const block = frontMatterBlock(body)
  if (!block) return out

  for (const line of body.slice(block.body.from, block.body.to).split('\n')) {
    if (/^\s/.test(line)) continue

    const colon = line.indexOf(':')
    if (colon <= 0) continue

    out.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }

  return out
}

/** What one note costs to answer about, worked out the first time it is asked
 *  for and not at all when the query never asks. */
interface Facts {
  note: SearchNote
  folded: string | null
  /** Where every line starts, from the note's own kept copy where it offered
   *  one; see `SearchNote.starts`. */
  starts: readonly number[] | null
  tags: string[] | null
  front: Map<string, string> | null
  /** Where the note's own words start; see `wordsIn`. */
  words: number | null
  units: Partial<Record<Unit, Range[]>>
  /** Where each needle sits in the note, by the needle and which text it was
   *  looked for in; see `placesIn`. */
  places: Map<string, number[]>
}

function foldedOf(facts: Facts): string {
  // The note's own copy when it was given one, so the loose pass that follows
  // this one folds nothing; see `foldedOnce`.
  return (facts.folded ??= facts.note.folded?.() ?? fold(facts.note.body))
}

function startsOf(facts: Facts): readonly number[] {
  return (facts.starts ??= facts.note.starts?.() ?? lineStarts(facts.note.body))
}

function tagsOf(facts: Facts): string[] {
  return (facts.tags ??= tagsIn(facts.note.body).map((tag) => tag.slice(1).toLowerCase()))
}

function frontOf(facts: Facts): Map<string, string> {
  return (facts.front ??= frontMatter(facts.note.body))
}

/** Where the note's own words start: past its front matter block, or the top of
 *  the note where there is none.
 *
 *  What `content:` narrows to. `pastFrontMatter` below answers the same question
 *  in lines, for the row a note found by something no line of it says falls back
 *  to; a region is offsets, so this one is an offset. matcher.rs has both. */
function wordsIn(body: string): number {
  // A block nobody closed is a note that opens with a rule, so its words start
  // where the note does; front-matter.ts is what decides that, here as everywhere.
  return frontMatterBlock(body)?.to ?? 0
}

function wordsFrom(facts: Facts): number {
  return (facts.words ??= wordsIn(facts.note.body))
}

function unitsOf(facts: Facts, unit: Unit): Range[] {
  return (facts.units[unit] ??= unitsIn(facts.note.body, startsOf(facts), unit))
}

/** What a front matter value looks like it is, as far as holding two of them
 *  against each other needs.
 *
 *  The two shapes are properties.ts's, which is what draws the same values as a
 *  table, so a value the table calls a number is a number here too. Not a full
 *  ISO parse, for the reason it gives: what this has to tell apart is a date from
 *  a word. matcher.rs holds the same two. */
const A_NUMBER = /^-?\d+(?:\.\d+)?$/
const A_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/

/** Which of two values comes first, as -1, 0 or 1.
 *
 *  Numbers as numbers. Dates as the words they are written in, which for a date
 *  written this way round is the same answer and a shorter road to it: no clock,
 *  no zone, and no chance of the Rust side arriving somewhere else. Everything
 *  else as words, folded, which is what makes a date held against a number fall
 *  back to something rather than comparing an epoch against five. */
function order(value: string, asked: string): number {
  const one = value.trim()
  const other = asked.trim()

  if (A_NUMBER.test(one) && A_NUMBER.test(other)) {
    const here = Number(one)
    const there = Number(other)
    return here < there ? -1 : here > there ? 1 : 0
  }

  const dates = A_DATE.test(one) && A_DATE.test(other)
  const left = dates ? one.replace(' ', 'T') : one.toLowerCase()
  const right = dates ? other.replace(' ', 'T') : other.toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

/** Whether the note's value answers what the query asked of it. */
function heldAgainst(value: string, query: Extract<Query, { kind: 'property' }>): boolean {
  const asked = query.value
  // `[key]` on its own: the note has it, and that was the whole question.
  if (asked === null) return true

  switch (query.compare) {
    case 'has':
      return contains(value, asked, true)
    case 'is':
      return value.trim().toLowerCase() === asked.trim().toLowerCase()
    case 'lt':
      return order(value, asked) < 0
    case 'lte':
      return order(value, asked) <= 0
    case 'gt':
      return order(value, asked) > 0
    case 'gte':
      return order(value, asked) >= 0
    case 'range':
      return order(value, asked) >= 0 && order(value, query.upto ?? asked) <= 0
    // Answered before this is reached, since a key that is not there has no value
    // to hold against anything.
    case 'null':
      return false
  }
}

/** Which line the note's words start on: the one after the front matter block,
 *  or the first line where there is none.
 *
 *  For the row a note found by something no line of it says falls back to. The
 *  block's own lines are metadata, and its fences are three hyphens: either would
 *  be a row that reads as nothing. matcher.rs counts the same way. */
function pastFrontMatter(body: string, starts: readonly number[]): number {
  // front-matter.ts finds the block here too. A block nobody closed is not a
  // block, so the note starts where it starts.
  const block = frontMatterBlock(body)
  if (!block) return 0

  // The first line beginning after the one the closing fence is on, and the end of
  // the note where that fence is the last line of it.
  const past = starts.findIndex((start) => start > block.close)
  return past === -1 ? starts.length : past
}

/** Whether a short string holds another. Plain lowercasing rather than the
 *  length-preserving fold above: nothing here is an offset into a note, so a
 *  letter that lowercases into two may as well do so. */
function contains(hay: string, needle: string, folded: boolean): boolean {
  return folded ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle)
}

/** Every place a needle sits in the whole note, without overlapping itself,
 *  found once however many regions go on to ask about it.
 *
 *  Once is the point. `line:(word)` asks about every line, and `indexOf` takes a
 *  place to start from but none to stop at, so looking again per line means
 *  scanning from that line to the next place the word appears - the end of the
 *  note, for a word the note does not hold. That is one walk of the note per
 *  line of it, which is what turns a long note into a quadratic one. The loose
 *  side already refuses to spend it; see fuzzy.ts.
 *
 *  A needle holds no newline, so a place is inside exactly one line and the
 *  places found from the top of the note are the places every region would have
 *  found for itself. */
function placesIn(facts: Facts, hay: string, needle: string, folded: boolean): number[] {
  const key = `${folded ? 'i' : ' '}${needle}`
  const held = facts.places.get(key)
  if (held) return held

  // One look over the note, and the whole of it: every one of these steps starts
  // where the last stopped, and the last of them reads to the end.
  work.needles += 1
  work.characters += hay.length

  const found: number[] = []
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    found.push(at)
  }

  facts.places.set(key, found)
  return found
}

/** The first place at or after `from`, by halving rather than by walking: a note
 *  where a common word sits on every line has as many places as lines, and
 *  walking them per line would be the quadratic this file just avoided. */
function firstFrom(places: readonly number[], from: number): number {
  let low = 0
  let high = places.length

  while (low < high) {
    const middle = (low + high) >> 1
    if ((places[middle] ?? 0) < from) low = middle + 1
    else high = middle
  }

  return low
}

/** The places that fall inside the region, as spans, so replacing them all is a
 *  matter of splicing. */
function literals(places: readonly number[], length: number, region: Range): Span[] | null {
  const out: Span[] = []
  const last = region.to - length

  for (let index = firstFrom(places, region.from); index < places.length; index++) {
    const at = places[index]
    if (at === undefined || at > last) break
    out.push({ from: at, to: at + length })
  }

  return out.length ? out : null
}

/** The two regions overlapping, or null when they do not. */
function clip(one: Range, other: Range): Range | null {
  const from = Math.max(one.from, other.from)
  const to = Math.min(one.to, other.to)
  return from <= to ? { from, to } : null
}

/** A note, a query, and the compiled patterns the query needs.
 *
 *  Built once per search and asked about every note, so a `/re/` is compiled
 *  once for the whole space rather than once per note. */
export class Matcher {
  private readonly patterns = new Map<string, RegExp | null>()
  private readonly needles = new Map<string, string>()

  constructor(private readonly query: Query) {}

  /** Every place the note answers the query, or null when it does not. */
  spans(note: SearchNote): Span[] | null {
    const facts: Facts = {
      note,
      folded: null,
      starts: null,
      tags: null,
      front: null,
      words: null,
      units: {},
      places: new Map(),
    }

    work.notes += 1
    return this.walk(this.query, facts, { from: 0, to: note.body.length })
  }

  /** The note's matching lines, ready for a row in the panel. */
  hits(note: SearchNote, most: number): Hit[] {
    const spans = this.spans(note)
    if (!spans || most <= 0) return []

    const starts = note.starts?.() ?? lineStarts(note.body)
    const past = pastFrontMatter(note.body, starts)

    // Found by something no line of the note says: its path, its name, a tag, a
    // front matter value. The first line with words in it stands in, so the row
    // reads like a note rather than like an empty result - and the front matter
    // itself is stepped over, because a row saying `---` says nothing at all and
    // a note found by `[pages:>200]` is exactly the note that has one.
    if (!spans.length) {
      const line = starts.findIndex((start, index) => {
        if (index < past) return false
        return note.body.slice(start, starts[index + 1] ?? note.body.length).trim()
      })

      return [this.row(note, starts, Math.max(line, 0), [])]
    }

    const byLine = new Map<number, Range[]>()
    for (const span of [...spans].sort((a, b) => a.from - b.from)) {
      const line = lineAt(starts, span.from)
      const held = byLine.get(line)
      if (held) held.push(span)
      else byLine.set(line, [span])
    }

    return [...byLine.entries()]
      .slice(0, most)
      .map(([line, ranges]) => this.row(note, starts, line, ranges))
  }

  /** One line as a row: the words trimmed and cut short, and the match moved
   *  to where it ended up in them. */
  private row(note: SearchNote, starts: readonly number[], line: number, ranges: Range[]): Hit {
    const from = starts[line] ?? 0
    const next = starts[line + 1]
    const raw = note.body.slice(from, next === undefined ? note.body.length : next - 1)
    const lead = raw.length - raw.trimStart().length
    // Whole characters, so a row cut short never ends inside one. The Rust
    // side counts the same way.
    const text = Array.from(raw.trim()).slice(0, LINE).join('')

    const moved: Range[] = []
    for (const range of ranges) {
      const start = Math.max(range.from - from - lead, 0)
      const end = Math.min(range.to - from - lead, text.length)
      if (start < end) moved.push({ from: start, to: end })
    }

    return { path: note.path, name: note.name, line, text, ranges: moved }
  }

  private walk(query: Query, facts: Facts, region: Range): Span[] | null {
    switch (query.kind) {
      case 'all': {
        const out: Span[] = []
        for (const one of query.of) {
          const found = this.walk(one, facts, region)
          if (!found) return null
          out.push(...found)
        }

        return out
      }

      case 'any': {
        const out: Span[] = []
        let answered = false
        for (const one of query.of) {
          const found = this.walk(one, facts, region)
          if (!found) continue

          answered = true
          out.push(...found)
        }

        return answered ? out : null
      }

      case 'not':
        return this.walk(query.of, facts, region) ? null : []

      case 'text':
      case 'content': {
        const needle = query.fold ? this.folded(query.text) : query.text
        if (!needle) return null

        // `content:` is the same look in a smaller region: the note past its front
        // matter. One narrowing rather than a second walk, so the places a word
        // sits are found once however the query asked for them.
        const within =
          query.kind === 'content'
            ? clip({ from: wordsFrom(facts), to: facts.note.body.length }, region)
            : region
        if (!within) return null

        const hay = query.fold ? foldedOf(facts) : facts.note.body
        return literals(placesIn(facts, hay, needle, query.fold), needle.length, within)
      }

      case 'regex':
        return this.matches(query.source, query.fold, facts.note.body, region)

      case 'path':
        return contains(facts.note.relative, query.text, query.fold) ? [] : null

      case 'file':
        return contains(facts.note.name, query.text, query.fold) ? [] : null

      case 'tag': {
        const wanted = query.tag.toLowerCase()
        // A tag stands for its children too, the way Obsidian reads it, so
        // `tag:work` finds `#work/2026`.
        const has = tagsOf(facts).some((tag) => tag === wanted || tag.startsWith(`${wanted}/`))

        return has ? [] : null
      }

      case 'property': {
        const value = frontOf(facts).get(query.name)

        // The one question a key the note has not got answers yes to.
        if (query.compare === 'null') return value?.trim() ? null : []
        if (value === undefined) return null

        return heldAgainst(value, query) ? [] : null
      }

      case 'scope': {
        const out: Span[] = []
        let answered = false
        // `task-todo:` on its own asks which notes have one, so the unit is the
        // answer: a span of no width at the task's own words, which puts the row on
        // the task rather than on the note's first line and highlights nothing.
        const bare = isEmpty(query.of)

        for (const unit of unitsOf(facts, query.unit)) {
          const within = clip(unit, region)
          if (!within) continue

          work.regions += 1
          const found = this.walk(query.of, facts, within)
          if (!found) continue

          answered = true
          if (bare) out.push({ from: within.from, to: within.from })
          else out.push(...found)
        }

        return answered ? out : null
      }
    }
  }

  private folded(text: string): string {
    const held = this.needles.get(text)
    if (held !== undefined) return held

    const made = fold(text)
    this.needles.set(text, made)
    return made
  }

  /** A pattern that will not compile matches nothing. It is a query still
   *  being typed, not something to report. */
  private pattern(source: string, folded: boolean): RegExp | null {
    const key = `${folded ? 'i' : ''}\0${source}`
    const held = this.patterns.get(key)
    if (held !== undefined) return held

    let made: RegExp | null
    try {
      made = new RegExp(source, folded ? 'gi' : 'g')
    } catch {
      made = null
    }

    this.patterns.set(key, made)
    return made
  }

  /** Every place the pattern matches inside the region. The region is what is
   *  searched, so `^` and `$` mean the start and the end of a line inside
   *  `line:(…)` and the start and the end of the note outside it. */
  private matches(source: string, folded: boolean, body: string, region: Range): Span[] | null {
    const pattern = this.pattern(source, folded)
    if (!pattern) return null

    const whole = region.from === 0 && region.to === body.length
    const text = whole ? body : body.slice(region.from, region.to)
    const out: Span[] = []
    pattern.lastIndex = 0

    for (;;) {
      const found = pattern.exec(text)
      if (!found) break

      const from = found.index
      const to = from + found[0].length

      // A pattern that can match nothing would sit on the same place forever,
      // and an empty match is not a place to show or to replace.
      if (to === from) {
        pattern.lastIndex = from + 1
        continue
      }

      out.push({
        from: region.from + from,
        to: region.from + to,
        groups: Array.from({ length: found.length - 1 }, (_, index) => found[index + 1] ?? ''),
      })

      pattern.lastIndex = to
    }

    return out.length ? out : null
  }
}
