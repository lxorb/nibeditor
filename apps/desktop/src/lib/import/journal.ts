/** Apple Journal, which hands over a folder of HTML and a folder of media.
 *
 *  Journal keeps its entries in a database only it can open, the way Notes does,
 *  and the one way out is the app's own Export: `AppleJournalEntries`, holding
 *  `Entries/` with one HTML document per entry and `Resources/` with the photos,
 *  videos and recordings, plus a JSON per file saying when it was taken and
 *  where.
 *
 *  So the HTML is what is read, through the same converter every other HTML
 *  export goes through, and the two things the document says about itself are
 *  lifted out first: the day the entry was written, which becomes `date`, and its
 *  title, which becomes the note's name and its heading.
 *
 *  The day is taken from the entry's own file name - `2026-09-04_1A2B….html` -
 *  rather than from the line Journal draws above it, because that line is written
 *  in the language of the phone it came off, and `Freitag, 5. Dezember 2025` is a
 *  date nothing in here is going to read. The line is the fallback, for an export
 *  whose names carry no date.
 *
 *  Every entry becomes one note named after its day, so a year of them sorts in
 *  the file list the way Logseq's and Roam's journals do, and the media land in
 *  `assets/` beside them, which is where a picture pasted into a note goes. */

import { htmlToMarkdown } from '@nib/markdown/from-html'

import { key } from '../i18n.svelte'
import { folderPlan, isJunk } from './folder'
import { dayOf } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan } from './plan'
import type { Source } from './sources'
import { closingOf, tagsIn, unescapeXml } from './xml'

/** One entry: an HTML document under `Entries/`. */
const ENTRY = /(^|\/)entries\/[^/]+\.html?$/i

/** A photo, a video, a recording, or Journal's own JSON about one. */
const RESOURCE = /(^|\/)resources\/[^/]+$/i

/** What Apple's cameras write. Only Apple's own software shows it, so it is said
 *  out loud rather than quietly imported as a broken picture. */
const HEIC = /\.(heic|heif)$/i

/** The day an entry's file name carries. */
const DAY = /(\d{4}-\d{2}-\d{2})/

/** The tags that point at a file. A video and a recording are dropped by the
 *  HTML converter - a note is markdown, and markdown has no player - so those
 *  are collected here and written as links instead. */
const MEDIA = new Set(['img', 'video', 'audio', 'source'])

/** The cards Journal draws rather than writes: a mood, a walk, a map. */
const DRAWN = /assetType_(stateOfMind|motionActivity|genericMap)/i

/** What one entry's document said. */
interface Entry {
  /** `YYYY-MM-DD`, or null for an entry that dated nothing. */
  date: string | null
  title: string
  body: string
  /** Cards with a picture and no words, which do not come over. */
  drawn: number
}

export async function readJournal(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const entries = new Map<string, Entry>()
  let drawn = 0
  let heic = 0

  // Read before placing: an entry's name is its title, and the title is inside
  // the document rather than on it.
  for (const source of sources) {
    if (isJunk(source.path) || !ENTRY.test(source.path)) continue
    const entry = entryOf(await source.text(), source.path)
    drawn += entry.drawn
    entries.set(source.path, entry)
  }

  const plan = await folderPlan(sources, {
    format: 'journal',
    place: (source) => {
      const entry = entries.get(source.path)
      if (entry) {
        return {
          to: names.free(`${nameFor(entry, source.path)}.md`),
          read: () => ({
            text: entry.body,
            title: entry.title || null,
            meta: { date: entry.date },
          }),
        }
      }

      if (isJunk(source.path) || !RESOURCE.test(source.path)) return { to: null }

      // Journal's own JSON about a photo: the moment it was taken and the place
      // it was taken in. The entry carries its day already and the place is in
      // the entry's own words, so this is neither a note nor a file to open.
      if (/\.json$/i.test(source.path)) return { to: null }

      const name = source.path.split('/').pop() ?? source.path
      if (HEIC.test(name)) heic += 1

      return { to: names.free(`assets/${safeName(name)}`) }
    },
  })

  if (heic) {
    plan.lost.push({
      text: key('{count} pictures came as HEIC, which nothing but Apple shows'),
      values: { count: heic },
    })
  }

  if (drawn) {
    plan.lost.push({
      text: key('{count} mood and activity cards are drawings, so only their words come over'),
      values: { count: drawn },
    })
  }

  return plan
}

