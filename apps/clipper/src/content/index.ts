/** The half that runs inside the page.
 *
 *  It is put there only when somebody clips: the extension asks for `scripting`
 *  and `activeTab` rather than declaring a content script, so nothing of ours
 *  runs on a page nobody pointed at. The worker injects this file and then asks
 *  it a question; injecting twice is possible when two clips race, so the
 *  listener is registered once and the flag lives in the content script's own
 *  global, which the page cannot see. */

import { readReading } from '../lib/messages'
import { readPage } from '../lib/reading'

declare global {
  interface Window {
    /** Set once this file has registered its listener. */
    nibClipperReading?: true
  }
}

if (!window.nibClipperReading) {
  window.nibClipperReading = true

  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    // From this extension and nothing else. Reading the page is the one thing this
    // listener does, and what it answers with is the page's own words - which is
    // not something another extension on the same tab gets to ask for.
    if (sender.id !== chrome.runtime.id) return false

    const wanted = readReading(message)
    if (!wanted) return false

    respond(readPage(document, wanted.read, location.href, wanted.link ?? undefined))

    // Answered already, so the channel may close.
    return false
  })
}
