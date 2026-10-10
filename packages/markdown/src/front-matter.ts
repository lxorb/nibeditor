/** The block of metadata a note may open with, and the surgery on one key of it.
 *
 *  YAML between two `---` fences, which is Obsidian's convention and so this
 *  app's: a note that says what it is says it there, and every other editor that
 *  reads markdown leaves the block alone. What the app keeps in it today is the
 *  title, the author, the language and the date an export reads, the `tags:` a
 *  search reads, and the `icon:` a row in the file list wears.
 *
 *  Reading a key is one line of prose; changing one is not, which is why this is
 *  a module. A note is somebody's file: setting a key has to leave every other
 *  line of the block exactly as it was, taking one away has to leave no empty
 *  block behind, and the change has to come out as an edit of the few characters
 *  that moved rather than as a rewritten note - because a note open in a pane
 *  takes the edit and keeps every caret in it where its reader left it.
 *
 *  Top-level keys only. A key indented under another one belongs to that one:
 *  `paper` under `export:` is not the note's paper, and nothing here pretends
 *  otherwise. */

import { oneEdit, type TextEdit } from './edits'
import { flowItem, flowItems, listItem, scalar, unquoted } from './yaml'

/** Named here as well because the block is this module's business and yaml.ts is
 *  its private grammar: a caller writing a block asks for one import, and a caller
 *  that has to state a value as one line - a title that is written into the block
 *  and used as the note's heading - asks the same rule that the block was built
 *  with rather than a rule of its own. */
export { oneLine } from './yaml'

/** Where a note's front matter sits.
 *
 *  All four offsets, because the four questions differ: what the block says is
 *  `body`, what comes after it starts at `to`, a new key goes in at `close`, and
 *  taking the block away is `from` to `to`. */
export interface FrontMatterBlock {
  /** The start of the note, which is the only place a block can open. */
  from: number
  /** Past the closing fence and its line break: where the note's words start. */
  to: number
  /** The lines between the fences, the last one's break included. */
  body: { from: number; to: number }
  /** Where the closing fence's own line begins. */
  close: number
}

/** One key's line, as it is written. `value` is what follows the colon, so a key
 *  with nothing after it has an empty one. */
interface KeyLine {
  /** The whole line, its break not included. */
  from: number
  to: number
  /** The value alone: from just past the colon to the end of the line. */
  value: { from: number; to: number }
}

/** A top-level `key:` and whatever follows it on the line. Indented lines are
 *  somebody else's key, and a line that is only a value is part of a list. */
const KEY = /^([A-Za-z_][\w-]*)[ \t]*:/

/** Where the front matter block sits, or null when the note opens with anything
 *  else - which is most notes.
 *
 *  The opening fence has to be the note's first line and the closing one a line
 *  that says nothing but `---`, so a horizontal rule in the middle of a note
 *  cannot be read as the end of a block that never started. */
export function frontMatterBlock(source: string): FrontMatterBlock | null {
  if (!source.startsWith('---')) return null

  const first = source.indexOf('\n')
  if (first === -1 || source.slice(0, first).trim() !== '---') return null

  let at = first + 1
  while (at <= source.length) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 ? source.length : end

    if (source.slice(at, stop).trim() === '---') {
      return {
        from: 0,
        to: end === -1 ? source.length : end + 1,
        body: { from: first + 1, to: at },
        close: at,
      }
    }

    if (end === -1) break
    at = end + 1
  }

  return null
}

/** What a written row holds: one key, and either a value or a list of them. A
 *  number and a yes-or-no are written as YAML's own, for a column that held one;
 *  a string is always read back as the words it said. */
export type FrontMatterRow = readonly [
  key: string,
  value: string | number | boolean | readonly string[],
]

/** A front matter block saying these rows, or nothing at all when there are none:
 *  a note that carries no properties should not carry an empty fence.
 *
 *  The block alone, with no line break after its closing fence, so the caller
 *  decides what the note's words are separated from it by.
 *
 *  Two writers wanted this: an import, which knows a note's date, its tags and
 *  whatever columns its export carried, and a clipped page, which knows where it
 *  came from and when. Which rows there are is theirs to decide - one writes only
 *  what it knows, the other always writes its four so that a folder of clips has
 *  the same shape in every one of them - and how a value is spelled is not, because
 *  both are read back by the reader above and by Obsidian. */
export function writeFrontMatter(rows: readonly FrontMatterRow[]): string {
  if (!rows.length) return ''

  const said = rows.map(([key, value]) => `${key}: ${valueOf(value)}`)

  return `---\n${said.join('\n')}\n---`
}

function valueOf(value: FrontMatterRow[1]): string {
  if (typeof value === 'string') return scalar(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : "''"
  return `[${value.map(flowItem).join(', ')}]`
}

/** The block's own lines as text, or null where there is no block. */
export function frontMatter(source: string): string | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  return source.slice(block.body.from, block.body.to).replace(/\r?\n$/, '')
}

/** The note without its front matter, which is what a renderer is handed:
 *  metadata is not content. */
export function stripFrontMatter(source: string): string {
  const block = frontMatterBlock(source)
  return block ? source.slice(block.to) : source
}

/** A top-level key read as a list.
 *
 *  YAML writes one three ways and a note may use any of them:
 *
 *      aliases: [One, Two]
 *      aliases:
 *        - One
 *        - Two
 *      aliases: One
 *
 *  The last is a list of one, because a reader asking for a list wants the
 *  answer in one shape. Empty where the note has no block, no such key, or
 *  nothing under it. Still not a YAML parser: what it reads is what a note
 *  written by hand or by Obsidian actually holds. */
