/** Whether a merge is silent, quietly decided, or a question. See docs/sync-v2.md
 *  section 5.4. */

import type { Span, Whose } from './merge3'

/** Past this many characters in one overlap, a merge asks. About a sentence. */
export const CONTESTED = 80

/** A block deleted on one side and edited by more than this many characters on the
 *  other asks, however small the overlap. */
export const REWRITTEN = 16

export type Verdict = 'clean' | 'minor' | 'diverged'

/** A structure both sides kept that the merge would break. */
export type Broken = 'front-matter' | 'fence'

/** When each side's edits were made: the newest pending update on this device, and
 *  the account's `updated_at`. */
export interface Times {
  local: number
  remote: number
}

/** Edits of the two sides that meet, as the modal and the minor merge see them. */
export interface Overlap {
  /** The passage in the ancestor, in the local text, and in the remote text. */
  base: Span
  local: Span
  remote: Span
  /** Characters of both replacements plus the ancestor text they cover. */
  size: number
  /** The side whose text stands when the verdict is `minor`. */
  newer: Whose
  /** Why this overlap alone asks, or null when the newer side may settle it. */
  asks: 'size' | 'block' | null
}

export interface Divergence {
  verdict: Verdict
  overlaps: readonly Overlap[]
  /** What the note reads once merged, for `clean` and `minor`: the CRDT's `merged`
   *  text with identical edits once and each overlap as its newer side wrote it.
   *  Null when the verdict is `diverged`. */
  resolution: string | null
  broken: Broken | null
}

/** One side's passage for the modal, with the differing stretches marked. */
export interface Excerpt {
  text: string
  marks: [number, number][]
}

export function diverge(
  _base: string,
  _local: string,
  _remote: string,
  _times: Times,
  _merged?: string,
): Divergence {
  throw new Error('not yet')
}

export function excerpt(
  _base: string,
  _local: string,
  _remote: string,
  _overlaps: readonly Overlap[],
): { local: Excerpt; remote: Excerpt } {
  throw new Error('not yet')
}
