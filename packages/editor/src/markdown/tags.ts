import { Tag } from '@lezer/highlight'

/** Highlighting tags for the constructs CommonMark and GFM do not define, so
 *  that theme.ts can give each one a colour by name.
 *
 *  A file of its own because a tag is compared by identity: the parser and the
 *  highlight style have to be looking at the same object, and a second copy
 *  would simply never match. */
export const markTags = {
  highlight: Tag.define(),
  math: Tag.define(),
  footnote: Tag.define(),
  frontMatter: Tag.define(),
  hashtag: Tag.define(),
}