export function frontMatterList(source: string, key: string): string[] {
  const block = frontMatterBlock(source)
  if (!block) return []

  const line = keyLine(source, block, key)
  if (!line) return []

  const value = source.slice(line.value.from, line.value.to).trim()

  // On the line: a flow sequence, or a single value standing for a list of one.
  if (value) return (flowItems(value) ?? [unquoted(value)]).filter(Boolean)

  // Under it: the `- item` lines, up to the next key of the note's own.
  const out: string[] = []
  let at = line.to + 1

  while (at < block.body.to) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 || end > block.body.to ? block.body.to : end
    const text = source.slice(at, stop)

    if (text.trim()) {
      const item = listItem(text)
      if (item === null) break
      out.push(item)
    }

    if (end === -1) break
    at = end + 1
  }

  return out.filter(Boolean)
}

/** A top-level `key: value` from the front matter, quotes stripped, or null when
 *  the note has no block, no such key, or nothing after the colon. */
export function frontMatterValue(source: string, key: string): string | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  const line = keyLine(source, block, key)
  if (!line) return null

  const value = source.slice(line.value.from, line.value.to).trim()
  return unquoted(value) || null
}

/** The line a key is written on, or null when the block has no such key. The
 *  first one wins, the way YAML reads a duplicated key. */
function keyLine(source: string, block: FrontMatterBlock, key: string): KeyLine | null {
  const wanted = key.toLowerCase()
  let at = block.body.from

  while (at < block.body.to) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 || end > block.body.to ? block.body.to : end
    const found = KEY.exec(source.slice(at, stop))

    if (found?.[1]?.toLowerCase() === wanted) {
      return { from: at, to: stop, value: { from: at + found[0].length, to: stop } }
    }

    if (end === -1) break
    at = end + 1
  }

  return null
}

/** One edit that sets several top-level keys at once, in the order given, or null
 *  where the note already says all of it.
 *
 *  One edit and not several, because the note is written once: two edits into the
 *  same block would have to be given in the coordinates of the text before either of
 *  them, and the second key's line moves when the first one is inserted. So the keys
 *  are set in turn and what comes back is the one span that changed - which for a
 *  note is the block at the top of it, leaving every caret in the words below where
 *  its reader left it.
 *
 *  What two keys at once is for: an icon and the colour it is drawn in. They are two
 *  keys rather than one value so that another app reading the note still finds the
 *  icon, and one write rather than two so that choosing an icon is one thing to undo. */
export function frontMatterEdits(
  source: string,
  keys: readonly (readonly [string, string | null])[],
): TextEdit | null {
  let after = source

  for (const [key, value] of keys) {
    const edit = frontMatterEdit(after, key, value)
    if (edit) after = after.slice(0, edit.from) + edit.insert + after.slice(edit.to)
  }

  return oneEdit(source, after)
}

/** One edit that sets a top-level key to `value`, or takes the key away when it
 *  is null. Null when the note already says that, so a caller writes no file.
 *
 *  What it does in each of the cases a note can be in:
 *
 *  - the key is there: the value after the colon is replaced, and the rest of
 *    the line, the rest of the block and every other key stay as they were.
 *  - the block is there without the key: the key goes in as the last line of the
 *    block, in front of the closing fence.
 *  - there is no block: one is opened at the top of the note, which is where
 *    every reader of a markdown file looks for it.
 *  - taking the key away: its line goes. A block that held nothing else goes
 *    with it, along with the blank lines it was standing on, because an empty
 *    pair of fences at the top of a note is litter rather than metadata.
 *
 *  The line ending is whatever the note already uses, so a file written on
 *  Windows does not come back with one line in the other convention. */
export function frontMatterEdit(
  source: string,
  key: string,
  value: string | null,
): { from: number; to: number; insert: string } | null {
  const nl = source.includes('\r\n') ? '\r\n' : '\n'
  const block = frontMatterBlock(source)

  if (!block) {
    if (value === null) return null
    return { from: 0, to: 0, insert: `---${nl}${key}: ${value}${nl}---${nl}` }
  }

  const line = keyLine(source, block, key)

  if (value === null) {
    if (!line) return null

    // What the block would say without this line. Nothing worth keeping means
    // the fences go too, and the blank lines under them with it.
    const rest =
      source.slice(block.body.from, line.from) + source.slice(cutTo(source, line), block.body.to)
    if (!rest.trim()) return { from: block.from, to: blankAfter(source, block.to), insert: '' }

    return { from: line.from, to: cutTo(source, line), insert: '' }
  }

  if (line) {
    const said = source.slice(line.value.from, line.value.to).trim()
    if (unquoted(said) === value) return null

    return { from: line.value.from, to: line.value.to, insert: ` ${value}` }
  }

  return { from: block.close, to: block.close, insert: `${key}: ${value}${nl}` }
}

/** Where the cut of a key's line ends: past its line break, so the line is gone
 *  rather than left behind as an empty one. */
function cutTo(source: string, line: KeyLine): number {
  return source.startsWith('\r\n', line.to) ? line.to + 2 : Math.min(line.to + 1, source.length)
}

/** Past the empty lines that follow an offset. What a note that opened with
 *  nothing but a block of metadata should start with is its first real line. */
function blankAfter(source: string, at: number): number {
  let over = at
  for (;;) {
    if (source.startsWith('\r\n', over)) over += 2
    else if (source.startsWith('\n', over)) over += 1
    else return over
  }
}
