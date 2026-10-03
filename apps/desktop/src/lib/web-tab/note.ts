/** The two notes a web tab has anything to do with.
 *
 *  **A clip**, which is a note this app composes out of a page: the page's words,
 *  under front matter that says `source:` and `clipped:`, exactly as the clipper
 *  extension writes one. A clip is the words as they were rather than a window on the
 *  site, so it is a note and always will be. See clip.ts.
 *
 *  **A website, as it used to be written**: a `.md` file whose front matter said
 *  `url:`. A website is a shortcut file now - `Svelte docs.url`, which is the format
 *  Explorer and every browser already write; see shortcut.ts, which says why. What
 *  is left here is the reading half, because spaces are full of the old ones: a note
 *  that says `url:` is converted the first time anybody opens it, and the three
 *  functions below are what the conversion reads it with.
 *
 *  They go when the last space has been converted, which is not a day this code can
 *  know about. Until then they cost one front-matter read on a pass that was reading
 *  the file anyway. */

import type { ClipOrigin } from '@nib/markdown/clip-note'
import { frontMatterEdit, frontMatterValue, stripFrontMatter } from '@nib/markdown/front-matter'
import { isWebAddress } from './address'

/** The key that made a note a website. */
const URL_KEY = 'url'

/** The address a note points at, or null for a note that is prose.
 *
 *  Judged and not only read: a note whose `url:` says `javascript:...` - because
 *  somebody wrote it by hand, or because it arrived in a shared space - is a note
 *  and not a web tab. The one reading of the key, so the mark in the file list, the
 *  click that opens it and the tab that draws it cannot disagree. */
export function webUrlOf(text: string | null | undefined): string | null {
  const said = frontMatterValue(text ?? '', URL_KEY)
  return said !== null && isWebAddress(said) ? said : null
}

/** What the note says it is called, or null when it says nothing. The page's own
 *  title is better than a file name, and it is what the tab shows before the page
 *  has loaded. */
export function webTitleOf(text: string | null | undefined): string | null {
  const said = frontMatterValue(text ?? '', 'title')?.trim()
  return said === undefined || said.length === 0 ? null : said
}

/** What a note that was a website had to say beyond being one, or null when it had
 *  nothing to say at all.
 *
 *  What the old format wrote under the front matter is a heading and the address as
 *  a link, and a file holding only those two is the shortcut beside it said twice.
 *  Anything else in it is somebody's writing, and that stays a note - with `url:`
 *  taken out, because the shortcut written beside it is what that line now means.
 *
 *  Used once, by the conversion; see `workspace.asShortcut`. */
export function keptBody(text: string): string | null {
  const written = stripFrontMatter(text)
    .split('\n')
    .filter((line) => {
      const said = line.trim()
      // A heading, the address as an autolink, and the blank lines between them:
      // the whole of what the old writer put in the body.
      return said.length > 0 && !said.startsWith('#') && !/^<https?:\/\/[^>]*>$/i.test(said)
    })

  if (written.length === 0) return null

  const edit = frontMatterEdit(text, URL_KEY, null)
  return edit === null ? text : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

/** Where a clip says it came from, or null where there is nothing to clip.
 *
 *  A web tab does not always have a page. "Open a website" opens one with an address
 *  field and no file yet, and until somebody types into it the tab has no address, no
 *  title and no words - and clipping it wrote a note whose `source:` was empty and whose
 *  whole body was `<>`. The audit found one of those called `Second page.md`.
 *
 *  Judged rather than merely present, and by the same rule the tab itself is held to:
 *  what is not the web is not somewhere a clip can have come from, because it is not
 *  somewhere the tab could have been. The page's own address wins over the tab's, which
 *  is what the reader is looking at. See clip.ts, which refuses on this, and
 *  WebBar.svelte, where the glyph is not offered while there is nothing to clip. */
export function clipSource(
  read: string | null | undefined,
  fallback: string | null,
): string | null {
  const url = (read ?? '').trim() || (fallback ?? '').trim()
  return isWebAddress(url) ? url : null
}

/** A page as the clip reads it: where it is, what it calls itself, and its HTML. */
interface Read {
  url: string
  title: string
  html: string
}

/** What a page's HTML holds worth keeping, and what the page is called and tagged.
 *
 *  A web tab's page hands over a snapshot of itself (see
 *  `@nib/markdown/snapshot`), and the snapshot goes through the extractor the
 *  clipper extension runs - the article, or the selection the page marked - so a tab
 *  and the extension clip the same page to the same words. Anything else is already
 *  the part worth keeping: a page an agent read whole, or the nothing a browser
 *  build's frame gives, which is a link card.
 *
 *  The extractor is Readability and most of a hundred kilobytes, so it is fetched
 *  here, when a snapshot has arrived to be read, and never on the way to a window. */
export async function articleOf(page: Read): Promise<ClipOrigin & { html: string }> {
  const { isSnapshot } = await import('@nib/markdown/snapshot')
  if (!isSnapshot(page.html)) return { kind: 'page', ...page, tags: [] }

  const { readSnapshot } = await import('@nib/markdown/article')
  const read = readSnapshot(page.html, page.url)

  return { ...read, title: read.title.trim() || page.title }
}

/** A page as a note: where it came from, when, and what it said.
 *
 *  The shape is `@nib/markdown/clip-note`'s, which the clipper extension writes
 *  through too, after the same extractor (`articleOf`) and the same converter - so a
 *  folder of clips reads the same whichever of the two saved it, and the same page
 *  clipped from both is the same note. The title is settled there, so the front
 *  matter, the heading and the file's own name are the same words - the name comes
 *  off the heading; see `workspace.noteFrom`.
 *
 *  Answered rather than returned, because turning a page into markdown means
 *  fetching the extractor and the converter, which a window opening on a note has no
 *  use for, while the functions above are read by the file list on every launch.
 *  Clipping is already a wait - the page has to be asked for its words first - so the
 *  fetch costs the reader nothing. See clip.ts, and an agent's capture. */
export async function clipNote(page: Read, when: Date): Promise<string> {
  const [read, { htmlToMarkdown }, { clipNoteText }] = await Promise.all([
    articleOf(page),
    import('@nib/markdown/from-html'),
    import('@nib/markdown/clip-note'),
  ])

  const words = read.html.trim() ? htmlToMarkdown(read.html) : ''
  return clipNoteText(read, words, when)
}
