/** A value shown the way its property's format says (`nib.properties.<key>.format`,
 *  docs/tasks.md 4): a number as a percentage, an amount of money or a bar, and words
 *  as an address, a mail or a number to ring that a press opens. Notion's number
 *  formats and its URL, email and phone types, on a property that stays plain front
 *  matter.
 *
 *  A percentage is a share, 0.25 for 25 %, as Notion's is; a bar takes a share too, or
 *  a number of a hundred where it is more than one. Numbers in the app's language. */

import type { Value } from '@nib/bases'
import { i18n } from '../i18n.svelte'

/** The formats a column can be given, in the order its menu offers them. */
export const FORMATS = [
  'number',
  'percent',
  'currency:EUR',
  'currency:USD',
  'currency:CHF',
  'currency:GBP',
  'progress',
  'url',
  'email',
  'phone',
] as const

/** What a formatted cell draws: its words, an address its press opens, a bar's share. */
export interface Shown {
  text: string
  href?: string
  share?: number
}

function number(value: number, options: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(i18n.language, options).format(value)
  } catch {
    // A currency code Intl does not know: the number, plainly.
    return new Intl.NumberFormat(i18n.language).format(value)
  }
}

/** A value as its format shows it; null where the format has nothing to say about it
 *  (no format, or words under a number's format), and the cell draws it as ever. */
export function formatted(value: Value, format: string | undefined): Shown | null {
  if (format === undefined || value === null) return null
  if (typeof value === 'number') {
    if (format === 'percent') return { text: number(value, { style: 'percent' }) }
    if (format === 'progress') {
      const share = Math.max(0, Math.min(1, value > 1 ? value / 100 : value))
      return { text: number(share, { style: 'percent' }), share }
    }
    if (format.startsWith('currency:'))
      return { text: number(value, { style: 'currency', currency: format.slice(9) }) }
    if (format === 'number') return { text: number(value, {}) }
    return null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const words = value.trim()
  if (format === 'url')
    return { text: words, href: /^[a-z][a-z0-9+.-]*:/i.test(words) ? words : `https://${words}` }
  if (format === 'email') return { text: words, href: `mailto:${words}` }
  if (format === 'phone') return { text: words, href: `tel:${words.replace(/[^\d+]/g, '')}` }
  return null
}
