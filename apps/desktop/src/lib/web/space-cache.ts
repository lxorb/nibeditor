/** The space the browser's search keeps in mind between two questions.
 *
 *  A row in `IndexedDB` comes back whole, so reading a space of five thousand notes
 *  to answer one query is five thousand rows and six megabytes of strings built
 *  from scratch - per keystroke. The query itself is a handful of `indexOf` calls
 *  over text that has not changed since the last letter was typed, which is the
 *  whole of why searching felt like waiting: almost none of the time was the
 *  search.
 *
 *  So the notes are read once and kept here, in the worker, folded when a query
 *  first looks at words and folded once from then on. A search over a warm space
 *  reads no rows at all. What keeps that honest rather than stale:
 *
 *  - Every write to the store says so, and the note that changed is the only one
 *    read again; see `announce` in store.ts, which is the one place a row is
 *    written, and `wrote` below.
 *  - A space is one root. A question about another space drops this one, because
 *    two spaces in one worker is twice the memory for a list nobody is looking at.
 *  - What it holds is capped. Past the cap the largest notes go first, since one
 *    novel in a space costs what a hundred notes cost, and a note that was let go
 *    is read again when the walk next reaches it.
 *
 *  Nothing here matches anything: see search.ts for the walk and match.ts for what
 *  a note answers. The crate keeps the same space warm on a desktop, keyed by each
 *  file's stamp rather than by a message; see `warm` in search.rs. */

import { lineStarts } from '../search/lines'
import { fold, type SearchNote } from '../search/match'
import type { Warmth } from '../search/warmth'
import { breathe } from '../breathe'
import { isMarkdown, normalise, within } from './paths'
import { type FileRow, files } from './store'

/** How much note text the worker holds, in characters.
 *
 *  Twenty-four million is a space of five thousand ordinary notes several times
 *  over, and a couple of tens of megabytes in the worker - which is where a search
 *  happens and not where anything is drawn. A note's folded copy counts as well,
 *  because it is a second string of the same length; its line index is a number
 *  per line and goes with the note it belongs to. */
const CAP = 24_000_000

/** What it is actually held to. The cap above everywhere but in
 *  space-cache.test.ts, which would otherwise have to build twenty-four million
 *  characters of notes to reach it. */
let cap = CAP

/** For the tests: a cap small enough to cross. */
export function holdAtMost(characters: number): void {
  cap = characters
}

/** How many notes a stretch of the warm pass reads before handing the thread
 *  back. The same size the link scan reads in, and for the same reason; see
 *  `scanLinks` in commands.ts. */
const READ_AT_ONCE = 256

/** One note, held: its words, and the two things a search works out about them
 *  rather than reads.
 *
 *  A class rather than a fresh object per search, so a warm space costs no
 *  allocation at all to walk: this *is* the note the matcher is handed. Both
 *  lazy, because a query about a path or a tag never looks at a letter, and both
 *  kept, because the next keystroke asks the same thing again. */
class Held implements SearchNote {
  private lowered: string | null = null
  private lines: readonly number[] | null = null

  constructor(
    readonly path: string,
    readonly relative: string,
    readonly name: string,
    readonly body: string,
  ) {}

  readonly folded = (): string => (this.lowered ??= fold(this.body))
  readonly starts = (): readonly number[] => (this.lines ??= lineStarts(this.body))

  /** How many characters this note is holding, which is what the cap counts. */
  get chars(): number {
    return this.body.length + (this.lowered?.length ?? 0)
  }

  /** How much of that is the folded copy rather than the note itself. */
  get folds(): number {
    return this.lowered?.length ?? 0
  }

  /** Lets go of everything that can be worked out again from the body: the folded
   *  copy, and the line index beside it. Both are made once and kept, and both are
   *  made again from a string already in memory the next time a query asks - which
   *  is why they go before the note does when the cap has to be met. See `settle`. */
  release(): void {
    this.lowered = null
    this.lines = null
  }
}

class Space {
  /** Which space is held, normalised, or null for none. */
  private root: string | null = null
  /** Every note of it, in the store's own key order, which is path order. */
  private order: string[] = []
  private held = new Map<string, Held>()
  /** Whether a whole pass has finished. Until it has, the order is partial and a
   *  search reads the store the way it always did. */
  private whole = false
  private characters = 0
  private dropped = 0
  /** Rows read out of the store since the space opened. Counted rather than
   *  timed, for the reason fuzzy.ts gives beside its own counters: a clock says
   *  what the machine was doing, and a count says what the code did. That this
   *  stops growing is the whole point of the file; see space-cache.test.ts. */
  private read = 0

