/** The mouse wheel along a strip too full to show every tab, as VS Code's goes; see
 *  docs/chrome-tabs.md. A sideways turn is the strip's own, and Ctrl is a zoom. */

/** How far a wheel that counts in lines goes per line. */
const LINE = 40

/** What this reads off a `WheelEvent`. */
export interface Turn {
  deltaX: number
  deltaY: number
  /** Pixels, lines or pages, in the DOM's numbering. */
  deltaMode: number
  ctrlKey: boolean
}

/** How many pixels along the strip one turn goes, towards its end; nothing where the
 *  turn is not the strip's to take. `page` is how wide the strip shows. */
export function wheelAlong(turn: Turn, page: number): number {
  if (turn.ctrlKey || Math.abs(turn.deltaX) >= Math.abs(turn.deltaY)) return 0

  const unit = turn.deltaMode === 1 ? LINE : turn.deltaMode === 2 ? page : 1
  return turn.deltaY * unit
}
