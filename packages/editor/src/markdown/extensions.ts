import {
  Abbreviation,
  BlockMath,
  DefinitionList,
  Footnote,
  FrontMatter,
  Hashtag,
  Highlight,
  InlineMath,
  PercentComment,
  Wikilink,
} from './constructs'
import { FencedCode } from './fences'

/** What the markdown parser is taught on top of CommonMark and GFM.
 *
 *  The order is the order lezer-markdown applies them in, and it matters where
 *  two constructs could claim the same characters: see the `before` and `after`
 *  in each config for the pairs that do. `FencedCode` is last because it
 *  replaces the built-in parser of the same name rather than adding to it.
 *
 *  The constructs themselves are in constructs.ts, fenced code in fences.ts,
 *  the characters and tags they are written with in syntax.ts and tags.ts. */
export const nibMarkdownExtensions = [
  // First, so `[[…]]` and `![[…]]` are one link rather than a link or an image
  // wrapped around another one.
  Wikilink,
  // Before everything else that reads characters: what is inside a comment is
  // not read as anything.
  PercentComment,
  Highlight,
  InlineMath,
  BlockMath,
  Footnote,
  Hashtag,
  FrontMatter,
  DefinitionList,
  Abbreviation,
  FencedCode,
]