/** What an entry's note is called: the day it was written, and its title after
 *  that where it has one. The day comes first so a year of entries sorts. */
function nameFor(entry: Entry, path: string): string {
  const said = [entry.date, entry.title].filter(Boolean).join(' ')
  if (said) return safeName(said)

  const name = path.split('/').pop() ?? path
  return safeName(name.replace(/\.html?$/i, ''))
}

/** One entry, read out of its document. */
function entryOf(html: string, path: string): Entry {
  const header = divWithClass(html, 'pageHeader')
  const title = divWithClass(html, 'title')

  // The two lines the note says twice otherwise: the date is front matter and
  // the title is the heading. Cut from the back so the first span still lines up.
  let rest = html
  for (const cut of [header, title].filter(isSpan).sort((one, two) => two.from - one.from)) {
    rest = rest.slice(0, cut.from) + rest.slice(cut.to)
  }

  const name = path.split('/').pop() ?? path
  const date = dayOf(DAY.exec(name)?.[1]) ?? dayOf(words(header?.inner ?? ''))

  return {
    date,
    title: words(title?.inner ?? ''),
    body: withMedia(htmlToMarkdown(rest, { fileTargets: true }), html),
    drawn: drawnCards(html),
  }
}

/** Where one `<div class="…">` sits in the document, and what is between its
 *  tags. Journal names every part of an entry this way: `pageHeader` for the
 *  date, `title` for the title, `bodyText` for the words, `gridItem` for each
 *  photo, mood and map. */
interface Span {
  from: number
  to: number
  inner: string
}

function divWithClass(html: string, wanted: string): Span | null {
  for (const tag of tagsIn(html)) {
    if (tag.closing || tag.name.toLowerCase() !== 'div') continue
    if (!named(tag.attributes.class ?? '', wanted)) continue
    if (tag.empty) return { from: tag.from, to: tag.to, inner: '' }

    const closes = closingOf(html, tag.name, tag.to)
    const after = html.indexOf('>', closes)

    return {
      from: tag.from,
      to: after < 0 ? html.length : after + 1,
      inner: html.slice(tag.to, closes),
    }
  }

  return null
}

/** Whether a class attribute holds this class, rather than one it is the start
 *  of: `title` is not `titleCard`. */
function named(attribute: string, wanted: string): boolean {
  return attribute.split(/\s+/).includes(wanted)
}

function isSpan(span: Span | null): span is Span {
  return !!span
}

/** The words inside some markup, with the tags taken out. For the date and the
 *  title, both of which Journal writes as a span inside a div. */
function words(inner: string): string {
  return unescapeXml(inner.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The media the HTML converter left behind, written as links.
 *
 *  A picture survives the conversion because markdown has pictures. A video and
 *  a recording do not, so an entry with a clip in it would arrive with the clip
 *  missing from the words while the file itself landed in `assets/`. Those are
 *  added at the end, where the import's own link rewriting finds them. */
function withMedia(markdown: string, html: string): string {
  const missing: string[] = []

  for (const tag of tagsIn(html)) {
    if (tag.closing || !MEDIA.has(tag.name.toLowerCase())) continue

    const source = (tag.attributes.src ?? '').trim()
    if (!source || source.startsWith('data:')) continue

    const name = source.split('/').pop() ?? source
    if (markdown.includes(name) || missing.includes(source)) continue
    missing.push(source)
  }

  return [markdown, ...missing.map((source) => `![](${source})`)].filter(Boolean).join('\n\n')
}

/** How many of an entry's cards are a picture Journal draws itself. A mood is a
 *  flower, a walk is a dial and a place is a map: what they say in words comes
 *  over with the words, and the drawing does not come over at all. */
function drawnCards(html: string): number {
  let drawn = 0

  for (const tag of tagsIn(html)) {
    if (tag.closing || tag.name.toLowerCase() !== 'div') continue
    if (DRAWN.test(tag.attributes.class ?? '')) drawn += 1
  }

  return drawn
}
