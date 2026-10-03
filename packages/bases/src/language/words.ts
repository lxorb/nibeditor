/** A line typed into quick add as words, each knowing where it stands.
 *
 *  Every reader here walks words rather than characters, and every answer is a
 *  span of the line as typed, so a recognised phrase can be drawn as a chip exactly
 *  over the characters it was read from. */

export interface Word {
  /** As typed. */
  raw: string
  /** Lower case, a comma or a semicolon after it taken off: what a table is asked. */
  key: string
  from: number
  to: number
}

export function wordsOf(text: string): Word[] {
  const out: Word[] = []
  for (const found of text.matchAll(/\S+/gu)) {
    const raw = found[0]
    out.push({
      raw,
      key: raw.toLowerCase().replace(/[,;]+$/u, ''),
      from: found.index,
      to: found.index + raw.length,
    })
  }
  return out
}

/** A word as a table lists it: the dot an abbreviation carries taken off too. */
export const bare = (word: Word | undefined): string => (word?.key ?? '').replace(/\.$/u, '')

/** Whether the words from `at` are this phrase. */
export function phraseAt(words: readonly Word[], at: number, phrase: readonly string[]): boolean {
  return phrase.every((one, index) => bare(words[at + index]) === one)
}

/** The longest of several phrases standing at `at`: how many words it is, 0 for none. */
export function longestAt(
  words: readonly Word[],
  at: number,
  phrases: readonly (readonly string[])[],
): number {
  let most = 0
  for (const phrase of phrases) {
    if (phrase.length > most && phraseAt(words, at, phrase)) most = phrase.length
  }
  return most
}
