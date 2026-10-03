/** What a web tab's page hands over to be clipped: itself, as a document.
 *
 *  The page's own script is kept small on purpose. It runs inside somebody else's
 *  page, so all it does is write down the document as the reader sees it - scripted
 *  content included, scripts and styles left out, every field's value taken off - and
 *  the window reads that with the same extractor the clipper extension runs on a live
 *  page; see `readSnapshot` in `article.ts`. The script is `READER` in
 *  `apps/desktop/src-tauri/src/web_tabs.rs`, which writes the two marks below.
 *
 *  Its own module, and a tiny one, because whoever receives a page's HTML has to
 *  know which kind it is before it decides to fetch the extractor: a snapshot goes
 *  through Readability, and anything else - a selection an older build sent, a
 *  browser build's nothing - is converted as it stands. */

/** On the snapshot's root when what it holds is the reader's selection rather than
 *  the page: the body is then the selection and nothing else, and the head is still
 *  the page's, so its title and its tags come with it. */
export const SELECTED = 'data-nib-selection'

/** Whether some HTML is a whole document rather than a fragment of one. The reader
 *  writes a doctype in front of every snapshot, and a fragment never has one. */
export function isSnapshot(html: string): boolean {
  return /^\s*<!doctype html/i.test(html)
}
