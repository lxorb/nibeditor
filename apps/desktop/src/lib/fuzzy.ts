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

  const score = walked(foldName(query), foldName(text), 0)
  // Shorter targets win ties: an exact-length match is the best kind.
  return score === null ? null : score - Math.floor(text.length / 12)
}

/** `fuzzy` over folded strings, from `first`; `at` takes where each letter landed. */
export function walked(needle: string, haystack: string, first: number, at?: number[]) {
  let score = 0
  let cursor = first
  let previous = -2

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor)
    if (found < 0) return null

    if (found === previous + 1) score += 8
    // `charAt`, which answers '' before the first letter rather than undefined.
    if (found === 0 || /[\s/\\_.-]/.test(haystack.charAt(found - 1))) score += 6
    score -= Math.min(found - cursor, 12)

    at?.push(found)
    previous = found
    cursor = found + 1
  }

  return score
}

/** The best any of several readings of one thing scores: a note is found by its
 *  name and by the path to it, and whichever answers better is how well it matched. */
export function fuzzyAny(query: string, texts: readonly string[]): number | null {
  let best: number | null = null
  for (const text of texts) {
    const score = fuzzy(query, text)
    if (score !== null && (best === null || score > best)) best = score
  }

  return best
}

/** The items that match, best first. A tie keeps the order the items came in -
 *  the sort is stable - which is what `recentFirst` leans on. */
export function rank<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string | readonly string[],
): T[] {
  return items
    .map((item) => {
      const said = label(item)
      return { item, score: typeof said === 'string' ? fuzzy(query, said) : fuzzyAny(query, said) }
    })
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

/** The items with the ones `recent` names moved to the front, most recent first,
 *  and the rest in the order they came.
 *
 *  Ranked afterwards, this is the whole order of a field with nothing typed in it,
 *  since every item then scores the same, and it breaks every tie once something
 *  is: of two notes that match equally well, the one opened last comes first. What
 *  VS Code's and Obsidian's quick open both do. */
export function recentFirst<T>(
  items: readonly T[],
  recent: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const place = new Map(recent.map((key, index) => [key, index]))
  const head: T[] = []
  const rest: T[] = []

  for (const item of items) (place.has(keyOf(item)) ? head : rest).push(item)

  const at = (item: T) => place.get(keyOf(item)) ?? 0
  return [...head.sort((one, other) => at(one) - at(other)), ...rest]
}
