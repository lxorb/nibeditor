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
  return undeviced(short)
}

/** A name a file already had on somebody's disk, changed only as far as a file
 *  in a space has to be: what Windows forbids, a dot or a space at the end, and a
 *  device's name. Never shortened and never respaced, because an app that keeps
 *  its own files, an Obsidian vault, names them in its links and canvases too.
 *
 *  `extension` is what follows the name in the file's own, when it has one: then a
 *  dot or a space the name ends with is not at the end of the file's, and Windows
 *  keeps it, so `Wait for it....md` and `Draft .md` stay as they are. A space put
 *  there in place of a character Windows forbids still comes off, at either end:
 *  `Why?.md` is `Why.md`, not `Why .md`, and `"Ship it".md` is `Ship it.md`, which
 *  is what a link to it says once nib trims it. A space the name opened with itself,
 *  to sort it first, is kept. */
export function keptName(name: string, extension = ''): string {
  const own = extension ? (/[. ]*$/.exec(name)?.[0] ?? '') : ''
  const lead = /^ */.exec(name)?.[0] ?? ''
  const freed = withoutForbidden(name.slice(lead.length, name.length - own.length))
  const rest = `${lead}${freed.trimStart()}`
  const one = extension ? `${rest.trimEnd()}${own}` : rest.replace(/[. ]+$/, '')
  if (!one.trim()) return 'Untitled'
  return undeviced(one)
}

/** A name that starts with a device's, which Windows judges by what comes before
 *  the first dot - `Con. Law` is the device `Con` as much as `CON` is - with a
 *  hyphen after that part, so the space takes the file wherever it is opened. */
function undeviced(name: string): string {
  const at = name.indexOf('.')
  const first = at < 0 ? name : name.slice(0, at)
  return DEVICES.test(first) ? `${first}-${name.slice(first.length)}` : name
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
 *  the id off a Notion name, for one - and nothing by default. `named` is how a part
 *  is made safe: `keptName` for files an app kept for itself, whose names are
 *  already the ones its links use. */
export function safeParts(
  path: string,
  each: (part: string) => string = (part) => part,
  named: (part: string, extension?: string) => string = safeName,
): string {
  const parts = path.split('/').filter(Boolean)
  const last = parts.pop() ?? ''
  const at = last.lastIndexOf('.')
  const stem = at > 0 ? last.slice(0, at) : last
  const extension = at > 0 ? last.slice(at) : ''

  const folders = parts.map((one) => named(each(one)))
  const name = `${named(each(stem), extension)}${extension}`

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

/** A path as the one name it is wherever it lands: composed alike and in one case.
 *  Two names that differ only in case are one file on Windows and on a Mac, and two
 *  that differ only in how an accent is composed are one file on a Mac, which is
 *  how a vault off a Mac and one typed on Linux can hold both spellings of `Café`. */
export function nameKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

/** Keeps an import's own names apart.
 *
 *  Two Evernote notes are allowed to be called the same thing and two Keep notes
 *  usually are, since most of them have no title at all. The step is `Name 2`,
 *  which is the step the app itself makes when a new note lands on a taken name,
 *  so an import looks like something that was made here. */
export class Names {
  private readonly taken = new Set<string>()

  /** Names files already have, which another file is not given while the file
   *  that has it is still to come. */
  private readonly kept = new Set<string>()

  /** A free path, remembered as taken. Folders count as taken too: a note and a
   *  folder of the same name is how nib nests, so those are meant to collide and
   *  the caller says which by asking once for each. `own` says the path is the
   *  file's own name, which a name `keep` held back is free for. */
  free(path: string, own = false): string {
    const free = freePath(path, (candidate) => {
      const key = nameKey(candidate)
      return this.taken.has(key) || (this.kept.has(key) && !(own && candidate === path))
    })
    this.taken.add(nameKey(free))
    return free
  }

  /** Holds a name back for the file that already has it, so a file renamed onto it
   *  steps aside rather than taking it first. */
  keep(path: string) {
    this.kept.add(nameKey(path))
  }

  /** Says a path is taken without asking for one, for the folder a note is
   *  about to nest under. */
  hold(path: string) {
    this.taken.add(nameKey(path))
  }

  has(path: string): boolean {
    return this.taken.has(nameKey(path))
  }
}
