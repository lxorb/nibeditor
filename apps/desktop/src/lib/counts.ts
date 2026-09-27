/** What the status bar counts.
 *
 *  Written as a single pass that allocates nothing: the obvious
 *  `text.trim().split(/\s+/)` builds an array with one entry per word, and on a
 *  note of a few hundred kilobytes that is the most expensive thing the app
 *  does. It is only ever asked for while the numbers are on screen, but even
 *  then it should not be felt. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import type { PropertiesMode } from '@nib/markdown/properties'

export interface Counts {
  words: number
  characters: number
  lines: number
  /** At the 200 words per minute Typora reads at, and never less than one. */
  minutes: number
}

function isSpace(code: number): boolean {
  // Space, tab, newline, carriage return, vertical tab, form feed, and the
  // no-break space, which a keyboard layout can produce between words.
  return (
    code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x3000 || code === 0x200b
  )
}

export function countText(text: string): Counts {
  let words = 0
  let lines = text.length ? 1 : 0
  let inWord = false

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) lines++

    if (isSpace(code)) {
      inWord = false
    } else if (!inWord) {
      inWord = true
      words++
    }
  }

  return {
    words,
    characters: text.length,
    lines,
    minutes: Math.max(1, Math.round(words / 200)),
  }
}

/** What the status bar counts of a note: all of it, or what is on the page where the
 *  reader keeps the front matter hidden. Metadata nobody can see is not three words
 *  and forty characters of a note that says one line. */
export function countNote(text: string, properties: PropertiesMode): Counts {
  const block = properties === 'hidden' ? frontMatterBlock(text) : null
  return countText(block ? text.slice(block.to) : text)
}
