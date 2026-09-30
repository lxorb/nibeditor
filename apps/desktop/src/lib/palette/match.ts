/** How the palette finds words in a name: `fuzzy`'s walk from the best place to start,
 *  where its letters landed, and a word one slip away.
 *
 *  Here rather than in fuzzy.ts, which every list that finds anything reads and which is
 *  in front of the first paint: these are the palette's, and it is fetched later. */

import { foldName } from '@nib/markdown/links'
import { walked } from '../fuzzy'

/** Where `fuzzy` counts a word as starting. */
const startsWord = (haystack: string, at: number) =>
  at === 0 || /[\s/\\_.-]/.test(haystack.charAt(at - 1))

/** Where the walk that scores best starts: at the first place the first letter is,
 *  or at any word that starts with it. The greedy walk alone takes the first `p` in
 *  `project plan` and scatters `plan` across both words; tried again from the word
 *  that starts with it, the four letters sit together, which is the reading a person
 *  meant. A few words at most, so a long name costs a few walks and not one per
 *  letter. */
function bestStart(needle: string, haystack: string): { score: number; first: number } | null {
  const head = needle.charAt(0)
  let best: { score: number; first: number } | null = null
  let tries = 0

  for (let at = haystack.indexOf(head); at >= 0 && tries < 6; at = haystack.indexOf(head, at + 1)) {
    if (best && !startsWord(haystack, at)) continue

    tries++
    const score = walked(needle, haystack, at)
    // Nothing after the first place the letter is can hold what that place could not.
    if (score === null && !best) return null
    if (score !== null && (!best || score > best.score)) best = { score, first: at }
  }

  return best
}

/** `fuzzy`, over strings already folded, from the best place to start. What the
 *  palette scores every row by, which folds each name once when it opens rather than
 *  on every keystroke. */
export function fuzzyFolded(needle: string, haystack: string): number | null {
  if (!needle) return 0

  const best = bestStart(needle, haystack)
  return best === null ? null : best.score - Math.floor(haystack.length / 12)
}

/** Where the letters of `query` land in `text` on the walk that scores best, for the
 *  row that draws them stronger. Null where they do not, or where folding changed
 *  the length of the text and the places would point at the wrong letters. */
export function fuzzyPlaces(query: string, text: string): number[] | null {
  const needle = foldName(query)
  const haystack = foldName(text)
  if (!needle || haystack.length !== text.length) return null

  const best = bestStart(needle, haystack)
  if (!best) return null

  const at: number[] = []
  walked(needle, haystack, best.first, at)
  return at
}

/** Whether two words are one slip apart: a letter wrong, missing, extra, or two
 *  swapped. What a hand typing fast gets wrong. */
export function oneSlip(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false

  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (i === a.length && i === b.length) return true

  const rest = (x: string, from: number) => x.slice(from)
  return (
    rest(a, i + 1) === rest(b, i + 1) ||
    rest(a, i + 1) === rest(b, i) ||
    rest(a, i) === rest(b, i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && rest(a, i + 2) === rest(b, i + 2))
  )
}

/** Whether a folded word is one slip away from the start of a word in a folded
 *  name: `shotrcuts` from `shortcuts`, `setings` from `settings`. Only for words of
 *  five letters and more: a four-letter word is one slip from dozens, and `dark`
 *  finding `markdown` is a guess nobody would make. */
export function nearly(word: string, haystack: string): boolean {
  if (word.length < 5) return false

  for (let at = 0; at < haystack.length; at++) {
    if (!startsWord(haystack, at)) continue

    for (const length of [word.length, word.length - 1, word.length + 1]) {
      if (oneSlip(word, haystack.slice(at, at + length))) return true
    }
  }

  return false
}
