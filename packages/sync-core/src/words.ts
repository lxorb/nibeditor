/** Where words start and end, for the two readers that think in words rather than in
 *  characters: the classifier, which has to see "noon" changed to "one" as one word
 *  changed and not as two letters deleted and one typed; and the modal, which marks
 *  the words that differ between two passages.
 *
 *  A word is a run of letters, digits and combining marks, in any script that puts
 *  spaces between its words. Chinese and Japanese do not, so each of their characters
 *  counts as a word of its own: taking a whole run of them as one word would make one
 *  changed character a changed sentence. Deliberately not `Intl.Segmenter`, whose
 *  dictionaries differ between the engines nib runs on, so the same two texts would
 *  classify differently on a Mac and in the Worker. */

const LETTERS = /^[\p{L}\p{N}\p{M}_]$/u
const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u

/** Whether one character (a whole code point) belongs to a word that runs on. */
export function isWordChar(char: string): boolean {
  return char !== '' && LETTERS.test(char) && !UNSPACED.test(char)
}

/** The character that ends just before `at`, whole: two code units for a pair. */
export function charBefore(text: string, at: number): string {
  if (at <= 0) return ''
  const low = text.charCodeAt(at - 1)
  if (at >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(at - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at)
  }
  return text.charAt(at - 1)
}

/** The character that starts at `at`, whole. */
export function charAt(text: string, at: number): string {
  if (at >= text.length) return ''
  const code = text.codePointAt(at) ?? 0
  return String.fromCodePoint(code)
}

/** Where the word that `at` falls inside or at the end of begins. */
export function wordStart(text: string, at: number): number {
  let place = at
  for (let char = charBefore(text, place); isWordChar(char); char = charBefore(text, place)) {
    place -= char.length
  }
  return place
}

/** Where the word that `at` falls inside or at the start of ends. */
export function wordEnd(text: string, at: number): number {
  let place = at
  for (let char = charAt(text, place); isWordChar(char); char = charAt(text, place)) {
    place += char.length
  }
  return place
}

/** A text as its words, the spaces between them, and everything else one character
 *  at a time, in order: what a word-level diff compares. */
export function tokens(text: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    const char = charAt(text, at)
    let end = at + char.length
    if (isWordChar(char)) end = wordEnd(text, at)
    else if (/^\s$/u.test(char)) while (end < text.length && /^\s$/u.test(text.charAt(end))) end++
    out.push(text.slice(at, end))
    at = end
  }
  return out
}
