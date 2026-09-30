/** The `#` popup: the tags the space already uses, offered as one is written.
 *
 *  A tag is a name for a set of notes, and a set with two spellings is two sets.
 *  That is the whole reason this exists: `#reading` and `#Reading` file a note in
 *  two places, and nothing on the screen says so until the tag tree shows both.
 *  Finishing the tag that is already there is how an app keeps one name for one
 *  thing without ever telling anybody off.
 *
 *  It is a completion source rather than a popup of its own, so it is the surface
 *  `[[`, `:emoji:`, the snippets and `/` already are: same rows, same arrows, same
 *  Enter, same Escape, at the caret on a desktop and at the caret on a phone.
 *
 *  Where it answers, and where it deliberately does not:
 *
 *  - After a `#` that opens a word - the start of a line, or after a space or an
 *    opening bracket - which is exactly where a tag is read from. A `#` in the
 *    middle of a word is not a tag, so `C#` and `https://nib.dev/#top` are left
 *    alone.
 *  - At the start of a line it waits for one character after the hash, because
 *    `# ` there is a heading, and a popup that flickers open on the way to a
 *    heading is a popup in the way. Anywhere else a `#` can only be a tag, so the
 *    list opens at once.
 *  - Never in code, never in maths, never in a URL or a link title. The characters
 *    there mean something else, and `#` is a comment in half of what a fence
 *    holds.
 *  - Inside the front matter, under a `tags:` key, where a tag is written without
 *    the hash because YAML reads one as a comment. Same rows, and what is written
 *    is the name alone.
 *
 *  What the tags are is not the editor's to know: they arrive on the note index
 *  the app fills in, with a count of the notes under each, the way the notes and
 *  their headings do. See wikilink/notes.ts, and search/tags.ts in the app for
 *  what counts as a tag in the first place. */

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { TAG_NAME } from '@nib/markdown/tags'
import { enclosingNamed } from './nodes'
import { fuzzy, noteIndex, type SpaceTag } from './wikilink/notes'

/** How many rows the popup shows. The same number the `[[` list stops at. */
const MOST_SHOWN = 40

/** What a tag's name may hold: a letter, then letters, digits, and the three
 *  characters that join words - the slash among them, which is what makes a tag
 *  nestable. The grammar the parser pills a tag by, so the popup offers exactly
 *  what will be drawn as one; the one source of the four patterns below. */
const NAME = TAG_NAME

/** A `#` that opens a word, and the name being written after it. */
const TYPED = new RegExp(String.raw`(?:^|[\s(])#(${NAME})?$`, 'u')

/** A name being written in the front matter, where there is no hash to find it
 *  by: after the key's colon, after a comma, or inside a written-out list. */
const VALUE = new RegExp(String.raw`(?:^|[\s,[])(${NAME})?$`, 'u')

/** The name at the end of what was matched, which is what the popup filters on
 *  and what a chosen row replaces. */
const TAIL = new RegExp(String.raw`(${NAME})?$`, 'u')

/** Whether what has been typed since is still a name, so the popup filters the
 *  rows it has rather than asking for them again. */
const STILL_A_NAME = new RegExp(String.raw`^${NAME}$`, 'u')

/** Where the characters are not prose: code, maths, an address, the metadata
 *  block. A `#` in any of them is a comment, a colour or a fragment, never a tag -
 *  and the one place in the front matter where it is a tag is answered before this
 *  is asked. */
const NOT_PROSE = new Set([
  'InlineCode',
  'CodeText',
  'CodeMark',
  'CodeInfo',
  'FencedCode',
  'CodeBlock',
  'InlineMath',
  'BlockMath',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'PercentComment',
  'FrontMatter',
  'URL',
  'Autolink',
  'LinkTitle',
])

/** `tags:` or `tag:` at the left margin of the front matter. Both spellings,
 *  because Obsidian takes both. */
const KEY = /^tags?:/i

/** A line of the front matter that is an item of the list under a key. */
const ITEM = /^\s*-\s/

/** Whether the caret sits in a `tags:` list of the note's own front matter.
 *
 *  The block is found through the tree, which is what knows a `---` at the top of
 *  a note from a horizontal rule further down; which key the caret is under is
 *  read off the lines, because YAML is lines. A key's own line counts, and so does
 *  every `- item` under it, which between them are the three ways Obsidian writes
 *  a list. */
function inFrontMatterTags(context: CompletionContext): boolean {
  const at = syntaxTree(context.state).resolveInner(context.pos, -1)
  if (!enclosingNamed(at, 'FrontMatter')) return false

  const here = context.state.doc.lineAt(context.pos)
  if (KEY.test(here.text)) return true

  // Upwards through the items to the key they hang under. Anything else - another
  // key, the fence, a blank line - and the caret is not in a list of tags.
  for (let number = here.number; number >= 1; number--) {
    const line = context.state.doc.line(number)
    if (number !== here.number && KEY.test(line.text)) return true
    if (!ITEM.test(line.text)) return false
  }

  return false
}

/** Every tag the space uses whose path holds the needle, with how many notes
 *  carry it.
 *
 *  The whole path is the label, so a `/` typed narrows to the level under it and
 *  `canvas` finds `work/nib/canvas` without the two levels above it being typed
 *  out. Fuzzy, like the space-wide `[[` lists: a tag is remembered as a word of
 *  itself rather than as the characters it opens with.
 *
 *  The rows are cut off at the popup's own length, and the index arrives with the
 *  most-carried tag first, so what a space of a thousand tags offers before
 *  anything is typed is the hundred nobody had to look for. Which of them stands
 *  first is the popup's, which scores every row against what was typed. */
function rowsFor(tags: readonly SpaceTag[], needle: string): Completion[] {
  const rows: Completion[] = []

  for (const { tag, notes } of tags) {
    if (!fuzzy(tag, needle)) continue

    rows.push({ label: tag, detail: String(notes), type: 'keyword' })
    if (rows.length >= MOST_SHOWN) break
  }

  return rows
}

/** The tags a `#` offers, or the ones a front-matter `tags:` list does. */
export function tagCompletions(context: CompletionContext): CompletionResult | null {
  const tags = context.state.facet(noteIndex).tags ?? []
  if (!tags.length) return null

  const front = inFrontMatterTags(context)
  const typed = context.matchBefore(front ? VALUE : TYPED)
  if (!typed) return null

  if (
    !front &&
    enclosingNamed(syntaxTree(context.state).resolveInner(context.pos, -1), NOT_PROSE)
  ) {
    return null
  }

  // Where the name starts, which is past whatever opened the word and past the
  // hash: the popup filters on the name, so a chosen row replaces the name.
  const name = TAIL.exec(typed.text)?.[1] ?? ''
  const from = context.pos - name.length

  // A `#` that opens a line and has nothing after it yet is a heading on its way
  // to being typed, indented or not.
  const line = context.state.doc.lineAt(context.pos)
  if (!front && !name && line.text.slice(0, from - 1 - line.from).trim() === '') return null

  const rows = rowsFor(tags, name.toLowerCase())
  return rows.length ? { from, options: rows, validFor: STILL_A_NAME } : null
}
