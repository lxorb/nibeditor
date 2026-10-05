/** How long ago something happened, as the number and unit
 *  `Intl.RelativeTimeFormat` wants.
 *
 *  Pure, and apart from the pane that shows it, because the rule is a list of
 *  thresholds and the pane should be left with the sentence. Which unit a stretch
 *  of time is said in is the whole of the decision: seconds for the first minute,
 *  minutes for the first hour, hours for the first day, days after that.
 *
 *  Seconds matter here more than they look as though they should. Recently
 *  deleted is most often opened in the moment after deleting something, and a row
 *  that says "deleted 1 minute ago" about a note that went two seconds ago is a
 *  sentence the reader can see is false - on the one row they are looking at.
 *
 *  A stamp from the future is now. The trash holds rows the account sent as well
 *  as rows this device wrote, and two machines do not agree about the time to the
 *  second; "in 4 seconds" about something that has already happened is worse than
 *  a rounding. */

export interface Step {
  value: number
  unit: Intl.RelativeTimeFormatUnit
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `elapsed` is how long ago in milliseconds, so the value is negative: that is
 *  the direction `Intl.RelativeTimeFormat` reads as the past. */
export function relativeStep(elapsed: number): Step {
  if (elapsed < MINUTE) {
    // Written this way round so that no time at all is zero rather than minus
    // zero, which is the same second and a different value to read in a test.
    const seconds = Math.max(0, Math.round(elapsed / SECOND))
    return { value: seconds === 0 ? 0 : -seconds, unit: 'second' }
  }

  if (elapsed < HOUR) return { value: -Math.round(elapsed / MINUTE), unit: 'minute' }
  if (elapsed < DAY) return { value: -Math.round(elapsed / HOUR), unit: 'hour' }

  return { value: -Math.round(elapsed / DAY), unit: 'day' }
}

const formats = new Map<string, Intl.RelativeTimeFormat>()

/** How long ago, as short as the language says it ("3h ago", "vor 3 Std."): a row's
 *  age at the end of a list of threads. One formatter per language, made once. */
export function agoShort(at: number, language: string, now = Date.now()): string {
  let format = formats.get(language)
  if (!format) {
    try {
      format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'narrow' })
    } catch {
      format = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })
    }
    formats.set(language, format)
  }
  const step = relativeStep(now - at)
  return format.format(step.value, step.unit)
}
