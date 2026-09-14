/** What just happened, and the one thing left to do about it.
 *
 *  Some gestures in this app are quiet and final at the same time: archiving a note
 *  takes it out of every list and closes its tab, and the row it was on is gone before
 *  the reader has finished letting go of the mouse. Nothing on screen then says what
 *  happened, and the way back - unarchiving - is behind a list the reader would have to
 *  find first. So the gesture says its own name, and offers to take itself back.
 *
 *  A word and a button, for a few seconds, in the corner. Not a dialog: the gesture
 *  has already happened and nothing is being asked. Not the settings pane's `error`
 *  either, which is words nobody sees unless the settings are open. And not the
 *  undo stack, which is the right thing for a change to a file and the wrong thing
 *  here: archiving is not a file change anybody wants to find eight steps later under
 *  a sentence about renaming, and an archived note is meant to stay archived.
 *
 *  One at a time. A second one replaces the first rather than stacking, for the reason
 *  `said` holds one live region: two notices in the corner are two things to read at
 *  once, and the newer one is the one the reader just caused. The same reason the
 *  prompt sheet replaces its own question.
 *
 *  It says itself out loud as well, through `said`, because a notice in a corner is a
 *  colour and a position to somebody who is listening. The visible half is
 *  `Toast.svelte`; the two live and die together.
 *
 *  A press on the button is the whole of what the notice is for, so pressing it takes
 *  the notice away at once rather than leaving it sitting there having already been
 *  acted on. */

import { said } from './said.svelte'

/** How long a notice stays before it goes by itself.
 *
 *  The four seconds `said` holds its words, because they are the same words: a notice
 *  that left the screen before the live region had finished with it would be a reader
 *  hearing about something they can no longer undo. Long enough to read a word and
 *  reach a button, short enough that it is not still there when the reader has moved
 *  on. */
const HELD = 4000

/** What the corner is carrying. */
interface Notice {
  /** What happened, in a word. Already translated: the store says nothing itself. */
  words: string
  /** The label on the button, or null for a notice with nothing to take back. */
  action: string | null
  /** What the button does. */
  run: () => void
  /** Which notice this is, so the visible half animates a new one in rather than
   *  swapping the words inside the one that is already there. */
  id: number
}

class Toasts {
  showing = $state<Notice | null>(null)

  private clearing: ReturnType<typeof setTimeout> | undefined
  private counted = 0

  /** Says what happened, with one thing to do about it.
   *
   *  `action` and `run` go together: a notice with a button that does nothing is worse
   *  than no button, so the one caller with nothing to offer passes null and gets the
   *  words on their own. */
  show(words: string, action: string | null = null, run: () => void = () => undefined) {
    this.counted += 1
    this.showing = { words, action, run, id: this.counted }
    said.say(words)
    this.wait()
  }

  /** The button pressed: what it does, and then the notice is gone. */
  take() {
    const held = this.showing
    if (!held) return

    this.hide()
    held.run()
  }

  hide() {
    if (this.clearing !== undefined) clearTimeout(this.clearing)
    this.clearing = undefined
    this.showing = null
  }

  private wait() {
    if (this.clearing !== undefined) clearTimeout(this.clearing)

    this.clearing = setTimeout(() => {
      this.clearing = undefined
      this.showing = null
    }, HELD)
  }
}

export const toast = new Toasts()
