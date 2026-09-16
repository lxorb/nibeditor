/** Somebody else's words, where markdown expects words.
 *
 *  A note is full of strings that came from outside it - a page's `<title>`, an
 *  `og:title`, the text of a link somebody right-clicked, a field a model filled
 *  in - and a note's own markup is markup: in a document of the reader's own the
 *  app renders the HTML in it, which is what makes `<u>` and `<details>` work and
 *  what Typora and Obsidian both do. So a page that calls itself
 *  `Fine <img src=x onerror=…>` wrote a tag into every clip of it, above the
 *  words, under a heading the reader never typed.
 *
 *  The converter has always escaped this in a page's prose; see escapes.ts, which
 *  is what a conversion's own text goes through and which reads the rule from
 *  here. The strings that never went through a converter are the ones this is
 *  for. */

/** A `<` the note would read as the start of a tag, a closing tag, a comment or a
 *  processing instruction: the four things CommonMark lets raw HTML begin with.
 *  `a < b` is not one of them and keeps its bracket. */
export const OPENS_MARKUP = /<(?=[A-Za-z/!?])/g

/** The same words with nothing in them that can open a tag, which is how markdown
 *  writes a literal bracket. Everything else a title carries is left alone: a `*`
 *  or a `#` in one is somebody's punctuation, and the worst it can do is lean the
 *  words it is next to. */
export function asWords(text: string): string {
  return text.replace(OPENS_MARKUP, '\\<')
}
