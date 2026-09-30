/** How the palette puts everything in one order.
 *
 *  Emil, 2026-09-30: *"because there are so many things to possibly search for with
 *  ctrl + P I want that you think well about what things would make sense to appear
 *  higher and which do not. Also the more often a user accesses a specific thing, the
 *  higher it should ofc appear ... settings, should usually be rather low"*.
 *
 *  One number per row, made of five parts, so the rule can be read off the sum:
 *
 *  1. **How well the words were found** (0 to 100, and most of the number). Every word
 *     typed, in any order, has to be found in the row's name as letters in order;
 *     the score is how close together and how near the starts of words they fell,
 *     against the best they could have done. The name counts in full, and so do the
 *     other names a thing goes by - a site's own host, a setting's choices and the
 *     words it is known by (`dark`, `font`). What the row is merely found by - a
 *     note's folder, a page's whole address, a setting's pane - counts for seven
 *     tenths, as Raycast ranks a subtitle under a title. A word of five letters or
 *     more one slip away from a word's start still finds it, weakly, when little
 *     else did.
 *  2. **The name itself.** Typed whole, it wins outright (Raycast's first rule, and
 *     what makes Enter predictable); typed as the start of the name, it beats the
 *     same letters found further in.
 *  3. **What kind of thing it is.** An open tab first, then a note or any other file,
 *     a bookmark, a command, a page from the history, and a setting last. For one or
 *     two letters the gap widens - a letter finds a note, not the forty commands that
 *     have it somewhere - and a setting, a page or a heading has to be found well to
 *     be shown at all.
 *  4. **Use** (0 to 40). How often and how lately it was reached for, from
 *     frecency.ts, and for a page how often it was visited and typed. Enough to carry
 *     a setting opened every morning over a note that merely matches as well, and
 *     never enough to carry a poor match over a good one.
 *  5. **Where the reader is.** What the caller knows: a command that cannot run now
 *     sinks, one about the kind of tab in front rises, a note that is bookmarked
 *     rises, the tab already in front sinks.
 *
 *  Ties keep the order the rows were handed in, which is each kind's own sensible
 *  order, so the same letters always give the same list and the top row is the row
 *  it was a keystroke ago unless the new letter really changed it.
 *
 *  Pure, and per keystroke: every name was folded once, when the palette opened. */

import { foldName } from '@nib/markdown/links'
import { fuzzyFolded, nearly } from './match'

export type Kind = 'tab' | 'note' | 'bookmark' | 'command' | 'page' | 'heading' | 'setting'

/** One thing the palette could show, ready to be scored. */
export interface Candidate<T> {
  /** What frecency.ts knows it by, or null for a thing it does not keep. */
  key: string | null
  kind: Kind
  /** The name, folded: what the row says, and what an exact match is against. */
  name: string
  /** Other names it goes by, folded, which count as much as the name. */
  names: readonly string[]
  /** Everything else it may be found by, folded, which counts for less. */
  also: readonly string[]
  /** What the caller adds or takes away for where the reader is; see part 5. */
  lift: number
  /** How much it has been used, in frecency's units: see part 4. */
  use: number
  item: T
}

/** Part 3, as points. The spread matters more than the numbers: a tab or a note
 *  beats a command of the same match by six, and a setting by twenty-six. */
const KIND: Record<Kind, number> = {
  tab: 14,
  note: 10,
  bookmark: 8,
  command: 4,
  page: 2,
  heading: 0,
  setting: -16,
}

/** And what one or two letters take away on top. */
const SHORT: Record<Kind, number> = {
  tab: 0,
  note: 0,
  bookmark: -4,
  command: -14,
  page: -10,
  heading: -30,
  setting: -30,
}

/** How well a setting, a page or a heading has to be found to be shown at all, as
 *  a share of the best: its name or its words at the start of a word, the letters
 *  together. A search for a note should not grow a tail of settings that happen to
 *  hold its letters. */
const STRONG: Partial<Record<Kind, number>> = { setting: 0.75, page: 0.5, heading: 0.9 }

/** What a typed name counts for, whole and as its start. */
const EXACT = 40
const PREFIX = 10

/** What a word one slip away counts for, as a share of the best. */
const SLIPPED = 0.45

/** What something found only in its other readings keeps of its score. */
const ALSO = 0.7

/** The most part 4 can add. */
const MOST_USE = 40

/** How many rows are worth drawing. Past this it is a second file list. */
export const MOST = 50

/** The best a word could score: at a word's start, every letter after the one before. */
const ideal = (word: string) => 6 + 8 * (word.length - 1)

/** How well every word was found in one reading, as a share of the best, or null. */
function quality(words: readonly string[], reading: string, slips: boolean): number | null {
  let score = 0
  let best = 0

  for (const word of words) {
    const found = fuzzyFolded(word, reading)
    if (found === null) {
      if (!slips || !nearly(word, reading)) return null
      score += SLIPPED * ideal(word)
    } else {
      score += found
    }
    best += ideal(word)
  }

  return best > 0 ? score / best : 0
}

/** Part 4, as points: a use today is twelve, a thing used every day is forty. */
function usePoints(use: number): number {
  return Math.min(MOST_USE, 12 * Math.log2(1 + use))
}

/** How one candidate scores for `term`, folded; null for one that does not match. */
function scored<T>(term: string, one: Candidate<T>, slips = false): number | null {
  const words = term.split(/\s+/).filter(Boolean)
  const short = term.replace(/\s/g, '').length <= 2

  let found = quality(words, one.name, slips)
  let raw = found
  const weigh = (readings: readonly string[], weight: number) => {
    for (const reading of readings) {
      if (found !== null && found >= 1) return
      const other = quality(words, reading, slips)
      if (other === null) continue
      if (raw === null || other > raw) raw = other
      if (found === null || other * weight > found) found = other * weight
    }
  }
  weigh(one.names, 1)
  weigh(one.also, ALSO)

  if (found === null || raw === null || found <= 0) return null
  if (raw < (STRONG[one.kind] ?? 0) && one.use <= 0) return null

  const typed = words.join(' ')
  const naming = one.name === typed ? EXACT : one.name.startsWith(typed) ? PREFIX : 0

  return (
    100 * found +
    naming +
    KIND[one.kind] +
    (short ? SHORT[one.kind] : 0) +
    usePoints(one.use) +
    one.lift
  )
}

/** The candidates that match `term`, best first, at most `MOST`.
 *
 *  A word one slip away is looked for only when the letters as typed found little,
 *  so a typo costs a second pass over the list and a query that is spelt right never
 *  pays for one. */
export function ranked<T>(term: string, candidates: readonly Candidate<T>[], most = MOST): T[] {
  const folded = foldName(term.trim())
  if (!folded) return candidates.slice(0, most).map((one) => one.item)

  const pass = (slips: boolean) => {
    const out: { item: T; score: number }[] = []
    for (const one of candidates) {
      const score = scored(folded, one, slips)
      if (score !== null) out.push({ item: one.item, score })
    }
    return out
  }

  let found = pass(false)
  if (found.length < 5) found = pass(true)

  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, most)
    .map((one) => one.item)
}
