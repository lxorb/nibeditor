/** The clip as a note.
 *
 *  What the file says is `@nib/markdown/clip-note`'s, which a web tab's Clip writes
 *  through as well, so the same page clipped from either is the same note. What is
 *  left here is the extension's own: the size the account takes, what a template's
 *  interpreter folds into the origin, and the name the file wants. Nothing about a
 *  space or a folder is decided here; `paths.ts` says where that name may go. */

import type { Origin } from '@nib/markdown/article'
import { clipFrontMatter, clipNoteText, UNTITLED } from '@nib/markdown/clip-note'
import type { FrontMatterRow } from '@nib/markdown/front-matter'
import { withoutForbidden } from '@nib/markdown/paths'

import type { Filled } from './interpret/values'

/** The largest note the API takes; see `services/sync/src/notes.ts`. Checked
 *  here as well so an article that will never fit is refused before it is sent
 *  and before its pictures are uploaded. */
export const MAX_NOTE_BYTES = 4 * 1024 * 1024

const encoder = new TextEncoder()

export function byteLength(content: string): number {
  return encoder.encode(content).length
}

export function fits(content: string): boolean {
  return byteLength(content) <= MAX_NOTE_BYTES
}

/** How many tags a clip states. Both halves cap their own at eight - the page's
 *  keywords in `@nib/markdown/article`, the interpreter's in `interpret/values.ts` - and this
 *  is what the two together come to before a line of metadata has stopped being
 *  metadata. */
const MOST_TAGS = 12

/** The origin with what the interpreter had to say about it folded in.
 *
 *  Two of the properties a template may fill are ones the clip already has an
 *  answer for. The title is one: the page states it about itself and a model often
 *  states it better, without the site's name bolted on after a pipe, so a filled
 *  title replaces the page's everywhere the title is used at all - the block, the
 *  heading and the file's name - because a note with two titles is a note somebody
 *  has to reconcile. The tags are the other, and there they join rather than
 *  replace: the page published its own and the model read the words, and nothing
 *  true should be thrown away by having asked.
 *
 *  Every other property is a row of its own, which is `frontMatter`'s business. */
export function interpreted(origin: Origin, filled: readonly Filled[]): Origin {
  const said = new Map(filled.map((one) => [one.key, one.value]))

  const title = said.get('title')
  const listed = said.get('tags')
  const tags = [...origin.tags]

  for (const one of Array.isArray(listed) ? listed : []) {
    if (!tags.includes(one)) tags.push(one)
  }

  return {
    ...origin,
    title: typeof title === 'string' && title ? title : origin.title,
    tags: tags.slice(0, MOST_TAGS),
  }
}

/** What a template filled in beyond the title and the tags, which `interpreted`
 *  has already folded into the origin: a row of its own each, in the order the
 *  template asked for them. */
function rowsOf(filled: readonly Filled[]): FrontMatterRow[] {
  return filled
    .filter((one) => one.key !== 'title' && one.key !== 'tags')
    .map((one): FrontMatterRow => [one.key, one.value])
}

/** The block above the note; see `clipFrontMatter`. The origin is written as it is
 *  given: `title` and `tags` are `interpreted`'s to fold in and `noteFor` does that
 *  first, so the block, the heading and the file name are one decision rather than
 *  three that agree most of the time. */
export function frontMatter(origin: Origin, clipped: Date, filled: readonly Filled[] = []): string {
  return clipFrontMatter(origin, clipped, rowsOf(filled))
}

/** A file name the title can be written as: what a filesystem refuses taken
 *  out, one line, and short enough that the path still fits inside a space. */
export function fileName(title: string): string {
  const name = withoutForbidden(title)
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim()

  return `${name || UNTITLED}.md`
}

/** The whole note, with whatever a template filled in folded into it first. */
export function noteFor(
  origin: Origin,
  markdown: string,
  clipped: Date,
  filled: readonly Filled[] = [],
): string {
  return clipNoteText(interpreted(origin, filled), markdown, clipped, rowsOf(filled))
}
