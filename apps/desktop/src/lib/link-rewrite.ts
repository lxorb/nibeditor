/** Rewriting the links to a note that has just been renamed or moved.
 *
 *  Renaming a note in Obsidian rewrites every link to it, silently, and so does
 *  this: a link that stops working because a file was renamed is a broken note,
 *  and nobody renames a note in order to break their own links.
 *
 *  Each link keeps the spelling it was written in. A bare `[[Note]]` becomes
 *  `[[Renamed]]`; a path-qualified `[[folder/Note]]` becomes `[[other/Renamed]]`;
 *  one written with its extension keeps it; and `[label](../folder/Note.md)` keeps
 *  its label and gets a path relative to the note it sits in. Everything that is
 *  not a link comes back character for character, which is what makes this safe
 *  to run over every note in a space.
 *
 *  Pure on purpose: which links point at the note is decided by the caller, since
 *  answering that needs the whole space, and none of this needs to know about
 *  one. */

import { findLinks, type FoundLink } from '@nib/markdown/links'
import { shownName } from './note-name'
import { folderOf, nameOf, relativePath } from './space-paths'

export interface Move {
  /** Where the note was and where it is now, relative to the space. */
  from: string
  to: string
}

/** The text with every link the caller claims points at `move.from` pointing at
 *  `move.to` instead, or null when the note holds no such link - which is the
 *  answer for almost every note in a space, and the reason nothing is written. */
export function rewriteLinks(
  text: string,
  /** The note being rewritten, relative to the space. */
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  const found = findLinks(text).filter(points)
  if (!found.length) return null

  let out = ''
  let at = 0

  for (const link of found) {
    out += text.slice(at, link.targetFrom)
    out += targetFor(link, source, move)
    at = link.targetTo
  }

  return out + text.slice(at)
}

/** What to write where the old target was. Only the target is replaced, so a
 *  `#heading`, an alias and a title all stay exactly as they were. */
function targetFor(link: FoundLink, source: string, move: Move): string {
  if (link.kind === 'markdown') {
    return encodeTarget(relativePath(folderOf(source), move.to))
  }

  // A link written without the file's ending stays without one, whichever kind of
  // file it names: `[[Docs]]` to a website renamed `Handbook.url` is `[[Handbook]]`,
  // the way a note's is. `shownName` is the one reading of which endings a name
  // may leave off; a PDF's is not one of them, so a link to one keeps its ending.
  const written = link.target.includes('/') ? move.to : nameOf(move.to)
  return shownName(link.target) === link.target ? shownName(written) : written
}

/** A path as a markdown target: the characters a browser or an editor would
 *  otherwise read as something else. `#` opens a fragment and a space ends the
 *  target, so both have to be written out.
 *
 *  Exported because the markdown export writes targets too: a `[[wikilink]]`
 *  that becomes a real link has to be spelled the same way a renamed one is. */
export function encodeTarget(path: string): string {
  return encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}
