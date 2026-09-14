/** What "archived" is written as, and what counts as it.
 *
 *  Archiving puts a note away without moving it. The mark goes in the file, which is
 *  the one place that makes it the note's rather than this machine's: the path does
 *  not change, so "put it back exactly where it was" needs nothing remembered
 *  anywhere; every link into it keeps resolving; the sync sees a note whose content
 *  changed rather than a note that moved; and Obsidian sees an ordinary property.
 *
 *  Each kind of file says it in the one place it has, which is where each already
 *  keeps its icon:
 *
 *  - a note, in its front matter under `archived:`
 *  - a plane and a page note, under `nib.archived`, beside `nib.icon`
 *  - a website, as a `Nib-Archived=` line beside `Nib-Icon=`
 *
 *  A folder has no file to write into, so an archived folder is a per-space map the
 *  way an icon-bearing folder is; see workspace/archived-folders.svelte.ts.
 *
 *  The value is a date and time, so the archive reads newest first - but the reading
 *  is not held to that. Anything the file says counts as archived except the two
 *  words that mean it does not, so `archived: true` ticked in Obsidian's property
 *  editor puts a note away here as well, and `archived: false` left behind by
 *  unticking it does not. See docs/archive.md. */

import { frontMatterValue } from '@nib/markdown/front-matter'

/** The front-matter key, the same spelling in every kind of file: `archived:` in a
 *  note, `archived` under a plane's `nib`, and `Nib-Archived` in a website - which is
 *  this word in the shape that format writes keys in. */
export const ARCHIVED_KEY = 'archived'

/** The two words that mean a file says it is not archived. Folded and trimmed before
 *  they are compared, and `no` is in here because YAML reads it as false: a reader
 *  who typed the word meant the word. */
const NOT_ARCHIVED = new Set(['false', 'no'])

/** Whether what a file says under its archived key means the file is archived.
 *
 *  Null, no key, and a value that is nothing but spaces are all "no". So is either
 *  word above, in any case. Everything else is yes, because the value this app writes
 *  is a date and a reader who wrote something else still meant to put the note away. */
export function isArchived(said: string | null | undefined): boolean {
  if (said === null || said === undefined) return false

  const words = said.trim()
  return words !== '' && !NOT_ARCHIVED.has(words.toLowerCase())
}

/** When the file says it was archived, as a moment, or null where it says a word
 *  rather than a date.
 *
 *  What the archive sorts by. A note somebody ticked `archived: true` on has no time
 *  and sorts last within its folder, which is the honest answer: the file does not
 *  say when. */
export function archivedAt(said: string | null | undefined): number | null {
  if (!isArchived(said) || said === null || said === undefined) return null

  const at = Date.parse(said.trim())
  return Number.isNaN(at) ? null : at
}

/** What this app writes when somebody archives something: now, as a date and time
 *  every other tool reads. The same spelling `Nib-Added` uses in a website. */
export function archivedNow(): string {
  return new Date().toISOString()
}

/** What a note's front matter says under `archived:`, as written, or null.
 *
 *  Read on the scan pass rather than here for every list that wants it - see
 *  scan-note.ts and links.rs - so this is what that pass calls, once per note. */
export function archivedIn(content: string): string | null {
  return frontMatterValue(content, ARCHIVED_KEY)
}
