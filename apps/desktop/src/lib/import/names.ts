/** Turning what another app called a note into what a file can be called.
 *
 *  Every one of these exports names its notes after their titles, and a title is
 *  allowed to hold a slash, a colon, a newline and three hundred characters.
 *  This is the one place that argues with that, so no reader has to.
 *
 *  What a file may hold and how a taken name steps aside are
 *  @nib/markdown/paths, shared with the clipper and the sync service so that an
 *  imported note is named the way every other note is. */

import { freePath, withoutForbidden } from '@nib/markdown/paths'

/** The names MS-DOS took and Windows never gave back, with or without an
 *  extension after them. */
const DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Long enough for any title somebody wrote on purpose, short enough that the
 *  folders above it still fit in a path. */
const LONGEST = 96

/** Notion ends every file and folder name with the page's own id: 32 hex
 *  characters after a space, or after a hyphen in the HTML export. */
const NOTION_ID = /[ -][0-9a-f]{32}$/i

/** Whether these files are papers and nothing else. Every one of them, because a
 *  zip with a PDF in it among four hundred notes is somebody's notes and not a paper
 *  they want to write on; one file, or a handful of them, is. See pdf-pages.ts, which
 *  is what such a drop is read by.
 *
 *  Here rather than beside that reader because read.ts asks this of every import
 *  there is, and the reader brings pdf.js with it - half a megabyte, in front of the
 *  first paint, to answer a question about an extension. */
export function looksLikePapers(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((one) => /\.pdf$/i.test(one))
}

export function safeName(title: string): string {
  const one = withoutForbidden(title.replace(/\s+/g, ' '))
    .replace(/\s+/g, ' ')
    // A dot or a space at the end is dropped by Windows itself, so a note
    // called `Plans.` would be written and then not found again.
    .replace(/[. ]+$/, '')
    .trim()

  const short = one.length > LONGEST ? one.slice(0, LONGEST).trimEnd() : one
  if (!short) return 'Untitled'
  return DEVICES.test(short) ? `${short}-` : short
}

/** The name without the id its exporter stuck on the end. */
export function withoutNotionId(name: string): string {
  const at = name.lastIndexOf('.')
  const stem = at > 0 ? name.slice(0, at) : name
  const extension = at > 0 ? name.slice(at) : ''
  return `${stem.replace(NOTION_ID, '')}${extension}`
}

/** Whether this name carries one, which is what says a zip is Notion's. */
export function hasNotionId(name: string): boolean {
  const at = name.lastIndexOf('.')
  return NOTION_ID.test(at > 0 ? name.slice(0, at) : name)
}

/** Every part of a path made into a name a file may have, the extension kept.
 *
 *  Three formats need this: a folder of markdown, whose folders were named by
 *  whoever made them, Apple Notes, whose folders are named after the ones in
 *  Notes, and Notion, whose every name carries an id. `each` is what a format does to a part before it is made safe - taking
 *  the id off a Notion name, for one - and nothing by default. */
export function safeParts(path: string, each: (part: string) => string = (part) => part): string {
  const parts = path.split('/').filter(Boolean)
  const last = parts.pop() ?? ''
  const at = last.lastIndexOf('.')
  const stem = at > 0 ? last.slice(0, at) : last
  const extension = at > 0 ? last.slice(at) : ''

  const folders = parts.map((one) => safeName(each(one)))
  const name = `${safeName(each(stem))}${extension}`

  return [...folders, name].join('/')
}

/** A title out of the first line of a note, for the formats that do not carry
 *  one: the heading if it opens with one, the first words otherwise. */
export function titleFrom(text: string): string | null {
  for (const line of text.split('\n')) {
    const said = line.trim()
    if (!said) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(said)
    return safeName((heading?.[1] ?? said).slice(0, LONGEST))
  }

  return null
}

/** Keeps an import's own names apart.
 *
 *  Two Evernote notes are allowed to be called the same thing and two Keep notes
 *  usually are, since most of them have no title at all. The step is `Name 2`,
 *  which is the step the app itself makes when a new note lands on a taken name,
 *  so an import looks like something that was made here. */
export class Names {
  private readonly taken = new Set<string>()

  /** A free path, remembered as taken. Folders count as taken too: a note and a
   *  folder of the same name is how nib nests, so those are meant to collide and
   *  the caller says which by asking once for each. */
  free(path: string): string {
    const free = freePath(path, (candidate) => this.taken.has(candidate.toLowerCase()))
    this.taken.add(free.toLowerCase())
    return free
  }

  /** Says a path is taken without asking for one, for the folder a note is
   *  about to nest under. */
  hold(path: string) {
    this.taken.add(path.toLowerCase())
  }

  has(path: string): boolean {
    return this.taken.has(path.toLowerCase())
  }
}
