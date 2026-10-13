/** Whether to say the app's new name, asked before anything of this run is written;
 *  why and to whom is in RenameNotice.svelte, which is fetched only to say it. */

import { keep, storedText } from './stored'

const KEY = 'nib:renamed'

function usedBefore(): boolean {
  try {
    for (let at = 0; at < localStorage.length; at++) {
      const key = localStorage.key(at)
      if (key !== null && key !== KEY && key.startsWith('nib:')) return true
    }
  } catch {
    // No site data allowed: nothing is remembered, so nothing is said every run.
  }
  return false
}

class Renamed {
  showing = $state(false)

  constructor() {
    if (storedText(KEY) !== null) return
    this.showing = usedBefore()
    keep(KEY, 'told')
  }

  dismiss() {
    this.showing = false
  }
}

export const renamed = new Renamed()
