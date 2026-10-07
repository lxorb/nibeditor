/** Skin tones (docs/chats.md 3, #32): the five Fitzpatrick modifiers, and an emoji
 *  written in one of them.
 *
 *  Unicode puts the modifier straight after the person it colours, in place of the
 *  presentation selector that would otherwise ask for colour, so 👍 becomes 👍🏽 and ✌️
 *  becomes ✌🏽. A sequence of several people joined into one picture takes it after the
 *  first; the platform's font draws the rest as it can. Pure. */

/** No tone, then light to dark. */
export const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'] as const

export type Tone = 0 | 1 | 2 | 3 | 4 | 5

/** `emoji` in `tone`, where `toned` says it takes one; otherwise as it is. */
export function inTone(emoji: string, tone: Tone, toned: ReadonlySet<string>): string {
  if (tone === 0 || !toned.has(emoji)) return emoji
  const [first, ...rest] = Array.from(emoji)
  if (first === undefined) return emoji
  const after = rest[0] === '️' ? rest.slice(1) : rest
  return `${first}${TONES[tone]}${after.join('')}`
}