  warmth(): Warmth {
    return {
      notes: this.held.size,
      of: this.order.length,
      characters: this.characters,
      cap,
      dropped: this.dropped,
      read: this.read,
      warm: this.whole,
    }
  }

  /** Reads the whole space and keeps it, a stretch at a time.
   *
   *  Asked for at the search stage of the launch, which is after the file list is
   *  on screen and after the link index has had its turn; see startup.svelte.ts.
   *  A space already warm is not read again, so this is safe to ask for twice. */
  async fill(root: string): Promise<void> {
    const base = normalise(root)
    if (this.root === base && this.whole) return
    if (this.root !== base) this.forget(base)

    // Keys rather than rows: which notes a space has costs nothing to ask, and
    // the bodies come in stretches below with a breath between them. A pass that
    // yielded nowhere would be one long task in the worker, which is a message
    // from the page waiting behind it.
    const paths = (await files.paths()).filter((path) => within(base, path) && isMarkdown(path))
    if (this.root !== base) return

    this.order = paths

    // A row written while the keys were being read is already in hand, and the
    // keys were asked for before it landed: it goes back into the order rather
    // than being held but never walked.
    const listed = new Set(paths)
    for (const path of this.held.keys()) {
      if (!listed.has(path)) this.place(path)
    }

    for (let at = 0; at < paths.length; at += READ_AT_ONCE) {
      const chunk = paths.slice(at, at + READ_AT_ONCE)
      // Every path in a space sorts together, so the stretch between the first and
      // the last of a chunk is that chunk and nothing else.
      const rows = await files.between(chunk[0] ?? '', chunk.at(-1) ?? '')
      // Another space may have been asked about while this one was being read.
      if (this.root !== base) return

      this.read += rows.length
      for (const row of rows) {
        if (isMarkdown(row.path)) this.keep(base, row)
      }

      await breathe()
      if (this.root !== base) return
    }

    this.whole = true
    this.settle()
  }

  /** Every note of the space, in path order, until `visit` says stop.
   *
   *  From memory when the space is warm, which is no rows and no allocation. From
   *  the store when it is not, keeping what it reads, so the first question about
   *  a space is what fills it if nothing else has yet. */
  async each(root: string, visit: (note: Held) => boolean): Promise<void> {
    const base = normalise(root)

    try {
      if (this.root !== base || !this.whole) {
        await this.walk(base, visit)
        return
      }

      // By index rather than over the list itself: a path the store no longer has
      // is taken out of the order as it is met, and a walk over a list that is
      // being shortened would step over whatever followed it.
      for (let at = 0; at < this.order.length; at++) {
        const path = this.order[at] ?? ''
        // A note the cap let go of is read again here, one row, rather than the
        // whole space being read because one note is missing from it.
        const note = this.held.get(path) ?? (await this.fetch(base, path))
        if (!note) {
          at -= 1
          continue
        }

        if (!visit(note)) return
      }
    } finally {
      // The folds a search just made are part of what is held, so the cap is
      // counted after the walk rather than at the moment a note arrived.
      this.settle()
    }
  }

  /** A row that has just been written. The one note is read again from what was
   *  written and nothing else is touched. */
  wrote(row: FileRow): void {
    const base = this.root
    if (base === null || !within(base, row.path) || !isMarkdown(row.path)) return

    if (!this.held.has(row.path)) this.place(row.path)
    this.keep(base, row)
    // The cap is counted on the next walk rather than here. A sync landing a
    // thousand notes is a thousand of these, and counting what is held per note
    // would make that pass the space squared.
  }

  /** A path that has just been written, read again here on the worker's thread,
   *  and only where it is a note of the space held. See `RowChange` in store.ts. */
  async rewritten(path: string): Promise<void> {
    const base = this.root
    if (base === null || !within(base, path) || !isMarkdown(path)) return

    const row = await files.get(path)
    if (row) this.wrote(row)
  }

