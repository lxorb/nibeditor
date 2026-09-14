/** What a note is called: on screen, and on disk once it is saved.
 *
 *  Both answers start in the same place. A note's title is its first heading,
 *  and failing that its first line, so a draft's tab and the file it becomes
 *  carry the same words. What differs is only what a filesystem will take: a tab
 *  may say `Q1: costs/savings` and a file may not.
 *
 *  The strip, the file list, the palette, the menus and the window title all ask
 *  here, so a document is called one thing wherever it is listed. */

/** The endings a document is known by rather than named after: markdown's four, a
 *  canvas, a page note, and the two a website is written as.
 *
 *  These are the kinds nib writes and titles from the inside, so the ending is the
 *  file's own business: the reader named the document, the app chose what to keep it
 *  in, and which kind a row holds is drawn beside the name rather than spelled out
 *  after it; see file-mark.ts. Emil, 2026-09-13: *"I don't want filename endings,
 *  e.g. .url"*.
 *
 *  A PDF, a picture and anything else nib did not write keep theirs, the way
 *  Obsidian does: their name *is* the file's name, there is no title behind it, and a
 *  row reading `report.pdf` is a paper somebody was sent where `report` is a note
 *  somebody wrote. Emil, 2026-09-14: *"report.pdf stays report.pdf"*.
 *
 *  Either way the file on disk keeps every character of its name, so a vault opened
 *  next door reads exactly what this wrote. Only what is shown changes. */
const OWN = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc)$/i

/** A document's name as everything that lists one shows it.
 *
 *  A name that is nothing but an ending keeps it. `.md` is a file, and what the
 *  ending came off of is what a row, a tab, a tooltip and the window title have to
 *  say; taking it off would leave every one of them blank. */
export function shownName(name: string): string {
  return name.replace(OWN, '') || name
}

/** The same, for a row of the file list, which may be a folder.
 *
 *  A folder's name is not a file name: a vault with a folder called `Papers.pdf` is
 *  not holding a paper, and one called `Notes.md` is not a note. So nothing comes off
 *  it, and the row, the field that renames it and the question before it is deleted
 *  all say the one name. See Tree.svelte and row-menu.ts. */
export function rowName(name: string, isFolder: boolean): string {
  return isFolder ? name : shownName(name)
}

/** The ending a file name wears, or null for a name wearing none.
 *
 *  One of the endings above where the name has one, else the file's own extension -
 *  the last dot of a name with something in front of it and nothing but an
 *  extension's worth after it. So `report.pdf` wears `.pdf` and `v1.2 plan` wears
 *  none: a run with a space in it is part of somebody's name.
 *
 *  Here beside `shownName` because the two are one rule read from either end: what
 *  a list leaves off is what a rename puts back, and `nameToWrite(shownName(name),
 *  endingOf(name))` is `name` again for every file nib lists. See naming.ts. */
export function endingOf(name: string): string | null {
  const own = OWN.exec(name)
  if (own) return own[0]

  const dot = name.lastIndexOf('.')
  return dot > 0 && /^[^\s.]+$/.test(name.slice(dot + 1)) ? name.slice(dot) : null
}

/** A copy's name: the word beside the name rather than after the ending, so
 *  `Plan.md` copies to `Plan copy.md` and the copy is still a note in a vault
 *  opened next door. `freeName` numbers it from there, so a second copy is
 *  `Plan copy 2.md` rather than the first one written over. */
export function copyName(name: string): string {
  const ending = endingOf(name) ?? ''
  const stem = name.slice(0, name.length - ending.length)

  return stem ? `${stem} copy${ending}` : `copy${ending}`
}

/** How many characters of a title are worth keeping. Long enough for a sentence
 *  of a heading, short enough to be a filename and to read in a tab. */
const MOST = 60

/** How far down a note a title may sit. A heading is what a note is called and
 *  it is at the top of one; the bound is what keeps naming a draft off the
 *  length of the draft, since a tab asks again on every keystroke. */
const LINES = 40

/** And how much of the note is read to find those lines.
 *
 *  Two bounds rather than one, because a note has two ways of being long. `LINES`
 *  stops a note of ten thousand short lines; this stops a note that is one line
 *  of a hundred thousand characters, which is what a page pasted out of a browser
 *  looks like. Between them, what naming a draft costs is a fixed amount of work
 *  whatever the draft weighs - which it has to be, because it is asked again on
 *  every keystroke. See `retitle` in workspace/documents.svelte.ts, which is the
 *  one caller that reads off a rope. */
export const TITLE_CHARS = 2_000

/** A heading line, and what it says. Up to three spaces of indent, as markdown
 *  has it. */
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/

/** The markup a first line wears rather than says: a heading's hashes, a
 *  bullet, a quote's angle. */
const MARKUP = /^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/

/** The words a note would be titled after: its first heading, else its first
 *  line with anything in it. Null for a note that says nothing yet.
 *
 *  Takes lines rather than the whole note so a caller with a rope can hand over
 *  an iterator and pay for the top of the document instead of all of it. */
export function titleFrom(lines: Iterable<string>): string | null {
  let first: string | null = null
  let read = 0

  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading) {
      const words = (heading[2] ?? '').trim()
      if (words) return words
    }

    if (first === null) {
      const words = line.replace(MARKUP, '').trim()
      if (words) first = words
    }

    if (++read >= LINES) break
  }

  return first
}

/** What a note with no name of its own is called on screen. Not a filename, so
 *  only the markup that made the line a heading or a list item is dropped and
 *  the punctuation stays. Null while the note says nothing, and the tab falls
 *  back to Untitled. */
export function draftName(lines: Iterable<string>): string | null {
  const title = titleFrom(lines)
  if (title === null) return null

  const text = title.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, MOST) : null
}

/** The note's own title, if it would make a sensible filename. */
export function nameFromContent(doc: string): string | null {
  const title = titleFrom(doc.split('\n'))
  return title === null ? null : nameFromTitle(title)
}

/** A title as a file name, for a document whose title is not its first line: a
 *  website, which is a shortcut file with the title in a key of its own. Everything
 *  a filesystem would refuse comes out, the separators with it, and what is left is
 *  cut to a length a name should be. Null where nothing is left at all, which is a
 *  title made of nothing but punctuation. */
export function nameFromTitle(title: string): string | null {
  const text = title
    // Everything a filesystem would refuse, plus the separators.
    .replace(/[<>:"/\\|?* -]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')

  return text ? text.slice(0, MOST) : null
}
