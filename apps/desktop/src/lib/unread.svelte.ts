/** A file that is there and would not read: held by another program, written in
 *  an encoding that is not UTF-8, or not this user's to read.
 *
 *  A read that fails says nothing about which it was, and the two answers are
 *  opposite. A file that has gone opens nothing, or - for a folder whose note
 *  nobody has written - the empty page it would be. A file that is there must
 *  never open as that page: the first keystroke saves it, and the save is the end
 *  of whatever the file held. So one stat, asked only after a read has failed,
 *  tells them apart; see `file_stamp` in notes.rs.
 *
 *  And the reader is told. A click that opens nothing and says nothing reads as
 *  the app being broken, so the toast Undo lives in says it in one line; see
 *  UndoToast.svelte. Fetched with the first failed read rather than carried in
 *  front of the first paint, where a file that will not read has no business. */

import { log } from './log'
import { undoToastNotice } from './surfaces.svelte'
import { invoke } from './tauri'
import { UNDO_LINGER } from './undo-toast.svelte'

class Unread {
  /** Whether the toast is saying so. */
  shown = $state(false)

  private timer: ReturnType<typeof setTimeout> | undefined

  /** Whether `path`, which would not read, is there all the same - in which case
   *  the reader is told and the log says which file. */
  async there(path: string): Promise<boolean> {
    // Truthy rather than not null: a stamp is an object, and a build with no
    // disk behind it answers nothing at all.
    const stamp: unknown = await invoke('file_stamp', { path }).catch(() => null)
    if (!stamp) return false

    log('warn', `open: ${path} is there and would not read`)
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()

    this.shown = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
    return true
  }

  dismiss() {
    this.shown = false
    clearTimeout(this.timer)
  }
}

export const unread = new Unread()