  /** A row that has gone: deleted, or moved to another path. */
  gone(path: string): void {
    const at = this.at(path)
    if (this.order[at] === path) this.order.splice(at, 1)

    const note = this.held.get(path)
    if (!note) return

    this.held.delete(path)
    this.characters -= note.chars
  }

  /** Forgets the space, for one that has closed or for another opening. */
  forget(root: string | null): void {
    this.root = root === null ? null : normalise(root)
    this.order = []
    this.held.clear()
    this.whole = false
    this.characters = 0
    this.dropped = 0
    this.read = 0
  }

  /** The store read as it always was, filling as it goes. A walk that stopped
   *  early - which is every query that found its fill of hits - leaves the space
   *  partly held and not warm, so the pass at the search stage still has a whole
   *  space to read. */
  private async walk(base: string, visit: (note: Held) => boolean): Promise<void> {
    if (this.root !== base) this.forget(base)
    this.order = []
    // Written inside the cursor's own callback, so it is read back through a
    // holder the compiler can see changing; the same shape tauri.ts uses.
    const walking = { on: true }

    await files.each((row) => {
      if (!walking.on) return

      this.read += 1
      if (!within(base, row.path) || !isMarkdown(row.path)) return

      this.order.push(row.path)
      if (!visit(this.keep(base, row))) walking.on = false
    })

    if (walking.on) this.whole = true
  }

  /** One row into the cache, as the note a search is handed. */
  private keep(base: string, row: FileRow): Held {
    const was = this.held.get(row.path)
    if (was) this.characters -= was.chars

    const relative = row.path.slice(base === '/' ? 1 : base.length + 1)
    const name = relative.split('/').pop() ?? relative
    const note = new Held(row.path, relative, name, row.content)

    this.held.set(row.path, note)
    this.characters += note.chars
    return note
  }

  /** One note the cap let go of, or one written into a space whose order has
   *  already been read, fetched on its own. */
  private async fetch(base: string, path: string): Promise<Held | null> {
    this.read += 1
    const row = await files.get(path)
    if (!row) {
      this.gone(path)
      return null
    }

    return this.keep(base, row)
  }

  /** Where path order puts a path in the order, whether it is in it or not. By
   *  halving, because a folder deleted is a message per note in it and walking the
   *  whole order for each of them would be the space squared. */
  private at(path: string): number {
    let low = 0
    let high = this.order.length

    while (low < high) {
      const middle = (low + high) >> 1
      if ((this.order[middle] ?? '') < path) low = middle + 1
      else high = middle
    }

    return low
  }

  /** A new path into the order, where path order puts it: the list is walked in
   *  that order, and a note appended to the end of it would answer out of turn. */
  private place(path: string): void {
    const at = this.at(path)
    if (this.order[at] !== path) this.order.splice(at, 0, path)
  }

  /** What is held, counted, and held to the cap.
   *
   *  The folds go first and the notes only after them, because the two cost
   *  different things to get back. A fold is made from the body already in hand:
   *  letting one go and making it again is arithmetic over a string in memory. A
   *  note that was let go is a row out of the store the next time a search reaches
   *  it - a transaction, and the string built again from the disk.
   *
   *  Which is not a fine distinction at the size this happens at. Five thousand
   *  ordinary notes are twenty-two million characters, under the cap; their folded
   *  copies are what put them over it. So the first query that looked at a word
   *  used to throw away two thousand notes and every query after that read those
   *  two thousand rows again - a no-match search over five thousand notes read two
   *  thousand one hundred and four rows, every single time, which is what
   *  space-cache.test.ts now counts.
   *
   *  The largest first either way, because one long note costs what a hundred
   *  ordinary ones cost and letting it go buys the most room for the least work. */
  private settle(): void {
    let held = 0
    for (const note of this.held.values()) held += note.chars
    this.characters = held
    if (held <= cap) return

    const biggest = [...this.held.values()].sort((one, other) => other.chars - one.chars)

    for (const note of biggest) {
      if (this.characters <= cap) return

      this.characters -= note.folds
      note.release()
    }

    // Still over with nothing but bodies left, so the space itself is larger than
    // the cap and some of it has to go.
    for (const note of biggest) {
      if (this.characters <= cap) break

      this.held.delete(note.path)
      this.characters -= note.chars
      this.dropped += 1
    }
  }
}

/** The one cache. A worker holds one space, because it answers about one at a
 *  time. */
export const space = new Space()
