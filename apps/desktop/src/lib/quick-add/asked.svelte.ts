/** Whether quick add is up, and what it was opened knowing. The one piece of it the
 *  first paint carries, because the key that opens it is read from the first frame;
 *  the sheet itself is fetched the first time this says yes. See QuickAddSheet.svelte. */

import { keep, storedText } from '../stored'
import type { Prefill } from './entry'

const SMART = 'nib:quick-add-smart'
const ANYWHERE = 'nib:quick-add-anywhere'

class QuickAddAsk {
  open = $state(false)
  prefill = $state<Prefill>({})

  /** Whether typed words are read as dates and fields (Settings, Smart dates). */
  smart = $state(storedText(SMART) !== 'off')
  /** Whether the key opens quick add over every other app too. */
  anywhere = $state(storedText(ANYWHERE) !== 'off')

  /** Opens it, knowing what a view's add button knows. */
  show(prefill: Prefill = {}) {
    this.prefill = prefill
    this.open = true
  }

  hide() {
    this.open = false
  }

  setSmart(on: boolean) {
    this.smart = on
    keep(SMART, on ? 'on' : 'off')
  }

  setAnywhere(on: boolean) {
    this.anywhere = on
    keep(ANYWHERE, on ? 'on' : 'off')
  }
}

export const quickAdd = new QuickAddAsk()
