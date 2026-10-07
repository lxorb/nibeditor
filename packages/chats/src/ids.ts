/** The ids a device makes for its messages and events: ULIDs (docs/chats.md 4.3).
 *
 *  Made on the device, so an event resent after a lost answer is the same event and is
 *  answered with the place it already has, and a message drawn from the outbox has the
 *  id it will keep. A ULID sorts by when it was made, which an outbox's order and a
 *  store's index both lean on, and it is 26 characters a URL carries unescaped.
 *
 *  Pure: the clock and the randomness are the caller's, so a test makes the same ids. */

/** Crockford's base 32: no I, L, O or U, so an id read aloud is read right. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** The milliseconds a ULID's time holds: 48 bits, until the year 10889. */
const MOST_TIME = 2 ** 48 - 1

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

/** A new id: ten characters of `now` in milliseconds, then sixteen of randomness.
 *  `random` answers in [0, 1), as `Math.random` does. */
export function ulid(now: number, random: () => number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > MOST_TIME) {
    throw new RangeError(`no ULID holds the time ${String(now)}`)
  }
  let time = ''
  for (let rest = now, left = 10; left > 0; left -= 1) {
    time = digit(rest % 32) + time
    rest = Math.floor(rest / 32)
  }
  let noise = ''
  for (let left = 16; left > 0; left -= 1) noise += digit(Math.floor(random() * 32))
  return time + noise
}

function digit(value: number): string {
  // `random` may be anybody's: a value past the alphabet is clamped rather than lost.
  return ALPHABET.charAt(Math.min(31, Math.max(0, value)))
}

/** Whether a value is a ULID, upper case as `ulid` writes it. */
export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID.test(value)
}

/** When a ULID was made, in milliseconds; null for a value that is not one. */
export function ulidTime(id: string): number | null {
  if (!isUlid(id)) return null
  let time = 0
  for (const char of id.slice(0, 10)) time = time * 32 + ALPHABET.indexOf(char)
  return time
}
