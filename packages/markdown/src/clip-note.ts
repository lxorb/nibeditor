/** A clip as a note: the one shape both clips write.
 *
 *  Front matter first, so the note remembers where it came from and when, then the
 *  title as an H1, then the words. The clipper extension and a web tab's Clip both
 *  write through here, after the same extractor (`article.ts`) and the same converter
 *  (`from-html.ts`), so a folder of clips reads the same whichever of the two saved
 *  each one - and the same page clipped from both is the same note. */

import { type FrontMatterRow, oneLine, writeFrontMatter } from './front-matter'
import { asWords } from './words'

/** Where a clip came from: all the note's front matter needs. */
export interface ClipOrigin {
  kind: 'page' | 'selection' | 'link'
  /** What the note records, and what every address in it resolves against. */
  url: string
  title: string
  tags: string[]
}

/** The longest a page may name itself. A title is a line above an article, and a
 *  page that hands over a paragraph is handing over content in the wrong field. */
const LONGEST_TITLE = 300

/** What a clip is called when the page offered no title at all. The same name the
 *  app gives a new note, and deliberately not translated: a file name is a path, and
 *  a path that changes with the language stops matching itself. */
export const UNTITLED = 'Untitled'

/** A page's title as a clip can carry it: one line, not a paragraph, never nothing. */
export function clipTitle(title: string): string {
  return oneLine(title).slice(0, LONGEST_TITLE).trim() || UNTITLED
}

/** The block above the note. The same four fields first, always all four and always
 *  in that order: a reader scanning a folder of clips should find the same shape at
 *  the top of every one of them, and whatever else a caller has to say comes under
 *  them in the order it was given.
 *
 *  How a value is spelled - what is quoted, and how a line the page wrote is made
 *  one - is `front-matter.ts`'s, which is also what reads the block back in the app:
 *  a value carrying a colon, a `#`, or `---` on a line of its own comes out quoted
 *  rather than closing the block and continuing the note in somebody else's words. */
export function clipFrontMatter(
  origin: ClipOrigin,
  clipped: Date,
  more: readonly FrontMatterRow[] = [],
): string {
  return writeFrontMatter([
    ['source', origin.url],
    ['title', origin.title],
    ['clipped', clipped.toISOString()],
    ['tags', origin.tags],
    ...more,
  ])
}

/** The extractor sometimes leaves the article's own headline at the top of the
 *  content, and the note is about to state it as an H1. One title is enough; a
 *  headline that says something else is the article's, and stays.
 *
 *  Compared with the escapes taken off, because the heading has been through the
 *  converter and the title has not: a headline ending in a full stop after a number
 *  comes back as `1\. ` and would otherwise never match. */
function withoutRepeatedTitle(markdown: string, title: string): string {
  const heading = /^#{1,2}\s+(.+?)[ \t]*(?:\n|$)/.exec(markdown)
  if (!heading?.[1]) return markdown

  const said = heading[1].replace(/\\(.)/g, '$1')
  return said === title ? markdown.slice(heading[0].length).trimStart() : markdown
}

/** The whole note. A clip with no words of its own - a clipped link, or a page that
 *  said nothing that could be read - says the one thing it knows: the address, as a
 *  link somebody can follow.
 *
 *  The title is settled once, here, so the front matter, the heading and the headline
 *  the body is checked against are the same words. */
export function clipNoteText(
  origin: ClipOrigin,
  markdown: string,
  clipped: Date,
  more: readonly FrontMatterRow[] = [],
): string {
  const title = clipTitle(origin.title)
  const words = markdown.trim()
  const body =
    origin.kind === 'link' || words === '' ? `<${origin.url}>` : withoutRepeatedTitle(words, title)

  // The heading is the page's own words, and a page names itself: the front matter
  // quotes what it holds, but a heading is markdown, and a note's markup is markup.
  // See `asWords`, which is what the converter escapes a page's prose with.
  return `${clipFrontMatter({ ...origin, title }, clipped, more)}\n\n# ${asWords(title)}\n\n${body}\n`
}
