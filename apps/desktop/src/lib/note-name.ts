/** What a note is called: on screen, and on disk once it is saved.
 *
 *  Both answers start in the same place. A note's title is its first heading,
 *  and failing that its first line, so a draft's tab and the file it becomes
 *  carry the same words. What differs is only what a filesystem will take: a tab
 *  may say `Q1: costs/savings` and a file may not.
 *
 *  The strip, the file list, the palette, the menus and the window title all ask
 *  here, so a document is called one thing wherever it is listed. */

/** The extensions a name is shown without: markdown's four, a canvas, a page note,
 *  the two a website is written as, and a PDF. A document is known by its title, not
 *  by the file it is kept in, and which kind a row holds is drawn beside it rather
 *  than spelled out after it; see file-mark.ts. Emil, 2026-09-13: *"I don't want
 *  filename endings, e.g. .url"* - so no kind wears its ending in the list, the strip
 *  or the title. A picture keeps its extension, because its name is the file's own and
 *  there is no title behind it; the file on disk keeps every one of these too, so a
 *  vault opened next door reads exactly what it wrote. */
const OWN = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc|pdf)$/i

/** A document's name as everything that lists one shows it. */
export function shownName(name: string): string {
  return name.replace(OWN, '')
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
