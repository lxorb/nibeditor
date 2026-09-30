/** A few keys of a big JSON object, found without parsing the rest of it.
 *
 *  A canvas of ten thousand strokes is megabytes of JSON, nearly all of it ink, and
 *  what the link index wants out of it is a handful of cards and an icon. Parsing the
 *  whole of it to get those builds every point of every stroke first: a plane of
 *  seven megabytes was a third of a second of the space's scan in one task, for a
 *  row of the file list. So this walks the text and hands back where the wanted
 *  values are, and the caller parses those and nothing else.
 *
 *  What is skipped is walked for its structure - the brackets and the strings, so a
 *  bracket inside a string is not taken for one that closes - and not for every
 *  comma and colon in it. That is what the crate's reader does with the same keys
 *  (serde's `IgnoredAny`), and it is enough to find the end of a value. Whether a
 *  plane is well formed is `readCanvas`'s question, asked when the plane is opened. */

/** Where a value is in the text: `text.slice(from, to)` is its JSON. */
export interface Span {
  from: number
  to: number
}

/** How deeply the skipped part may nest before the text is not believed. Far past
 *  anything a canvas writes, and short of what would take the walk's stack with it. */
const DEEPEST = 512

const QUOTE = 0x22
const BACKSLASH = 0x5c
const COLON = 0x3a
const COMMA = 0x2c
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09
}

function skipSpace(text: string, at: number, end: number): number {
  let one = at
  while (one < end && isSpace(text.charCodeAt(one))) one++
  return one
}

/** Past the string that starts at `at`, or -1 where it never closes. A quote with
 *  an odd run of backslashes before it is one of the string's own characters. */
function pastString(text: string, at: number, end: number): number {
  let close = text.indexOf('"', at + 1)

  while (close >= 0 && close < end) {
    let slashes = 0
    while (text.charCodeAt(close - 1 - slashes) === BACKSLASH) slashes++
    if (slashes % 2 === 0) return close + 1
    close = text.indexOf('"', close + 1)
  }

  return -1
}

/** Past the object or array that starts at `at`, or -1 where its brackets do not
 *  close in order.
 *
 *  From one character that says something to the next, found with `indexOf`, which
 *  the engine runs over a string far faster than a loop can look at each character:
 *  the ink is a million numbers, and walking them one character at a time was slower
 *  than `JSON.parse` building every one of them. Five places are kept - the next
 *  quote and the next of each bracket - and only the one used is looked for again,
 *  so the text is gone over five times at most, at that speed. A bracket inside a
 *  string moves on past it with the string. */
function pastContainer(text: string, at: number, end: number): number {
  const next = (mark: string, from: number) => {
    const found = text.indexOf(mark, from)
    return found < 0 || found >= end ? end : found
  }

  const owed: number[] = []
  let quote = next('"', at)
  let openBrace = next('{', at)
  let closeBrace = next('}', at)
  let openBracket = next('[', at)
  let closeBracket = next(']', at)

  for (;;) {
    const one = Math.min(quote, openBrace, closeBrace, openBracket, closeBracket)
    if (one >= end) return -1

    if (one === quote) {
      const past = pastString(text, one, end)
      if (past < 0) return -1

      quote = next('"', past)
      if (openBrace < past) openBrace = next('{', past)
      if (closeBrace < past) closeBrace = next('}', past)
      if (openBracket < past) openBracket = next('[', past)
      if (closeBracket < past) closeBracket = next(']', past)
    } else if (one === openBrace || one === openBracket) {
      if (owed.length >= DEEPEST) return -1

      if (one === openBrace) {
        owed.push(CLOSE_BRACE)
        openBrace = next('{', one + 1)
      } else {
        owed.push(CLOSE_BRACKET)
        openBracket = next('[', one + 1)
      }
    } else {
      const closer = one === closeBrace ? CLOSE_BRACE : CLOSE_BRACKET
      if (owed.pop() !== closer) return -1
      if (!owed.length) return one + 1

      if (closer === CLOSE_BRACE) closeBrace = next('}', one + 1)
      else closeBracket = next(']', one + 1)
    }
  }
}

/** Past the value that starts at `at`, or -1. */
function pastValue(text: string, at: number, end: number): number {
  const code = text.charCodeAt(at)
  if (code === QUOTE) return pastString(text, at, end)
  if (code === OPEN_BRACE || code === OPEN_BRACKET) return pastContainer(text, at, end)

  // A number, `true`, `false` or `null`: up to whatever ends it.
  let one = at
  while (one < end) {
    const next = text.charCodeAt(one)
    if (next === COMMA || next === CLOSE_BRACE || next === CLOSE_BRACKET || isSpace(next)) break
    one++
  }

  return one > at ? one : -1
}

/** What a caller knows of the order the object was written in, so the walk can stop
 *  before the end of it. Both are about text this app wrote; see scan-canvas.ts. */
export interface Order {
  /** The keys a writer puts first, in its order: an object whose first key is the
   *  first of these is read no further than the first key that is none of them. */
  ahead?: readonly string[]
  /** The key a writer puts last: once it is reached with every other wanted key
   *  found, its value is taken to run to the end of `within`, unread. */
  last?: string
}

/** Where each of `keys` is in the object that `within` spans (the whole text when
 *  it is not given), or null when that is not an object. A key written twice is the
 *  later one, as `JSON.parse` has it; a key not there is not in the answer. */
export function skim(
  text: string,
  keys: readonly string[],
  within: Span = { from: 0, to: text.length },
  order: Order = {},
): Map<string, Span> | null {
  const end = within.to
  let at = skipSpace(text, within.from, end)
  if (text.charCodeAt(at) !== OPEN_BRACE) return null

  const found = new Map<string, Span>()
  at = skipSpace(text, at + 1, end)
  if (text.charCodeAt(at) === CLOSE_BRACE) return found

  let ahead: readonly string[] | null = null
  for (let first = true; ; first = false) {
    if (text.charCodeAt(at) !== QUOTE) return null
    const named = pastString(text, at, end)
    if (named < 0) return null

    // A key with an escape in it is read the long way; every key a canvas writes is
    // plain.
    const raw = text.slice(at + 1, named - 1)
    const key = raw.includes('\\') ? String(JSON.parse(text.slice(at, named)) as unknown) : raw

    if (first && order.ahead?.[0] === key) ahead = order.ahead
    if (ahead && !ahead.includes(key)) return found

    at = skipSpace(text, named, end)
    if (text.charCodeAt(at) !== COLON) return null

    const from = skipSpace(text, at + 1, end)
    if (key === order.last && keys.every((one) => one === key || found.has(one))) {
      found.set(key, { from, to: end })
      return found
    }

    const to = pastValue(text, from, end)
    if (to < 0) return null
    if (keys.includes(key)) found.set(key, { from, to })

    at = skipSpace(text, to, end)
    const next = text.charCodeAt(at)
    if (next === CLOSE_BRACE) return found
    if (next !== COMMA) return null
    at = skipSpace(text, at + 1, end)
  }
}
