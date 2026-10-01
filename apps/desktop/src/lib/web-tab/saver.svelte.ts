/** Memory saver, as this machine has it set: off until somebody chooses otherwise. What
 *  each strength does is resting.ts; what a page out of sight costs is about this
 *  computer, so the choice is the device's, like Hidden tabs. */

import { keep, storedText } from '../stored'
import { isSaver, type Saver } from './resting'

const KEY = 'nib:memory-saver'

class MemorySaver {
  mode = $state<Saver>(read())

  set(mode: Saver) {
    this.mode = mode
    keep(KEY, mode)
  }
}

function read(): Saver {
  const kept = storedText(KEY)
  return isSaver(kept) ? kept : 'off'
}

export const saver = new MemorySaver()
