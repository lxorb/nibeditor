import { foldName } from '@nib/markdown/links'

/** Subsequence match with a score. Higher is better; null means no match.
 *  Consecutive hits and matches at word starts are rewarded, so "rdm" ranks
 *  "Read me" above a note that merely contains those letters scattered.
 *
 *  Exported as well as used below, because the icon picker wants the score rather
 *  than the order: there a subsequence is the last resort under the exact matches,
 *  and the number is what places it inside that band. See icons.ts. */
export function fuzzy(query: string, text: string): number | null {
  if (!query) return 0

  // Composed as well as folded, so a note whose name a Mac tool wrote with a
  // decomposed `Ü` is found by the `Ü` a keyboard types; see `foldName`.
  const needle = foldName(query)
  const haystack = foldName(text)

  let score = 0
  let cursor = 0
  let previous = -2

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor)
    if (found < 0) return null

    if (found === previous + 1) score += 8
    // `charAt` rather than an index: at the start of the string there is no
    // character before it, and it answers an empty one instead of undefined.
    if (found === 0 || /[\s/\\_.-]/.test(haystack.charAt(found - 1))) score += 6
    score -= Math.min(found - cursor, 12)

    previous = found
    cursor = found + 1
  }

  // Shorter targets win ties: an exact-length match is the best kind.
  return score - Math.floor(text.length / 12)
}

export function rank<T>(query: string, items: T[], label: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: fuzzy(query, label(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}
