/** What happens when a device and the room it is joining have each written since
 *  the words they last shared.
 *
 *  The room cannot settle it. A room merges keystroke by keystroke, which is what
 *  makes two people typing in one paragraph work at all, and it can do that only for
 *  keystrokes it saw. A device that was closed, offline, or whose note some other
 *  program edited comes back with a whole file and no history to merge with, and
 *  while it was away the room moved on too. One replacement cannot say "keep both of
 *  these"; see join.ts.
 *
 *  Which is exactly the question a pass over a space already had an answer for, and
 *  the answer is the reader's: the conflict rule. So this asks it the same way, with
 *  the same three answers and the same copy beside the note, and the only new thing
 *  is what each answer means to a room:
 *
 *      both      the room's words are kept beside the note, and then this device's
 *                words go into the room - which is safe now, because the copy is
 *                there. The note keeps this device's words, as it does for a pass.
 *      newest    the room's words stand, because they are the ones every other
 *                device in the note is looking at and the ones the account holds.
 *                What loses is kept as a version by the save that replaces it.
 *      ask       nothing is written either way. The clash goes into the sync pane
 *                and the note stays out of its room until somebody answers, so the
 *                file sync carries it - which is where the held list already keeps
 *                it from being pushed over the copy nobody has read.
 *
 *  See sync/conflicts.ts for the three rules and docs/sync.md for what a reader is
 *  told. */

import { conflictPath } from '@nib/markdown/paths'
import { record } from '../sync/record.svelte'
import { type ConflictRule } from '../sync/conflicts'
import { writeDown } from '../sync/pass'

/** What the room does with the answer. `offer` puts this device's words into the
 *  room, `take` puts the room's words into the note, and `wait` leaves both alone;
 *  see `settleAgainst` in room.ts. */
export type Settling = 'offer' | 'take' | 'wait'

/** The note the two copies are about, as much of it as an answer needs. */
export interface Apart {
  /** Where the file is on this machine. Empty for a file somebody shared on its
   *  own, which has no file here - and no copy to write one beside. */
  path: string
  /** Its id on the account, which is what the sync pane's row is about. */
  id: string
  /** The version the account holds, so an answer knows what it would be writing
   *  on top of. */
  version: number
}

export async function apart(rule: ConflictRule, note: Apart, theirs: string): Promise<Settling> {
  // A file the account handed over on its own has no copy on this machine for a
  // second one to sit beside, and the room is the whole of how its words travel.
  // Taking them loses nothing here: what they replace is kept as a version.
  if (!note.path) return 'take'

  if (rule === 'newest') return 'take'

  if (rule === 'ask') {
    record.clash({
      path: note.path,
      id: note.id,
      version: note.version,
      theirs,
      at: Date.now(),
    })
    return 'wait'
  }

  // The room's copy, beside the note, under the name every other copy takes.
  // `writeDown` keeps whatever was already at that name as a version first, so a
  // second copy on the same day does not land on the first without a word.
  await writeDown(conflictPath(note.path), theirs)
  return 'offer'
}
