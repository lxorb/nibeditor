/** How the archive at the foot of the file list is being looked at: whether it is
 *  open, which archived folders are unfolded in it, and the row it was just asked to
 *  show.
 *
 *  Whether it is open is this machine's, like the file list's own folds, and is kept
 *  between launches; it starts shut, since the archive is where things go to be out
 *  of the way. The folds inside it are the sitting's. See Archive.svelte. */

import { keep, storedText } from './stored'

const OPEN_KEY = 'nib:archive-open'

class ArchiveList {
  open = $state(storedText(OPEN_KEY) === '1')
  /** Archived folders unfolded in the list, by path as the app holds one. */
  unfolded = $state<string[]>([])
  /** The row to scroll to and light, once; the list clears it. */
  showing = $state<string | null>(null)

  toggle() {
    this.setOpen(!this.open)
  }

  /** The archive open, and the row for `path` in it scrolled to where there is one:
   *  what Show in the file list does for an archived note, and what a refused
   *  deletion's Show them does. */
  show(path: string | null = null) {
    this.setOpen(true)
    this.showing = path
  }

  isUnfolded(path: string): boolean {
    return this.unfolded.includes(path)
  }

  unfold(path: string) {
    this.unfolded = this.isUnfolded(path)
      ? this.unfolded.filter((one) => one !== path)
      : [...this.unfolded, path]
  }

  private setOpen(open: boolean) {
    this.open = open
    keep(OPEN_KEY, open ? '1' : '0')
  }
}

export const archiveList = new ArchiveList()
