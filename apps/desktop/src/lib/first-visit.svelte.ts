/** Whether this sitting is somebody's first visit to the browser build, asked where
 *  their notes are coming from (David, 2026-10-06).
 *
 *  The desktop and the phone ask on the space chooser, which is up because there is
 *  no space yet. The browser build always has one - it seeds the welcome note on a
 *  first visit (web/commands.ts) - so it asks the same question on the same card,
 *  once, on the visit that wrote that note, and "Start fresh" leaves the reader on
 *  it. Held for the sitting and never written down: the welcome note is written once
 *  per browser, so the next visit is not a first one. See space-choice.ts. */

class FirstVisit {
  asking = $state(false)
}

export const firstVisit = new FirstVisit()
