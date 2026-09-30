/** The classifier for canvases and page notes. See docs/sync-v2.md section 5.6. */

import type { Canvas } from '@nib/markdown/canvas'
import type { Times, Verdict } from './diverge'
import type { Whose } from './merge3'

/** One object both sides changed. */
export interface PlaneOverlap {
  id: string
  /** The field both changed, or `deleted` for an object one side threw away and the
   *  other edited. */
  field: string
  newer: Whose
  asks: boolean
}

export interface PlaneDivergence {
  verdict: Verdict
  overlaps: readonly PlaneOverlap[]
  /** The plane as it reads once merged, null when the verdict is `diverged`. */
  resolution: Canvas | null
}

export function divergePlane(
  _base: Canvas,
  _local: Canvas,
  _remote: Canvas,
  _times: Times,
): PlaneDivergence {
  throw new Error('not yet')
}
