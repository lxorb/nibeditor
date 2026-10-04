/** The field's own bookkeeping, apart from any element: the line cut into words and
 *  chips for drawing, the spans turned back into words carried through an edit, and a
 *  chip taken out of the line. Pure, so the sheet and the global window share it and a
 *  test can read it. */

import type { Chip, ChipKind } from '@nib/bases/language'
import { oneEdit } from '@nib/markdown/edits'

/** A run of the line: words, or the characters of one chip. */
export interface Piece {
  text: string
  chip?: ChipKind
  /** Where the run starts in the line. */
  from: number
}

/** The line as runs, every chip its own. */
export function piecesOf(text: string, chips: readonly Chip[]): Piece[] {
  const out: Piece[] = []
  let at = 0
  for (const chip of [...chips].sort((a, b) => a.from - b.from)) {
    if (chip.from > at) out.push({ text: text.slice(at, chip.from), from: at })
    out.push({ text: text.slice(chip.from, chip.to), chip: chip.kind, from: chip.from })
    at = chip.to
  }
  if (at < text.length) out.push({ text: text.slice(at), from: at })
  return out
}

export interface Span {
  from: number
  to: number
}

/** Spans of the line as they stand after it changed from `before` to `after`: moved
 *  with the words around them, and gone where the edit reached into one, since what was
 *  turned back into words is no longer those words. */
export function carried(spans: readonly Span[], before: string, after: string): Span[] {
  const edit = oneEdit(before, after)
  if (!edit) return [...spans]
  const shift = edit.insert.length - (edit.to - edit.from)
  const out: Span[] = []
  for (const span of spans) {
    if (span.to <= edit.from) out.push(span)
    else if (span.from >= edit.to) out.push({ from: span.from + shift, to: span.to + shift })
  }
  return out
}

/** The line with a span taken out, and the blank it leaves closed up. */
export function without(text: string, span: Span): string {
  const before = text.slice(0, span.from).replace(/\s+$/u, '')
  const after = text.slice(span.to).replace(/^\s+/u, '')
  return before && after ? `${before} ${after}` : before + after
}
