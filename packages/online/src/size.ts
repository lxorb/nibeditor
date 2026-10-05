/** Who decides a pty's size (docs/online-terminal.md 4.6).
 *
 *  A pty has one size, and it is the size of whoever typed last: tmux's `latest`,
 *  not the smallest of everybody watching as Replit and tmux's own default do. So a
 *  phone that only watches never narrows the desktop's build log, and a phone that
 *  types gets a terminal that fits it; everybody else scales or leaves a margin. */

import type { Typed } from './types'

/** The size of the latest input, or null before anybody typed. Of two inputs at the
 *  same moment the one listed later wins, as the later frame to arrive does. An entry
 *  with no size (a screen not yet measured) is passed over. */
export function sizeOf(typed: readonly Typed[]): { cols: number; rows: number } | null {
  let latest: Typed | null = null
  for (const one of typed) {
    if (!(one.cols >= 1 && one.rows >= 1)) continue
    if (!latest || one.at >= latest.at) latest = one
  }
  return latest ? { cols: latest.cols, rows: latest.rows } : null
}
