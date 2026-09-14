/** Whether the archive is open, and which part of it is being looked at.
 *
 *  The archive is a section at the foot of the file list, the way the bookmarks are a
 *  section at the head of it: shut until somebody wants it, because what is in it is what
 *  they have deliberately stopped looking at. So there is an open state, and it is this
 *  machine's rather than the space's - which of your own lists you have unfolded is a
 *  habit of reading, like the file list's sort, and not a fact about the notes.
 *
 *  `inside` is the other half. Deleting a folder with archived notes in it is refused, and
 *  the sheet that says so offers to show them: pressing that opens the archive narrowed to
 *  that folder, so the reader sees the three notes in the way rather than the two hundred
 *  in the space. Narrowing is cleared the moment the archive is shut, because a list that
 *  quietly remembered a filter from last week is a list that looks empty for no reason.
 *
 *  Not persisted. The open state would be worth keeping, but the narrowing would not, and
 *  one of the two surviving a relaunch and not the other is the kind of half-remembered
 *  state that reads as a bug. See workspace/device.svelte.ts for the lists whose folds are
 *  worth writing down. */

class ArchiveList {
  open = $state(false)
  /** The folder the list is narrowed to, as the space speaks of it, or null for the whole
   *  archive. */
  inside = $state<string | null>(null)

  toggle() {
    this.open = !this.open
    if (!this.open) this.inside = null
  }

  /** Opens the archive on one folder: what Show them does. */
  show(inside: string | null = null) {
    this.open = true
    this.inside = inside
  }
}

export const archiveList = new ArchiveList()
