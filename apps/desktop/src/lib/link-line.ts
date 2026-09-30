/** A line of a note as the reading view reads it, for a row that quotes one: the
 *  Links panel's context under each backlink, link out and mention.
 *
 *  A row used to quote the line as it is written, so `[[Kestrel notes#Wind|wind
 *  notes]]` sat in the panel brackets, bar and all, next to a note that reads "wind
 *  notes". A link is its shown words here, marked as a link, the way the reading
 *  view draws it; the rest of the line is left as it is. */

import { findLinks, shownText } from '@nib/markdown/links'

/** A run of the line: words, or the words a link shows. */
interface LinePiece {
  text: string
  link: boolean
}

/** A markdown link to anywhere, the web included, which `findLinks` leaves out
 *  because a link out of the space is nothing to the index. It still shows its
 *  label. */
const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\([^)\n]*\)/g

export function linkPieces(line: string): LinePiece[] {
  const pieces: LinePiece[] = []
  let at = 0

  const words = (to: number) => {
    if (to > at) plain(line.slice(at, to), pieces)
  }

  for (const link of findLinks(line)) {
    words(link.from)
    pieces.push({ text: shownText(link), link: true })
    at = link.to
  }
  words(line.length)

  return pieces
}

/** The same line as plain words, for whatever reads a row aloud. */
export function shownLine(line: string): string {
  return linkPieces(line)
    .map((one) => one.text)
    .join('')
}

/** Words between note links, with any link out of the space shown by its label. */
function plain(text: string, into: LinePiece[]) {
  let at = 0

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    if (match.index > at) into.push({ text: text.slice(at, match.index), link: false })
    into.push({ text: match[1] ?? '', link: true })
    at = match.index + match[0].length
  }

  if (at < text.length) into.push({ text: text.slice(at), link: false })
}
