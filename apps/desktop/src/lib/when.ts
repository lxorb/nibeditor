/** A moment, said as shortly as it can be said without becoming ambiguous.
 *
 *  One from today is a time and nothing else: the date would be the same words on
 *  every row, and almost every row worth reading is from today. Anything older says
 *  its day as well, in `dateStyle` - the history sheet's `medium`, which has room for
 *  a month's name, or the sync pane's `short`. */

import { i18n } from './i18n.svelte'

export function when(stamp: number, dateStyle: 'short' | 'medium', now = new Date()): string {
  const at = new Date(stamp)
  const today =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()

  return today
    ? i18n.when(at, { timeStyle: 'short' })
    : i18n.when(at, { dateStyle, timeStyle: 'short' })
}
