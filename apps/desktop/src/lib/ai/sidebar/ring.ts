/** What the context ring draws and its tray lists (docs/ai-sidebar.md 4.10): how full
 *  the window is by the provider's own count after the last answer, what that is made
 *  of, what the next message is about to add (estimated here, the ≈), and where
 *  compaction happens on its own.
 *
 *  The provider counts the whole and nothing finer, so the bands are the parts nib can
 *  say on its own (the instructions it sent, the chips that went) with the rest called
 *  the conversation. Pure. */

import { compactsAt, estimate, estimateText, filled } from '../chat/usage'
import type { AutoCompact, Turn, Usage } from '../chat/types'

export interface Bands {
  /** The provider's count, as of the last answer. */
  used: number
  window: number | null
  instructions: number
  attached: number
  conversation: number
  /** The draft and its chips, estimated. */
  next: number
  /** Where compaction happens on its own, or null for never or for no known window. */
  compacts: number | null
  /** How much of the circle is filled with the next message in it, 0 to 1, or null with
   *  no window to draw it against. */
  fraction: number | null
  /** Past four fifths: the ring takes the warning colour. */
  warn: boolean
}

/** What went with the messages since the last compaction, estimated. */
export function attachedIn(turns: readonly Turn[], since?: string): number {
  const from = since ? turns.findIndex((one) => one.id === since) + 1 : 0
  let sum = 0
  for (const turn of turns.slice(from)) {
    if (turn.role === 'you' && turn.draft)
      sum += estimate({ text: '', attachments: turn.draft.attachments })
  }
  return sum
}

export function bandsOf(
  usage: Usage,
  window: number | null,
  instructions: string,
  attached: number,
  next: number,
  auto: AutoCompact = 'auto',
): Bands {
  const used = filled(usage)
  const told = used ? estimateText(instructions) : 0
  // The provider's whole is the truth; the parts nib estimated are fitted inside it.
  const sent = Math.min(attached, Math.max(0, used - told))
  const fraction = window ? Math.min(1, (used + next) / window) : null
  return {
    used,
    window,
    instructions: Math.min(told, used),
    attached: used ? sent : 0,
    conversation: Math.max(0, used - told - sent),
    next,
    compacts: compactsAt(window, auto),
    fraction,
    warn: (fraction ?? 0) >= 0.8,
  }
}
