/** What changed between two texts, as edits in the first text's coordinates.
 *
 *  The one character diff in this package: the classifier reads it to see where two
 *  sides wrote, and textops reads it to turn a whole text into operations. It is
 *  diff-match-patch underneath, with three things added that the library does not do
 *  on its own.
 *
 *  **The same answer everywhere.** The library gives up after a second by default and
 *  answers with a coarser diff, so how two texts differ would depend on how fast the
 *  machine asking was. A device classifies, and a test replays a seed; both need one
 *  answer. So the clock is off, and the one input that could make an unclocked diff
 *  slow - a very long stretch rewritten with nothing in common - is answered as one
 *  replacement without asking the library at all.
 *
 *  **Whole characters.** The library counts UTF-16 code units, and a boundary between
 *  the two halves of an emoji is a boundary it is happy to draw. Yjs is not: splitting
 *  a pair in a shared text replaces both halves with U+FFFD for good. Every edit is
 *  widened until both its ends fall between characters.
 *
 *  **Cost in proportion to the edit.** The common front and back are cut off first by
 *  `fold`, the same trim a room's fold uses, so a word changed in a hundred kilobytes
 *  is a diff of a word. */

import { fold } from '@nib/rooms/fold'
import {
  DIFF_DELETE,
  DIFF_INSERT,
  diffCleanupEfficiency,
  diffCleanupSemantic,
  diffMain,
  type Diff,
} from 'diff-match-patch-es'
import type { Edit } from './merge3'

/** Past this many code units on either side of the changed middle, the middle is
 *  one replacement. An unclocked diff of two unrelated stretches costs the product
 *  of their lengths; at this size that is well under a second, and a middle this
 *  long is a rewrite however it is cut. */
const MOST_DIFFED = 20_000

function leads(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xd800 && code <= 0xdbff
}

/** The library's answer, as edits in the old text's coordinates, adjacent deletes
 *  and inserts paired into one replacement. */
function editsOf(diffs: readonly Diff[], offset: number): Edit[] {
  const out: Edit[] = []
  let at = offset
  let open: Edit | null = null

  for (const [operation, text] of diffs) {
    if (operation === DIFF_DELETE || operation === DIFF_INSERT) {
      open ??= { from: at, to: at, insert: '' }
      if (operation === DIFF_DELETE) {
        at += text.length
        open.to = at
      } else {
        open.insert += text
      }
      continue
    }

    if (open) out.push(open)
    open = null
    at += text.length
  }

  if (open) out.push(open)
  return out
}

/** Every edit widened until its ends fall between whole characters of `old`, and
 *  edits that then touch joined into one.
 *
 *  Widening takes the half-character on either side into the edit on both texts at
 *  once: it is the same code unit in both, because it sat in the part the two share.
 *  So `from` moving back one unit prepends that unit to `insert`, and `to` moving on
 *  one appends it. */
function whole(old: string, edits: readonly Edit[]): Edit[] {
  const out: Edit[] = []

  for (const edit of edits) {
    let { from, to, insert } = edit
    if (from > 0 && leads(old, from - 1)) {
      from -= 1
      insert = old.charAt(from) + insert
    }
    if (to > 0 && to < old.length && leads(old, to - 1)) {
      insert += old.charAt(to)
      to += 1
    }

    // Widening can make two edits touch, and around a stray half-character it can
    // make them share one unit: that unit is already at the end of the first
    // edit's insert and at the start of this one's, so it is taken once.
    const last = out.at(-1)
    if (last && last.to >= from) {
      last.insert += old.slice(last.to, from) + insert.slice(Math.max(0, last.to - from))
      last.to = Math.max(last.to, to)
    } else {
      out.push({ from, to, insert })
    }
  }

  return out
}

/** Two ways to tidy the library's raw answer, for two readers.
 *
 *  `semantic` folds the coincidental agreements inside a rewritten sentence - the
 *  `e` that `rest` and `sleep` share - into the rewrite: what a person would call the
 *  change, and what the classifier has to see, or two rewrites of one sentence would
 *  look like twenty small edits that happen not to touch.
 *
 *  `operations` folds only the agreements too short to be worth two more operations,
 *  the library's efficiency cleanup: a word retyped is one replacement rather than a
 *  handful of letters kept between deletes and inserts, while a sentence edited in two
 *  places stays two edits, and every character outside them keeps its identity in the
 *  shared text. */
export type Tidy = 'semantic' | 'operations'

/** How `old` becomes `now`, as edits in `old`'s coordinates, in order, none of them
 *  touching another and none of them cutting a character in half. Empty when the two
 *  are the same text. */
export function edits(old: string, now: string, tidy: Tidy): Edit[] {
  const middle = fold(old, now)
  if (!middle) return []

  const before = old.slice(middle.from, middle.to)
  if (!before || !middle.insert) return [middle]
  if (before.length > MOST_DIFFED || middle.insert.length > MOST_DIFFED) return [middle]

  const diffs = diffMain(before, middle.insert, { diffTimeout: 0 })
  if (tidy === 'semantic') diffCleanupSemantic(diffs)
  else diffCleanupEfficiency(diffs)

  return whole(old, editsOf(diffs, middle.from))
}
