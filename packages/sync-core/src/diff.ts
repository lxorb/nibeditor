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
 *  answer. So the clock is off, and the work is bounded another way: long texts are
 *  compared line by line first, the way the library itself does, and only the runs of
 *  lines that differ are compared character by character. A run that is still very
 *  long once its common ends are cut off is a rewrite, and is answered as one
 *  replacement without asking the library at all, because an unclocked diff of two
 *  long unrelated stretches costs the product of their lengths.
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
  DIFF_EQUAL,
  DIFF_INSERT,
  diffCharsToLines,
  diffCleanupEfficiency,
  diffCleanupMerge,
  diffCleanupSemantic,
  diffLinesToChars,
  diffMain,
  type Diff,
} from 'diff-match-patch-es'
import type { Edit, Span } from './merge3'
import { charAt, charBefore, isWordChar, tokens, wordEnd, wordStart } from './words'

/** Past this many code units on either side, a stretch that differs is compared line
 *  by line rather than character by character, and a run of changed lines past it,
 *  once its common ends are cut off, is one replacement. Two unrelated stretches of
 *  this size cost the library about a third of a second on a laptop (measured: 115 ms
 *  at 2,000, 330 ms at 5,000, 830 ms at 10,000), which is the most this lets a diff
 *  cost; two similar ones cost next to nothing (a hundred kilobytes with thirty words
 *  changed: 8 ms). */
const MOST_DIFFED = 5_000

/** The library with its clock off. */
const UNCLOCKED = { diffTimeout: 0 }

function leads(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xd800 && code <= 0xdbff
}

/** Two stretches compared character by character, their common ends trimmed first,
 *  and a middle too long to compare answered as one replacement. */
function characters(old: string, now: string): Diff[] {
  const middle = fold(old, now)
  if (!middle) return old ? [[DIFF_EQUAL, old]] : []

  const before = old.slice(middle.from, middle.to)
  const out: Diff[] = []
  if (middle.from) out.push([DIFF_EQUAL, old.slice(0, middle.from)])

  if (before.length > MOST_DIFFED || middle.insert.length > MOST_DIFFED) {
    if (before) out.push([DIFF_DELETE, before])
    if (middle.insert) out.push([DIFF_INSERT, middle.insert])
  } else {
    out.push(...diffMain(before, middle.insert, UNCLOCKED, false))
  }

  if (middle.to < old.length) out.push([DIFF_EQUAL, old.slice(middle.to)])
  return out
}

/** Two long stretches compared line by line, and each run of lines that differs then
 *  character by character. The library's own line mode, with the bound above on the
 *  second step in place of its clock. */
