/** A task's day said short, the reader's way: `Today`, `Tomorrow`, `Fri`, `9 Oct`, the
 *  year only where it is not this one, the time after it. Todoist's and Things' reading,
 *  which is the one a glance at a list wants (docs/tasks.md 5.7). One answer for the
 *  chips in a note and for quick add, so a day reads the same in both.
 *
 *  In the language the page is in (the `lang` the app writes on the root), the three
 *  words through the editor's labels, which the app translates. */

import { label } from './labels'

const languageOf = () =>
  typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined

/** Days since the epoch. */
const dayNumber = (iso: string) => {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

const momentOf = (iso: string, time = '00:00') => {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

const said = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(languageOf(), options).format(momentOf(iso))

/** `16:00`, or `4:00 PM`, as the language writes a time. */
export function timeWords(time: string): string {
  return new Intl.DateTimeFormat(languageOf(), { hour: 'numeric', minute: '2-digit' }).format(
    momentOf('2000-01-01', time),
  )
}

/** Today on this machine's clock. */
export function todayHere(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A day, and its time where it has one. */
export function dayWords(iso: string, today: string, time?: string): string {
  const ahead = dayNumber(iso) - dayNumber(today)
  let day: string
  if (ahead === 0) day = label('today')
  else if (ahead === 1) day = label('tomorrow')
  else if (ahead === -1) day = label('yesterday')
  else if (ahead > 1 && ahead < 7) day = said(iso, { weekday: 'short' })
  else if (iso.slice(0, 4) === today.slice(0, 4))
    day = said(iso, { day: 'numeric', month: 'short' })
  else day = said(iso, { day: 'numeric', month: 'short', year: 'numeric' })
  return time ? `${day} ${timeWords(time)}` : day
}
