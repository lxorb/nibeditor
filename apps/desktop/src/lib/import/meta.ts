/** What a note knows about itself, written the way nib writes it.
 *
 *  Dates are the reason this exists. Every one of these exports knows when each
 *  note was written, and the moment it is imported every file on disk says it
 *  was written today: an import is a thousand files all made at once, and the
 *  file's own timestamps are the import's from then on. So what the export knew
 *  goes into the note, where it survives sync, a copy and another import.
 *
 *  `date` is the key nib already reads - an export uses it for the document's
 *  date - and it holds the day the note was made. `updated` is only written when
 *  the export knew a different last-edited day, and it is the export's own fact
 *  rather than a feature: nothing in the app reads it, and a note that never
 *  changed after it was written does not carry it. */

import { type FrontMatterRow, writeFrontMatter } from '@nib/markdown/front-matter'

export interface Meta {
  /** The day it was made, `YYYY-MM-DD`. */
  date?: string | null
  /** The day it was last edited, when that is a different day. */
  updated?: string | null
  tags?: readonly string[]
  /** Anything else the export carried under its own name: a database's columns,
   *  the address a page came from. */
  extra?: readonly (readonly [string, string])[]
}

/** A front matter block, or nothing at all when there is nothing to say. Which
 *  rows there are is decided here - only what the export knew - and how each value
 *  is spelled is @nib/markdown/front-matter's, shared with the clipper so that a
 *  clipped page and an imported note say the same thing the same way. */
export function frontMatterFor(meta: Meta): string {
  const rows: FrontMatterRow[] = []

  if (meta.date) rows.push(['date', meta.date])
  if (meta.updated && meta.updated !== meta.date) rows.push(['updated', meta.updated])

  const tags = tagList(meta.tags ?? [])
  if (tags.length) rows.push(['tags', tags])

  for (const [key, value] of meta.extra ?? []) {
    const name = propertyName(key)
    if (name && value.trim()) rows.push([name, value])
  }

  const written = writeFrontMatter(rows)
  return written ? `${written}\n\n` : ''
}

/** A whole note: its properties, its title as a heading, and its words.
 *
 *  The heading is written because a new note in nib opens with one, so an
 *  imported note that did not carry a title would be the one note in the space
 *  with nothing at the top. A body that already opens with a heading keeps its
 *  own. */
export function noteText(title: string | null, body: string, meta: Meta = {}): string {
  const words = body.replace(/^\s+/, '').replace(/\s+$/, '')
  const heads = /^#{1,6}\s/.test(words)
  const head = title && !heads ? `# ${title}\n\n` : ''

  return `${frontMatterFor(meta)}${head}${words}${words ? '\n' : ''}`
}

/** A property name YAML will read as one word, for a column called
 *  `Last edited time`. */
export function propertyName(key: string): string {
  return key
    .trim()
    .replace(/[^\w /-]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

/** What another app called a label, as a tag nib can hold: no spaces, no hash in
 *  front, and the slashes kept, because a nested tag is a nested tag in both. */
export function tagName(label: string): string {
  const one = label
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/{2,}/g, '/')

  return one
}

function tagList(tags: readonly string[]): string[] {
  const out: string[] = []

  for (const tag of tags) {
    const name = tagName(tag)
    if (name && !out.includes(name)) out.push(name)
  }

  return out
}

/** The day a date lands on, `YYYY-MM-DD`, out of whichever shape the export
 *  wrote it in. Null for anything that is not a date, so nothing invents one.
 *
 *  Every format in here writes its own: Evernote stamps `20260101T120000Z`,
 *  Keep counts microseconds since 1970, Roam counts milliseconds, Notion writes
 *  it out in English, and the rest write ISO. */
export function dayOf(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number' || /^\d{10,19}$/.test(value)) {
    const count = Number(value)
    if (!Number.isFinite(count) || count <= 0) return null
    // Seconds, milliseconds and microseconds, told apart by how many digits it
    // takes to be a date anybody has notes from.
    const digits = Math.floor(Math.abs(count)).toString().length
    const millis = digits <= 10 ? count * 1000 : digits <= 13 ? count : count / 1000
    return dayAt(new Date(millis))
  }

  const compact = /^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/.exec(value)
  if (compact) return dayFrom(Number(compact[1]), Number(compact[2]), Number(compact[3]))

  const written = /^(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})/.exec(value)
  if (written) return dayFrom(Number(written[1]), Number(written[2]), Number(written[3]))

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : dayAt(new Date(parsed))
}

/** The day an instant falls on where the reader is, rather than in UTC. A note
 *  written at eleven at night is that evening's note, and that is the date the
 *  app it came out of showed on it. */
function dayAt(when: Date): string | null {
  if (Number.isNaN(when.getTime())) return null
  return dayFrom(when.getFullYear(), when.getMonth() + 1, when.getDate())
}

/** A day written out, or null for one no note was written on. The range is what
 *  says a number was a date at all: an export with a zero in a timestamp field
 *  would otherwise arrive as the first of January 1970 on a thousand notes. */
function dayFrom(year: number, month: number, day: number): string | null {
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const written = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return `${year}-${written}`
}
