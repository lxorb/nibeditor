/** Converting another app's spellings in notes that are already here.
 *
 *  The import reads an export, which is one moment. This is for the notes that
 *  arrived some other way: a folder copied across, a space synced out of another
 *  app, a note somebody pasted. Same rewrites, run on demand.
 *
 *  Three of them, which are the ones that actually break something:
 *
 *  A Bear tag that closes itself - `#two words#` - is not a tag anywhere else, so
 *  it becomes `#two-words`, which is one. Never inside a fence, where a hash is
 *  code.
 *
 *  A Zettelkasten id link - `[[202201011200]]` - points at a note by the
 *  timestamp it was made at. nib names such a note `202201011200 The title.md`,
 *  the way Obsidian's own unique-note command does, and a link to the bare id then
 *  points at nothing. So where a note's name begins with that id, the link is
 *  written out in full and starts working.
 *
 *  Roam's own spellings - `{{[[TODO]]}}` for a box, `^^text^^` for a highlight,
 *  `{{[[word]]}}` for whatever word it wrapped - which are markup nothing outside
 *  Roam reads. The importer's rules rather than a second set of them; see
 *  `convertRoam`.
 *
 *  Roam's `[[page]]` is deliberately not in the list: it is already a wikilink and
 *  already means what it says here, so there is nothing to convert. Which is worth
 *  writing down, because it is the one people ask about. */

import { roamText } from './roam'

/** A tag that closes itself.
 *
 *  Written strictly, because the loose version eats whole sentences: with two
 *  ordinary tags in one line, `#work and #home` reads as one closed tag holding
 *  "work and ". So the hash has to open at the start of a line or after a space,
 *  what is inside may not begin or end with a space, the closing hash may not be
 *  followed by a word character, and nothing inside may be a backtick or a
 *  bracket, since those belong to code and to links rather than to a tag. */
const CLOSED_TAG = /(^|[\s(])#([^\s#`[\]\n]|[^\s#`[\]\n][^#`[\]\n]{0,58}[^\s#`[\]\n])#(?![\w#])/g

/** A wikilink whose whole target is a timestamp: twelve digits or fourteen, which
 *  are the two shapes a unique note's name is written in. */
const ID_LINK = /\[\[(\d{12,14})((\|[^\]\n]*)?)\]\]/g

/** The digits a note's own name begins with, which is what an id link names. */
const ID_NAME = /^(\d{12,14})(?=[\s\-_]|$)/

export interface Converted {
  text: string
  /** How many things were rewritten, for the count the reader is shown before
   *  any of it is written. */
  changes: number
}

/** Every rewrite, and how many there were.
 *
 *  `names` is every note name in the space, which is how an id link finds the note
 *  it means. Without it the tags and the Roam markup are still converted, so a single
 *  note can be converted without reading the space. */
export function converted(text: string, names: readonly string[] = []): Converted {
  const tagged = convertTags(text)
  const linked = convertIdLinks(tagged.text, idsIn(names))
  const roamed = convertRoam(linked.text)

  return {
    text: roamed.text,
    changes: tagged.changes + linked.changes + roamed.changes,
  }
}

/** Bear's closed tags, leaving every fenced block exactly as written. */
export function convertTags(text: string): Converted {
  let fenced = false
  let changes = 0

  const lines = text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return line
    }

    if (fenced) return line

    return line.replace(CLOSED_TAG, (whole, before: string, inside: string) => {
      const name = tagFrom(inside)
      // A pair of hashes around something that is not a name is words.
      if (!name) return whole

      changes += 1
      return `${before}#${name}`
    })
  })

  return { text: lines.join('\n'), changes }
}

/** A tag out of what Bear allowed inside one: no spaces, no punctuation on the
 *  ends, and the slashes kept, because a nested tag is nested in both. */
function tagFrom(inside: string): string {
  return inside
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/{2,}/g, '/')
}

/** An id link written out as the note it means. */
export function convertIdLinks(text: string, ids: ReadonlyMap<string, string>): Converted {
  if (!ids.size) return { text, changes: 0 }

  let changes = 0
  const said = text.replace(ID_LINK, (whole, id: string, shown: string) => {
    const name = ids.get(id)
    if (!name || name === id) return whole

    changes += 1
    return `[[${name}${shown}]]`
  })

  return { text: said, changes }
}

/** Every Roam spelling that is worth rewriting in a note, for the count the reader is
 *  shown. `((uid))` is not among them; see `convertRoam`. */
const ROAM_MARKS = /\{\{\[\[(?:TODO|DONE)\]\]\}\}|\^\^[^^\n]+\^\^|\{\{\[\[[^\]\n]+\]\]\}\}/g

/** A line that is already a list item: a bullet or a number. */
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s/

/** A box at the start of a line with no marker in front of it. */
const BARE_BOX = /^(\s*)(\[[ x]\]\s)/

/** Roam's own spellings, in a note that is already here.
 *
 *  The importer's rules rather than a second set of them: `roamText` is what an
 *  imported Roam page is written with, and a note pasted out of Roam holds exactly
 *  the same markup. Which also settles what each of them becomes - a box, a
 *  highlight, the word a `{{[[…]]}}` wrapped - without this file having an opinion.
 *
 *  What is here beyond it is the one thing an existing note has and an imported block
 *  does not: a line that may or may not already be a list item. The importer writes a
 *  block as `- words`, so it only has to put the box where the marker already is; a
 *  line in a note that reads `{{[[TODO]]}} Buy milk` has to become a task, which
 *  means the marker too.
 *
 *  `((uid))` is left exactly as it was, which is what the importer does with a uid it
 *  has never seen. Outside a Roam graph there is nothing that knows what that block
 *  said, and a converter that dropped it would be a converter that lost words.
 *
 *  Never inside a fence, for the reason the tags are not: `^^` and `{{` in a code
 *  block are code. */
export function convertRoam(text: string): Converted {
  let fenced = false
  let changes = 0

  const lines = text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return line
    }

    if (fenced) return line

    // Counted before the words move, because the marks are what is being counted.
    const marks = line.match(ROAM_MARKS)?.length ?? 0
    if (!marks) return line

    changes += marks
    const said = roamText(line)
    if (LIST_MARKER.test(line)) return said

    // A box that ended up at the start of a line nothing made a list item.
    const bare = BARE_BOX.exec(said)
    return bare ? `${bare[1]}- ${said.slice((bare[1] ?? '').length)}` : said
  })

  return { text: lines.join('\n'), changes }
}

/** Which note each id names. A note whose whole name is the id needs no entry:
 *  a link to it already works. */
export function idsIn(names: readonly string[]): Map<string, string> {
  const ids = new Map<string, string>()

  for (const name of names) {
    const stem = name.replace(/\.(md|markdown)$/i, '')
    const id = ID_NAME.exec(stem)?.[1]
    if (!id || stem === id) continue
    // The first one wins, the way a link does when two notes share a name.
    if (!ids.has(id)) ids.set(id, stem)
  }

  return ids
}
