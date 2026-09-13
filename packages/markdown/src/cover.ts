/** A note's cover: the wide picture across the top of it, and how far down that
 *  picture the band is taken from.
 *
 *  Two keys in the front matter and nothing else. `cover:` is the picture, said
 *  the way a picture is said anywhere in a note - a path beside the note, a bare
 *  file name, a `[[wikilink]]`, or an address - and `cover-position:` is a
 *  percentage, which is where the middle of the band sits in the picture: 0 is the
 *  top of it, 100 the bottom, and 50 the middle, which is what a picture with no
 *  answer gets.
 *
 *  Front matter because the file has to stay a file every other reader can read.
 *  Obsidian shows neither key and changes neither, so a note with a cover opens
 *  there as the note it is; the published page has read `cover:` as its `og:image`
 *  since before there was a banner to draw, which is the same key meaning the same
 *  thing.
 *
 *  A module of its own, next door to properties.ts and for the same reason: the
 *  editor draws the banner, the reading view draws it, the HTML export bakes it,
 *  a published page prints it and Word takes it as the note's first picture, and
 *  none of the five should have its own idea of which key or which middle. */

import { frontMatterValue } from './front-matter'
import { attributeUrl, escape, safeSrc } from './html'

/** The key the picture is written under. */
export const COVER_KEY = 'cover'

/** The key the band's position is written under. `cover-position`, hyphenated the
 *  way `icon-color` beside it is. */
export const COVER_POSITION_KEY = 'cover-position'

/** The middle of the picture, which is what a cover that never said gets. */
export const COVER_MIDDLE = 50

export interface Cover {
  /** The picture, as the note said it, with a wikilink's brackets off. Resolving
   *  it against a folder is the surface's own business: the app has a space to
   *  look in, a published page has the files beside it, and an export has bytes. */
  src: string
  /** Where the band is taken from, 0 to 100. */
  position: number
}

/** A percentage inside the picture: nothing outside 0 to 100 means anything, and
 *  anything unreadable is the middle. Rounded, because a cover is dragged with a
 *  pointer and a file full of `43.7183` is a file nobody wrote. */
export function coverPosition(said: string | null | undefined): number {
  const number = Number(said)
  if (said === null || said === undefined || said === '' || !Number.isFinite(number)) {
    return COVER_MIDDLE
  }

  return Math.min(100, Math.max(0, Math.round(number)))
}

/** A `[[picture.png]]`, an `![[picture.png]]` or a plain path, as the path. The
 *  alias after a `|` is a size or a caption elsewhere in a note and says nothing
 *  about which file this is. */
function pathIn(said: string): string {
  const link = /^!?\[\[([^\]]+)\]\]$/.exec(said.trim())
  const inner = link?.[1] ?? said.trim()
  const bar = inner.indexOf('|')

  return (bar === -1 ? inner : inner.slice(0, bar)).trim()
}

/** The note's cover, or null where it has none. */
export function coverOf(source: string): Cover | null {
  const said = frontMatterValue(source, COVER_KEY)
  if (said === null) return null

  const src = pathIn(said)
  if (!src) return null

  return { src, position: coverPosition(frontMatterValue(source, COVER_POSITION_KEY)) }
}

/** The banner, as the markup every surface that renders HTML puts above the note:
 *  the reading view, the HTML and ePub exports, and a published page.
 *
 *  One element, so one stylesheet draws it everywhere. The position is an inline
 *  `object-position`, which is the only part of it a note decides and so the only
 *  part that cannot live in the stylesheet. `loading="eager"` on purpose: it is the
 *  first thing on the page and the one picture nobody scrolls to.
 *
 *  Empty for a cover naming something that is not a picture address - the same
 *  answer the renderer gives a `![](javascript:…)`, which is to draw nothing. */
export function coverFigure(cover: Cover | null): string {
  if (cover === null || !safeSrc(cover.src)) return ''

  const src = attributeUrl(cover.src)
  const position = `object-position: 50% ${cover.position}%`

  return `<div class="nib-cover"><img src="${src}" alt="" loading="eager" style="${escape(position)}"></div>`
}
