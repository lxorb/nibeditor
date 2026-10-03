/** What the panel (lane 4) reaches the review by (docs/ai-sidebar.md 6.6), besides the
 *  components it draws by name - `ChangesBar.svelte` over the field, `Branches.svelte`
 *  under each of the reader's messages, `Asked.svelte` in a call that asked. */

import type { Thread, Turn } from '../chat/types'
import { checkpoints } from './changes'
import { review, type ReviewPanel } from './review.svelte'

export { askFirst, setAskFirst } from './grant'
export type { ReviewPanel } from './review.svelte'

/** The rewind sheet: Esc Esc on an empty field, or the clock on a message (`turn`). */
export function openRewind(thread: Thread, panel: ReviewPanel, turn?: string): void {
  if (thread.turns.length) review.openRewind(thread, panel, turn ?? null)
}

/** The reader's message an edit would change: the last one, for Up on an empty
 *  field. */
export function lastMessage(thread: Thread): Turn | null {
  return checkpoints(thread.turns).at(-1) ?? null
}

/** An edited message sent: the notes and the conversation back to before it, what
 *  followed kept as a branch, and `text` sent in its place. */
export function editMessage(
  thread: Thread,
  turn: string,
  text: string,
  panel: ReviewPanel,
): Promise<void> {
  return review.edit(thread, turn, text, panel)
}

/** Follow, the eye on the thread's menu: whether the notes the thread edits come to the
 *  front as it edits them, and the switch. */
export function following(thread: Thread): boolean {
  return review.following.has(thread.id)
}

export function toggleFollow(thread: Thread): void {
  review.toggleFollow(thread)
}
