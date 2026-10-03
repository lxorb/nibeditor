/** The review's half of two commands (docs/ai-sidebar.md 3.1, 3.5): `/rewind` opens
 *  the rewind sheet and `/diff` the list of changes. Found by the commands (lane 5)
 *  under this name, each run with the command's context. */

import type { Thread } from '../chat/types'
import { review, type ReviewPanel } from './review.svelte'

interface Context {
  thread: Thread | null
  panel: ReviewPanel
}

export function rewind({ thread, panel }: Context): void {
  if (thread?.turns.length) review.openRewind(thread, panel)
}

export function changes({ thread }: Context): void {
  if (thread) review.listing = thread.id
}
