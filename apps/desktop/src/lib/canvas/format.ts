/** The canvas file, as the app sees it.
 *
 *  The format itself lives in `@nib/markdown/canvas`, next to the wikilink
 *  grammar and for the same reason: three parts of Nib read it, and one of them
 *  is a worker that has no app around it. This file is what the surface imports,
 *  so nothing in the app has to know where the format went, and it is where the
 *  handful of things only a surface needs are kept. */

import { type Canvas as Plane, readCanvas as read } from '@nib/markdown/canvas'

export {
  blankCanvas,
  type Canvas,
  type CanvasColour,
  type CanvasEdge,
  type CanvasNode,
  clampOpacity,
  DEFAULT_HEIGHT,
  DEFAULT_INK,
  DEFAULT_WIDTH,
  emptyCanvas,
  freshId,
  type InkPoint,
  type InkStroke,
  type InkTool,
  INK_TOOLS,
  isInkTool,
  isShape,
  type PageNode,
  type Paper,
  PAPER_NAMES,
  type Pattern,
  PATTERNS,
  PRESET_COLOURS,
  readCanvas,
  type Shape,
  type Side,
  writeCanvas,
} from '@nib/markdown/canvas'

export { merged, stamped } from '@nib/markdown/canvas-merge'

/** A plane parsed before the surface that will show it is built, handed over once.
 *
 *  Reading a plane and building the surface for it used to be one task: a canvas of
 *  ten thousand strokes is 2.8 MB of JSON, and `JSON.parse` of it is a good thirty
 *  milliseconds on top of what the mount costs.
 *
 *  Two tasks rather than one, with nothing moved off the thread. A worker was the
 *  first idea and it is the wrong one, measured: handing the parsed graph back over
 *  `postMessage` costs about forty milliseconds each way in structured clone - more
 *  than parsing it here does, twenty-five to thirty-one - so a worker that parses
 *  and posts the result back makes the main thread pay *more*. What is expensive
 *  about a plane this size is the object graph, and an object graph is exactly what
 *  a thread boundary charges for. See format.test.ts, which counts the parses.
 *
 *  So `openCanvas` parses, hands the thread over with `nextTask`, and then builds
 *  the tab; the store's `parse` finds the answer waiting and the mount is a mount. */
let waiting: { text: string; canvas: Plane } | null = null

/** Parses a plane now, for a surface that is about to be built from the same text. */
export function parseAhead(text: string): void {
  waiting = { text, canvas: read(text) }
}

/** The plane `parseAhead` read, if it read this one. Once: a second surface on the
 *  same file parses for itself rather than sharing an object graph with the first,
 *  which would be two surfaces editing one plane. */
export function takeParsed(text: string): Plane | null {
  const held = waiting?.text === text ? waiting.canvas : null
  if (held) waiting = null

  return held
}

/** Forgets whatever is waiting. For a tab that never opened: 2.8 MB of object graph
 *  is not something to leave lying about on the chance somebody asks. */
export function forgetParsed(): void {
  waiting = null
}