function lines(old: string, now: string): Diff[] {
  const { chars1, chars2, lineArray } = diffLinesToChars(old, now)
  const coarse = diffMain(chars1, chars2, UNCLOCKED, false)
  diffCharsToLines(coarse, lineArray)
  // As the library does: a line kept by chance between two rewritten ones joins them,
  // so the character pass sees the rewrite whole.
  diffCleanupSemantic(coarse)

  const out: Diff[] = []
  let gone = ''
  let come = ''
  const flush = () => {
    if (gone || come) out.push(...characters(gone, come))
    gone = ''
    come = ''
  }

  for (const [operation, text] of coarse) {
    if (operation === DIFF_DELETE) gone += text
    else if (operation === DIFF_INSERT) come += text
    else {
      flush()
      out.push([DIFF_EQUAL, text])
    }
  }

  flush()
  return out
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
 *  `semantic` is for reading: the coincidental agreements inside a rewritten
 *  sentence - the `e` that `rest` and `sleep` share - are folded into the rewrite,
 *  and every edit that cuts into a word is widened to the whole word. That is what a
 *  person would call the change, and what the classifier has to see: two rewrites of
 *  one sentence must not look like twenty small edits that happen not to touch, and
 *  `noon` changed to `one` must not look like two letters deleted and one typed
 *  just beside the other side's change.
 *
 *  `operations` is for writing into a shared text: only the agreements too short to
 *  be worth two more operations are folded, the library's efficiency cleanup, so a
 *  word retyped is one replacement while a sentence edited in two places stays two
 *  edits, and every character outside them keeps its identity in the shared text. */
export type Tidy = 'semantic' | 'operations'

/** The span an edit covers once widened to whole words at either end where it cut
 *  into one: its first or last changed character is part of a word, and so is the
 *  character beside it that it left alone. */
function wordSpan(old: string, edit: Edit): Span {
  const gone = old.slice(edit.from, edit.to)
  const opens = isWordChar(charAt(gone, 0)) || isWordChar(charAt(edit.insert, 0))
  const closes =
    isWordChar(charBefore(gone, gone.length)) ||
    isWordChar(charBefore(edit.insert, edit.insert.length))

  return {
    from: opens && isWordChar(charBefore(old, edit.from)) ? wordStart(old, edit.from) : edit.from,
    to: closes && isWordChar(charAt(old, edit.to)) ? wordEnd(old, edit.to) : edit.to,
  }
}

/** Edits widened to whole words, and the ones that then touch joined into one, what
 *  each now inserts read back out of `now`: everything between two edits is text
 *  the two share, so a widened edit's words on the new side are where its ends land
 *  once the edits before it are counted. */
function worded(old: string, now: string, list: readonly Edit[]): Edit[] {
  const out: Edit[] = []
  let shift = 0
  let open: { from: number; to: number; change: number } | null = null

  const close = () => {
    if (!open) return
    const at = open.from + shift
    out.push({
      from: open.from,
      to: open.to,
      insert: now.slice(at, at + open.to - open.from + open.change),
    })
    shift += open.change
    open = null
  }

  for (const edit of list) {
    const span = wordSpan(old, edit)
    const change = edit.insert.length - (edit.to - edit.from)
    if (open && span.from <= open.to) {
      open.to = Math.max(open.to, span.to)
      open.change += change
      continue
    }
    close()
    open = { from: span.from, to: span.to, change }
  }

  close()
  return out
}

/** How `old` becomes `now`, as edits in `old`'s coordinates, in order, none of them
 *  touching another and none of them cutting a character in half. Empty when the two
 *  are the same text. */
export function edits(old: string, now: string, tidy: Tidy): Edit[] {
  const middle = fold(old, now)
  if (!middle) return []

  const before = old.slice(middle.from, middle.to)
  if (!before || !middle.insert) {
    return tidy === 'semantic' ? worded(old, now, [middle]) : [middle]
  }

  const long = before.length > MOST_DIFFED || middle.insert.length > MOST_DIFFED
  const diffs = long ? lines(before, middle.insert) : characters(before, middle.insert)
  diffCleanupMerge(diffs)
  if (tidy === 'operations') {
    diffCleanupEfficiency(diffs)
    return whole(old, editsOf(diffs, middle.from))
  }

  diffCleanupSemantic(diffs)
  return worded(old, now, whole(old, editsOf(diffs, middle.from)))
}

/** How `old` becomes `now` word by word: a word is the same word or a different one,
 *  never a few of its letters. What the modal marks, so a reader sees the words that
 *  differ between two passages rather than the letters. */
export function wordEdits(old: string, now: string): Edit[] {
  const codes = new Map<string, string>()
  const spelled = (list: readonly string[]) =>
    list
      .map((token) => {
        let code = codes.get(token)
        if (code === undefined) {
          // One character per distinct token, below the surrogates so none of them
          // is ever half a pair. A passage long enough to run out is read letter by
          // letter instead.
          code = String.fromCharCode(codes.size + 1)
          codes.set(token, code)
        }
        return code
      })
      .join('')

  const oldTokens = tokens(old)
  const nowTokens = tokens(now)
  const oldCodes = spelled(oldTokens)
  const nowCodes = spelled(nowTokens)
  if (codes.size >= 0xd7ff) return edits(old, now, 'semantic')

  const vocabulary = new Map([...codes].map(([token, code]) => [code, token]))
  // Every code is one unit below the surrogates, so a unit is a token.
  const spoken = (text: string) =>
    Array.from({ length: text.length }, (_, at) => vocabulary.get(text.charAt(at)) ?? '').join('')
  const diffs: Diff[] = diffMain(oldCodes, nowCodes, UNCLOCKED, false).map(([operation, text]) => [
    operation,
    spoken(text),
  ])

  return editsOf(diffs, 0)
}
