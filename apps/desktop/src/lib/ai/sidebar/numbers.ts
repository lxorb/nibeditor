/** The two kinds of number the panel says: a count of tokens, as short as it can be
 *  said (412K, 1M), and a length of time in seconds. Both in the app's language, both
 *  through `Intl`, so a German reader reads "412.000" as "412.000" and "6 s" as their
 *  own unit. Pure: the language is handed in. */

const made = new Map<string, Intl.NumberFormat>()

/** One formatter per language and shape, made once. */
function formatter(language: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${language} ${JSON.stringify(options)}`
  const held = made.get(key)
  if (held) return held
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat(language, options)
  } catch {
    // A tag Intl does not know (a catalogue of our own, say) reads in English
    // rather than throwing in the middle of a frame.
    format = new Intl.NumberFormat('en', options)
  }
  made.set(key, format)
  return format
}

/** A count of tokens: 980, 41K, 412K, 1M. One decimal only under ten of a unit,
 *  where it changes what the reader learns (2.4K is not 2K). */
export function tokens(count: number, language: string): string {
  const leading = count >= 1_000_000 ? count / 1_000_000 : count / 1_000
  return formatter(language, {
    notation: 'compact',
    maximumFractionDigits: count >= 1_000 && leading < 10 ? 1 : 0,
  }).format(Math.max(0, Math.round(count)))
}

/** How long something has run, in whole minutes: a goal's clock. */
export function minutes(ms: number, language: string): string {
  return formatter(language, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
  }).format(Math.max(0, Math.floor(ms / 60_000)))
}

/** A length of time, in whole seconds, never less than one: a thought that took
 *  0.3 s took a second as far as anybody reading the row is concerned. */
export function seconds(ms: number, language: string): string {
  return formatter(language, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
  }).format(Math.max(1, Math.round(ms / 1000)))
}
