/** What kind of value a property holds, asked the one way: a date, a span of time,
 *  a link, or a day written as words. Values are the engine's (`Value` in
 *  @nib/bases), and a map that happens to have a `kind` key is still a map, so the
 *  question is asked of the shape and not of the key alone. */

import type { DateValue, DurationValue, LinkValue, Value } from '@nib/bases'

function kindOf(value: Value | undefined): string | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value))
    return null
  const kind = 'kind' in value ? value.kind : null
  return typeof kind === 'string' ? kind : null
}

export function isDateValue(value: Value | undefined): value is DateValue {
  return (
    kindOf(value) === 'date' &&
    typeof value === 'object' &&
    value !== null &&
    'iso' in value &&
    typeof value.iso === 'string'
  )
}

export function isDurationValue(value: Value | undefined): value is DurationValue {
  return kindOf(value) === 'duration'
}

export function isLinkValue(value: Value | undefined): value is LinkValue {
  return kindOf(value) === 'link'
}

/** A value as a day, where it is one: a date, or words that start with one. */
export function dayIn(value: Value | undefined): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return isDateValue(value) ? value.iso : null
}
