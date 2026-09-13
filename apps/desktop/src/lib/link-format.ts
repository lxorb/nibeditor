/** How nib writes a link to another note.
 *
 *  `[[wikilinks]]` is what it has always written and is still the default: a
 *  wikilink names the note rather than the path to it, so it survives the note
 *  being moved or renamed, and it is what the graph, the backlinks and the
 *  unlinked mentions all read. Some spaces want the other spelling anyway - a
 *  folder that is also a static site, a vault shared with somebody whose editor
 *  has never heard of `[[`, a habit - and Obsidian offers the same choice, so nib
 *  does too.
 *
 *  Four answers, because Obsidian's own two settings are one question: a wikilink,
 *  or a markdown link whose target is the shortest name that is unambiguous, the
 *  path from this note's folder, or the path from the top of the space. Reading
 *  both spellings already works everywhere - see link-index.svelte.ts - so this
 *  only decides what is written, and a space can hold both.
 *
 *  Pure, and the only place a link's text is decided: `linkTo` in composer.ts is
 *  the one caller, and every writer in the app goes through that. */

import { slugify } from '@nib/markdown/links'
import { encodeTarget } from './link-rewrite'
import { folderOf, nameOf, relativePath } from './space-paths'

export type LinkFormat = 'wikilink' | 'shortest' | 'relative' | 'absolute'

/** In the order the setting offers them: the one nib writes today, then the three
 *  shapes of the other spelling, widest first. */
export const LINK_FORMATS: readonly LinkFormat[] = ['wikilink', 'shortest', 'relative', 'absolute']

export function isLinkFormat(value: unknown): value is LinkFormat {
  return typeof value === 'string' && (LINK_FORMATS as readonly string[]).includes(value)
}

/** The spelling every writer uses unless it says otherwise.
 *
 *  Here rather than read off the settings store, so that this module and the one
 *  writer built on it stay arithmetic: a link is a string made out of a name and a
 *  choice, and neither wants a store behind it to be tested. The store sets it,
 *  the way it hands the renderer its answer about line breaks; see
 *  modes.svelte.ts. Wikilinks until somebody says otherwise, which is what nib has
 *  always written. */
let writing: LinkFormat = 'wikilink'

export function setLinkWriting(format: LinkFormat) {
  writing = format
}

export function linkWriting(): LinkFormat {
  return writing
}

/** What a link is pointing at, said once so every spelling can be written from
 *  it. */
export interface LinkTarget {
  /** The name a wikilink uses: the note's own, or enough of its path to say which
   *  note is meant. Always known, because every writer has one. */
  name: string
  /** Where the note is in the space, extension and all. What the two path
   *  spellings need; without it they fall back to the name, which is what the
   *  shortest spelling is anyway. */
  path?: string | null
  /** The note the link is being written in, as a path inside the space. What a
   *  relative path is relative to. */
  from?: string | null
  /** The part after the target: a heading, a `^blockid`, a PDF's `page=3`. Written
   *  without its `#`, the way a wikilink holds it. */
  fragment?: string | null
  /** The words the link shows. Nothing, or the name again, leaves a wikilink
   *  bare; a markdown link always shows something, since `[](x)` shows nothing at
   *  all. */
  shown?: string | null
  /** `![[…]]` and `![](…)`: the note itself rather than a link to it. */
  embed?: boolean
}

/** The link, in the spelling the space is set to. */
export function formatLink(target: LinkTarget, format: LinkFormat): string {
  const bang = target.embed ? '!' : ''
  const fragment = target.fragment ?? ''
  const shown = target.shown && target.shown !== target.name ? target.shown : ''

  if (format === 'wikilink') {
    const inner = fragment ? `${target.name}#${fragment}` : target.name
    return `${bang}[[${inner}${shown ? `|${shown}` : ''}]]`
  }

  const label = shown || target.name || bareFragment(fragment)
  const anchor = fragment ? `#${markdownFragment(fragment)}` : ''

  return `${bang}[${label}](${encodeTarget(pathFor(target, format))}${anchor})`
}

/** The target of a markdown link, in the shape the format asks for.
 *
 *  A caller that knows only a name gets the name with an extension on it, which is
 *  the shortest spelling however the setting is set: nothing else can be worked
 *  out from a name, and a link with no extension is not a link to a file. */
function pathFor(target: LinkTarget, format: Exclude<LinkFormat, 'wikilink'>): string {
  // A target with neither a name nor a path is the note the link is written in,
  // which is what `[[#Heading]]` means: the anchor is the whole link, and a
  // markdown link to a heading of this very note is `[Heading](#heading)`.
  if (!target.path && !target.name) return ''

  const path = target.path ?? withExtension(target.name)
  if (format === 'absolute') return path
  if (format === 'shortest') return withExtension(nameOf(path))
  // A note that does not know where it is being written cannot say "from here",
  // so the path from the top of the space is the closest true answer.
  return target.from ? relativePath(folderOf(target.from), path) : path
}

/** What a markdown link shows for a target that has no name: a link into the note
 *  it is written in, where the heading's own words - or a block's name without the
 *  caret that marks it - are all there is to read. A markdown link with no words
 *  shows nothing at all, which is the one thing it must not do. */
function bareFragment(fragment: string): string {
  return fragment.startsWith('^') ? fragment.slice(1) : fragment
}

const EXTENSION = /\.[^./]+$/

function withExtension(name: string): string {
  return EXTENSION.test(name) ? name : `${name}.md`
}

/** A wikilink's part after the `#`, as a markdown link writes it.
 *
 *  A heading becomes its slug, which is the anchor an exported page and a
 *  published page both give it, and which is what nib reads a markdown link's
 *  fragment as. A `^blockid` and a `page=3` are already the names of things and
 *  stay exactly as written. */
function markdownFragment(fragment: string): string {
  if (fragment.startsWith('^') || fragment.includes('=')) return fragment
  return slugify(fragment)
}
