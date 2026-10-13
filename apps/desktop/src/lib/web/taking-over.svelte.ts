/** The row on the browser build's first visit that brings the notes over from the
 *  old address; handoff.ts says how, and why it has to be a popup.
 *
 *  Offered only at the new address, only on the visit that has nothing yet (the
 *  space chooser is up for that visit alone; see first-visit.svelte.ts), and only
 *  while nobody is signed in, so what it writes over is never somebody's. A
 *  person who never used the old address presses it once and is told there is
 *  nothing there. */

import { account } from '../account.svelte'
import { firstVisit } from '../first-visit.svelte'
import { log } from '../log'
import { isNative } from '../tauri'
import { HANDOFF_PATH, isEmpty, isHandoff, LEGACY_WEB, unpack, WEB } from './handoff'

/** How often a popup that was closed by hand is noticed. */
const WATCH = 500

class TakingOver {
  /** `asking` while the popup is up, `nothing` once the old address had nothing. */
  state = $state<'idle' | 'asking' | 'nothing'>('idle')

  get offered(): boolean {
    return (
      !isNative &&
      typeof location !== 'undefined' &&
      location.origin === WEB &&
      !account.signedIn &&
      firstVisit.asking
    )
  }

  /** Opens the old address's page and waits for what it sends. Called from a press,
   *  which is what lets a browser open the popup at all. */
  bring() {
    if (this.state === 'asking') return

    const popup = window.open(
      `${LEGACY_WEB}${HANDOFF_PATH}`,
      'nib-handoff',
      'popup,width=420,height=320',
    )
    if (!popup) return
    this.state = 'asking'

    const stop = () => {
      window.removeEventListener('message', heard)
      clearInterval(watching)
    }

    const heard = (event: MessageEvent) => {
      if (event.origin !== LEGACY_WEB || event.source !== popup || !isHandoff(event.data)) return
      stop()
      const handoff = event.data
      if (isEmpty(handoff)) {
        this.state = 'nothing'
        return
      }
      // Asked again here, not only when the row was drawn: a sign-in could have
      // landed while the popup was up.
      if (!this.offered) {
        this.state = 'idle'
        return
      }
      unpack(handoff)
        .then(() => {
          firstVisit.answered()
          location.reload()
        })
        .catch((error: unknown) => {
          log('warn', `the notes from the old address could not be written here: ${String(error)}`)
          this.state = 'idle'
        })
    }

    // Closed without an answer: the row is pressable again. Seen closed twice, so
    // the answer a popup posts just before it closes is heard first.
    let closedOnce = false
    const watching = setInterval(() => {
      if (!popup.closed || this.state !== 'asking') return
      if (!closedOnce) {
        closedOnce = true
        return
      }
      stop()
      this.state = 'idle'
    }, WATCH)

    window.addEventListener('message', heard)
  }
}

export const takingOver = new TakingOver()
