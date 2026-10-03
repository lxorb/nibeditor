/** Whether a swipe goes back and forward: on, as in every browser, and off for a hand
 *  that keeps going back by accident - the one thing people ask Chrome how to turn off,
 *  and what Safari leaves to the system's "Swipe between pages". This machine's own,
 *  like the rest of how its touchpad is set up. */

import { keep, storedText } from '../stored'

const KEY = 'nib:swipe'

class SwipeChoice {
  on = $state(storedText(KEY) !== 'off')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'on' : 'off')
  }
}

export const swipeChoice = new SwipeChoice()
