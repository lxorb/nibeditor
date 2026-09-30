/** The line that says a deleted note came back.
 *
 *  This device deleted a note another device was still writing in, and the account
 *  kept the writing: an edit beats a delete (docs/sync-v2.md section 5.9). The note is
 *  back in its place in the file list, and without a word that reads as the delete not
 *  having worked. So the undo toast's corner says why, once, in the undo toast's shape
 *  and for its lifetime; see UndoToast.svelte, which draws it beside its own.
 *
 *  One at a time: a second note coming back while the first is still being said is
 *  the newer news, and takes its place. */

import { UNDO_LINGER } from '../undo-toast.svelte'
import type { Resurrected } from './asking.svelte'

class Back {
  /** What the toast is saying, or null when it is not up. */
  said = $state.raw<Resurrected | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  show(event: Resurrected) {
    this.said = event
    this.linger()
  }

  /** Held while the pointer is on it, so a reader half way through the line keeps it. */
  hold() {
    clearTimeout(this.timer)
  }

  linger() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  dismiss() {
    this.said = null
    clearTimeout(this.timer)
  }
}

export const back = new Back()
