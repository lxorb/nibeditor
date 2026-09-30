/** The breaks a note is cut into slides at, read line by line, and whether a note
 *  has any: the part of slides.ts that is asked about every note the editor shows,
 *  which is why it is a module of its own. The rest of slides.ts renders, and brings
 *  a Markdown parser of its own for it; a window opening on a note that is not a
 *  deck - nearly every window - reads this and none of that. */

import { closesFence, fenceMark } from './fences'

/** A line of three or more hyphens, and nothing else on it. */
export const HORIZONTAL = /^-{3,}[ \t]*$/
/** The same in asterisks, which is the break that goes downwards. */
export const VERTICAL = /^\*{3,}[ \t]*$/
export const BLANK = /^[ \t]*$/

/** Front matter is metadata rather than a slide, and its two rules are not
 *  breaks. Answers where the note's body starts. */
export function bodyStart(source: string): number {
  if (!source.startsWith('---')) return 0

  const matter = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  return matter ? matter[0].length : 0
}

interface Line {
  from: number
  to: number
  text: string
}

/** Every line of `source` from `at`, with where each one sits. Walked with
 *  indexOf rather than split, so a long note is not copied into an array of
 *  strings only for the breaks to be counted. */
export function* lines(source: string, at: number): Generator<Line> {
  for (let from = at; from <= source.length;) {
    const end = source.indexOf('\n', from)
    const to = end === -1 ? source.length : end
    // The carriage return of a CRLF file belongs to the break, not to the line.
    const text = source.slice(from, to).replace(/\r$/, '')

    yield { from, to, text }
    if (end === -1) return
    from = end + 1
  }
}

/** What a line does to the fence a scan is inside: the mark of the one it opens,
 *  null for the line that closes the one `open` holds, and undefined for every
 *  other line - a fence line inside a block that it does not close included, so
 *  everything between the two delimiters is left alone. See fences.ts. */
export function fenceChange(text: string, open: string | null): string | null | undefined {
  if (open === null) return fenceMark(text) ?? undefined
  return closesFence(text, open) ? null : undefined
}

/** Whether the note is a deck: words, a break, and words after it.
 *
 *  The same answer as `deckOf(source).length > 1`, reached without rendering
 *  anything and without reading past the first slide, because it is asked of
 *  every note the editor shows. A rule with nothing above it opens the first
 *  slide and one with nothing below it ends the last, so neither on its own
 *  makes a note into a deck. */
export function isDeck(source: string): boolean {
  const start = bodyStart(source)
  let fence: string | null = null
  let blank = true
  /** Whether anything has been written, and whether a break has been passed
   *  with something written before it. */
  let written = false
  let broken = false

  for (const line of lines(source, start)) {
    const change = fenceChange(line.text, fence)
    if (change !== undefined) {
      fence = change
      if (written && broken) return true
      written = true
      blank = false
      continue
    }

    if (fence) {
      blank = false
      continue
    }

    if (blank && (HORIZONTAL.test(line.text) || VERTICAL.test(line.text))) {
      if (written) broken = true
      blank = false
      continue
    }

    if (!BLANK.test(line.text)) {
      if (broken) return true
      written = true
    }

    blank = BLANK.test(line.text)
  }

  return false
}
