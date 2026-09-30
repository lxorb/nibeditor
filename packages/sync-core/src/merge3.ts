/** Two sets of edits to one text, laid side by side against the text they were both
 *  made on. See docs/sync-v2.md section 5.4. */

/** A stretch of a text, as UTF-16 offsets, `to` exclusive. */
export interface Span {
  from: number
  to: number
}

/** One side's change to the ancestor, in the ancestor's coordinates: `from` to `to`
 *  of the ancestor reads `insert` on that side. A pure insertion has `from === to`. */
export interface Edit extends Span {
  insert: string
}

/** Which of the two sides: this device's (L) or the account's (R). */
export type Whose = 'local' | 'remote'

/** Edits of the two sides that meet: spans that intersect, or an insertion strictly
 *  inside a span the other side replaced, closed over transitively. */
export interface Meeting {
  /** The ancestor passage the edits cover, together. */
  base: Span
  local: readonly Edit[]
  remote: readonly Edit[]
  /** Characters of both sides' replacements plus the ancestor text they cover. */
  size: number
}

export interface Merged {
  /** The ancestor to the local text, and to the remote one. */
  local: readonly Edit[]
  remote: readonly Edit[]
  /** Edits both sides made the same way, which count once. */
  identical: readonly Edit[]
  meetings: readonly Meeting[]
  /** The three-way merge: every edit that meets nothing applied, identical ones
   *  once, insertions at one point local first, and each meeting as `winner` says. */
  text: string
}

export function merge3(
  _base: string,
  _local: string,
  _remote: string,
  _winner: (meeting: Meeting) => Whose = () => 'remote',
): Merged {
  throw new Error('not yet')
}
