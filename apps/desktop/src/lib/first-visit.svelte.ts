/** Whether this sitting is somebody's first visit to the browser build, asked where
 *  their notes are coming from (David, 2026-10-06).
 *
 *  The desktop and the phone ask on the space chooser, which is up because there is
 *  no space yet. The browser build always has one - it seeds the welcome note on a
 *  first visit (web/commands.ts) - so it asks the same question on the same card,
 *  once, on the visit that wrote that note, and "Start fresh" leaves the reader on
 *  it. See space-choice.ts.
 *
 *  Once a browser has answered, it is never asked again, which the welcome note
 *  already makes true for a reader: it is written once per browser. Written down as
 *  well because a browser a drive opens is a first visit every time, and every drive
 *  opens one; the harness answers for it before the page loads, as a reader who has
 *  been here before (`ANSWERED` in test/e2e/harness.py). */

import { keep, storedText } from './stored'

const KEY = 'nib:first-visit'

class FirstVisit {
  asking = $state(false)

  /** Said on the visit that wrote the welcome note. */
  ask() {
    if (storedText(KEY) !== 'answered') this.asking = true
  }

  /** A fresh start, or notes brought over: either way the question is answered. */
  answered() {
    this.asking = false
    keep(KEY, 'answered')
  }
}

export const firstVisit = new FirstVisit()
