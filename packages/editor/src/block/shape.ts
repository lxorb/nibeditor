/** Turning a block into another kind of block: the arithmetic, on one line at a
 *  time.
 *
 *  What a paragraph, a heading, a bullet, a number, a box and a quote have in
 *  common in markdown is that each of them is a few characters in front of the
 *  words. So turning one into another is taking whatever is there off and putting
 *  what was asked for on - and the only hard part is that a line may be carrying
 *  several of them at once: `> - [ ] still to do` is a quoted task inside a list.
 *
 *  Its own module and nothing but functions on strings, because this is the half
 *  that can be read and tested without an editor in front of it. Which lines get
 *  asked is commands.ts, which has the selection and the blocks.
 *
 *  Deliberately not the toggles in commands.ts at the root of this package. Those
 *  are what a key press means - press it again and the bullet comes off - and a
 *  menu row saying "bullet" over four blocks means make these four bullets,
 *  whatever they are now. A row that took the bullets off four bullets would be a
 *  row nobody could predict. */

/** What a block can be turned into. Obsidian and Notion offer the same handful,
 *  and it is the handful markdown actually has: a heading at the three levels
 *  anybody writes, plain words, the three kinds of list, and a quote. */
export type BlockShape =
  'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'task' | 'quote'

/** The indentation a line sits behind, which every shape keeps: a bullet nested
 *  under another bullet is still nested when it becomes a task. */
const INDENT = /^[ \t]*/

/** However many quote marks open the line, and the space after each. */
const QUOTED = /^(?:>[ \t]?)+/

/** A heading's hashes and the whitespace that has to follow them. */
const HASHES = /^#{1,6}[ \t]+/

/** A list marker - a bullet or a number - and the box that may follow it, which is
 *  what makes the item a task. */
const MARKER = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/

/** A line as the words in it and the indentation they sat behind.
 *
 *  Everything in front of the words comes off, in the order markdown allows it to
 *  be written: the quote marks outermost, then a heading's hashes or a list
 *  marker, then the box. Nothing else is touched - what is left is the line's own
 *  words, punctuation, emphasis and links included. */
export function wordsOf(text: string): { indent: string; words: string } {
  const indent = INDENT.exec(text)?.[0] ?? ''
  const words = text
    .slice(indent.length)
    .replace(QUOTED, '')
    .replace(HASHES, '')
    .replace(MARKER, '')

  return { indent, words }
}

/** What a shape writes in front of the words. `nth` is which item this is, from
 *  one, which only a numbered list reads. */
function markFor(shape: BlockShape, nth: number): string {
  switch (shape) {
    case 'heading1':
      return '# '
    case 'heading2':
      return '## '
    case 'heading3':
      return '### '
    case 'paragraph':
      return ''
    case 'bullet':
      return '- '
    case 'numbered':
      return `${nth}. `
    case 'task':
      return '- [ ] '
    case 'quote':
      return '> '
  }
}

/** One line in the shape asked for. A line with no words in it comes back
 *  untouched: a marker in front of nothing is a bullet the writer never asked
 *  for, and the blank line between two paragraphs is what makes them two. */
export function shaped(text: string, shape: BlockShape, nth = 1): string {
  const { indent, words } = wordsOf(text)
  if (!words.trim()) return text

  return indent + markFor(shape, nth) + words
}
