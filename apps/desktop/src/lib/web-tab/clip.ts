/** Clipping the page a web tab is showing.
 *
 *  Where the HTML comes from, which is the only part that differs by build. On a
 *  desktop the page is a webview of its own and the crate reads it with a script, in
 *  the document as the reader sees it: a selection if there is one, the article if
 *  there is not. In a browser the page is in a frame belonging to somebody else's
 *  origin and its words cannot be read at all, so a clip there is the address and
 *  the title - a link card, which is what the glyph says it will be before anybody
 *  presses it.
 *
 *  What the note itself says is note.ts, through the same converter the clipper
 *  extension uses. Where it is written is the workspace's, which knows the space. */

import { workspace } from '../workspace.svelte'
import { plainOrigin } from './address'
import { clipNote, clipSource } from './note'
import { pages } from './pages.svelte'

/** Clips what the tab is showing into the space, and answers where it landed.
 *
 *  No tab of its own: the page is still what the reader is looking at, and a note
 *  that opened over it would take them away from what they were reading. The row
 *  appears in the file list, which is where a clip belongs.
 *
 *  What is selected wins over the article, which is what the reader asked for by
 *  selecting it, so the app never has to offer the choice as a row. Null where
 *  nothing could be written: no space open, or a page that said nothing at all. */
export async function clipPage(
  tabId: string,
  fallback: { url: string | null; title: string },
): Promise<string | null> {
  const read = await pages.read(tabId, true)

  // A tab with no page yet is nothing to clip: an empty address used to come through
  // here as an address and write a note saying `source: ''` with `<>` for a body. The
  // glyph is not offered in that state either, so this is the second lock rather than
  // the first; see `clipSource` and WebBar.svelte.
  const url = clipSource(read?.url, fallback.url)
  if (url === null) return null

  // A page that never said what it is called is named after the site, which is
  // better than Untitled and is what the bar has been showing all along. A browser
  // build is always in that position: a frame's title belongs to the site.
  const named = (read?.title ?? fallback.title).trim()
  const page = { url, title: named.length ? named : plainOrigin(url), html: read?.html ?? '' }

  return workspace.noteFrom(await clipNote(page, new Date()))
}
