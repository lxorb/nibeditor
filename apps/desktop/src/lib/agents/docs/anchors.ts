/** What an agent's edit names: a place in a note, said by what is there.
 *
 *  An offset is a promise about words that may not hold by the time it is used: the
 *  reader types a sentence above it and it points into the middle of another word. So
 *  an agent names the place the way a person would - these words, the section under
 *  this heading, the block called `^idea`, the task that says "Buy milk" - and the
 *  name is turned into characters only against the words as they stand, in the same
 *  breath as the edit is applied. See docs/agent-native.md 8.2.
 *
 *  A quote is the W3C Web Annotation text-quote selector: the words, and the words
 *  either side of them where the words alone are not enough. Headings and blocks mean
 *  what a link means by them (`[[Note#Heading]]`, `[[Note#^block]]`), read by the same
 *  grammar in @nib/markdown, so the anchor an agent is handed and the link a reader
 *  writes never disagree about which part of a note they name.
 *
 *  Where the annotation model says an ambiguous quote matches every place it is found,
 *  this refuses: an edit has one place, and an agent told "twice" reads again and says
 *  which. Pure, so everything it decides is tested without an editor. */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { blockIdOf, headingText, lines, slugify } from '@nib/markdown/links'
import { taskAt } from '@nib/markdown/tasks'
import { DocError } from './problem'

export type Anchor =
  | { quote: string; prefix?: string; suffix?: string }
  | { heading: string; nth?: number }
  | { block: string }
  | { task: string; nth?: number }
  | { selection: true }
  | { start: true }
  | { end: true }

/** How what lands beside a place has to sit next to it. Words inside a line need
 *  nothing; a task is a line, so what goes before or after it is a line of its own;
 *  a section and a block are paragraphs, which a blank line keeps apart; the start
 *  and the end are the edges of the note's words. */
type Shape = 'words' | 'line' | 'paragraph' | 'edge'

/** A place, resolved: the characters it covers in the words it was resolved against,
 *  and how an insertion beside it sits. `keep` is what a replacement carries on
 *  with: a block's name, so the links to it still arrive. */
export interface Place {
  from: number
  to: number
  shape: Shape
  keep?: string
}

/** The editor holds one line ending, and so does everything that resolves against it;
 *  an agent that read a file off the disk may send the other. */
export function oneEnding(words: string): string {
  return words.replace(/\r\n?/g, '\n')
}

/** What an anchor says, in a few words, for a sentence about it. */
function described(anchor: Anchor): string {
  if ('quote' in anchor) return `the quote "${clipped(anchor.quote)}"`
  if ('heading' in anchor) return `the heading ${anchor.heading}`
  if ('block' in anchor) return `the block ^${anchor.block}`
  if ('task' in anchor) return `the task "${clipped(anchor.task)}"`
  if ('selection' in anchor) return 'the selection'
  return 'start' in anchor ? 'the start' : 'the end'
}

/** A long quote, short enough to read in an error. */
function clipped(words: string): string {
  return words.length > 60 ? `${words.slice(0, 57)}...` : words
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalWords(value: unknown): string | undefined {
  return typeof value === 'string' && value ? oneEnding(value) : undefined
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/** An anchor as the agent sent it, read into one of the shapes above, or refused.
 *  Arguments arrive as JSON from another program, so nothing is trusted until it is
 *  read here; see docs/conventions.md. */
export function readAnchor(value: unknown): Anchor {
  if (!isRecord(value)) throw new DocError('bad_anchor', value, 'an anchor is an object')

  const { quote, heading, block, task } = value
  const nth = optionalCount(value.nth)

  if (typeof quote === 'string') {
    if (!quote) throw new DocError('bad_anchor', value, 'a quote needs words')
    const prefix = optionalWords(value.prefix)
    const suffix = optionalWords(value.suffix)
    return {
      quote: oneEnding(quote),
      ...(prefix === undefined ? {} : { prefix }),
      ...(suffix === undefined ? {} : { suffix }),
    }
  }

  if (typeof heading === 'string' && heading.trim()) {
    return { heading, ...(nth === undefined ? {} : { nth }) }
  }
  if (typeof block === 'string' && block.trim()) return { block: block.trim().replace(/^\^/, '') }
  if (typeof task === 'string' && task.trim()) {
    return { task: oneEnding(task), ...(nth === undefined ? {} : { nth }) }
  }
  if (value.selection === true) return { selection: true }
  if (value.start === true) return { start: true }
  if (value.end === true) return { end: true }

  throw new DocError(
    'bad_anchor',
    value,
    'an anchor is one of quote, heading, block, task, selection, start and end',
  )
}

/** Where the reader's selection is, when the note is the one in front of them. */
export interface Selected {
  from: number
  to: number
}

/** One anchor, against one text. Throws for anything that is not exactly one place. */
export function resolve(anchor: Anchor, text: string, selected: Selected | null = null): Place {
  if ('quote' in anchor) return quoted(anchor, text)
  if ('heading' in anchor) return section(anchor, text)
  if ('block' in anchor) return blockNamed(anchor, text)
  if ('task' in anchor) return taskNamed(anchor, text)

  if ('selection' in anchor) {
    if (!selected) {
      throw new DocError('no_selection', anchor, 'the note is not in front of the reader')
    }
    return { from: selected.from, to: selected.to, shape: 'words' }
  }

  if ('start' in anchor) {
    // Where the words start: past the front matter, which is the note's settings
    // rather than its first line.
    const at = frontMatterBlock(text)?.to ?? 0
    return { from: at, to: at, shape: 'edge' }
  }

  return { from: text.length, to: text.length, shape: 'edge' }
}

/** The one place, the nth of several, or an error saying which it is not. */
function one<T>(found: readonly T[], anchor: Anchor, nth: number | undefined): T {
  if (nth !== undefined) {
    const picked = found[nth - 1]
    if (picked !== undefined) return picked

    throw new DocError(
      'not_found',
      anchor,
      `${described(anchor)} is in the note ${String(found.length)} times, not ${String(nth)}`,
      found.length,
    )
  }

  const [only] = found
  if (only === undefined) {
    throw new DocError('not_found', anchor, `${described(anchor)} is not in the note`)
  }
  if (found.length > 1) {
    throw new DocError(
      'ambiguous',
      anchor,
      `${described(anchor)} is in the note ${String(found.length)} times`,
      found.length,
    )
  }
  return only
}

/** The words, with the words either side of them where given. Overlapping
 *  occurrences count: "aa" is in "aaa" twice. */
function quoted(anchor: Extract<Anchor, { quote: string }>, text: string): Place {
  const { quote, prefix = '', suffix = '' } = anchor
  const found: number[] = []

  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (prefix && !text.endsWith(prefix, at)) continue
    if (suffix && !text.startsWith(suffix, at + quote.length)) continue
    found.push(at)
  }

  const at = one(found, anchor, undefined)
  return { from: at, to: at + quote.length, shape: 'words' }
}

/** A heading line: the rule `headingsOf` and `sectionOf` in @nib/markdown read
 *  headings by, so a heading here is a heading to a link. */
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/

/** One heading of a note, with every heading it sits under. */
export interface HeadingAt {
  level: number
  title: string
  /** The titles above it, outermost first. */
  path: readonly string[]
  line: number
  /** Its section: its own line down to the last words before the next heading at
   *  its level or above it. The blank lines after the words are not the section's,
   *  so what goes after a section goes before them. */
  from: number
  to: number
}

/** Every heading of a note, fences skipped, each with its section. */
export function headingsIn(text: string): HeadingAt[] {
  const found: HeadingAt[] = []
  const open: HeadingAt[] = []
  /** Where the last line with anything on it ended. */
  let words = 0

  const close = (level: number) => {
    while (open.length && (open.at(-1)?.level ?? 0) >= level) {
      const done = open.pop()
      if (done) done.to = words
    }
  }

  for (const row of lines(text)) {
    const hashes = row.code ? undefined : HEADING.exec(row.text)?.[1]
    if (hashes) {
      close(hashes.length)
      const heading: HeadingAt = {
        level: hashes.length,
        title: headingText(row.text),
        path: open.map((one) => one.title),
        line: row.line,
        from: row.from,
        to: row.from + row.text.length,
      }
      found.push(heading)
      open.push(heading)
    }

    if (row.text.trim()) words = row.from + row.text.length
  }

  close(0)
  return found
}

/** A heading's path as an anchor names it: its titles joined by `/`, a slash inside a
 *  title written `\/`. */
export function headingPath(heading: Pick<HeadingAt, 'path' | 'title'>): string {
  return [...heading.path, heading.title].map((one) => one.replaceAll('/', '\\/')).join('/')
}

/** The steps of a path: split at every slash not written `\/`. */
function steps(path: string): string[] {
  return path.split(/(?<!\\)\//).map((one) => one.replaceAll('\\/', '/').trim())
}

/** Whether a title is what a step names, the way a link names a heading: its words
 *  in any case, or the id the heading gets. */
function names(step: string, title: string): boolean {
  return title.toLowerCase() === step.toLowerCase() || slugify(title) === slugify(step)
}

/** Whether a heading is the one a path names: its own title the last step, and every
 *  step before it a heading it sits under, in that order - not necessarily each
 *  directly under the one before, so `Plan/Later` finds Later under Plan and 2026. */
function under(heading: HeadingAt, wanted: readonly string[]): boolean {
  const last = wanted.at(-1)
  if (last === undefined || !names(last, heading.title)) return false

  let at = 0
  for (const step of wanted.slice(0, -1)) {
    while (at < heading.path.length && !names(step, heading.path[at] ?? '')) at++
    if (at === heading.path.length) return false
    at++
  }
  return true
}

function section(anchor: Extract<Anchor, { heading: string }>, text: string): Place {
  const wanted = steps(anchor.heading)
  // A title with a slash in it that nobody escaped is still that title.
  const whole = anchor.heading.trim()

  const found = headingsIn(text).filter(
    (heading) => under(heading, wanted) || (wanted.length > 1 && names(whole, heading.title)),
  )

  const heading = one(found, anchor, anchor.nth)
  return { from: heading.from, to: heading.to, shape: 'paragraph' }
}

/** The block a name sits at the end of: the run of lines around it with no blank
 *  line in between, the way `[[Note#^name]]` reads it. A replacement keeps the name
 *  unless it says it again, so a link to the block still lands. */
function blockNamed(anchor: Extract<Anchor, { block: string }>, text: string): Place {
  const rows = [...lines(text)]
  const marked = rows.filter((row) => !row.code && blockIdOf(row.text) === anchor.block)
  const row = one(marked, anchor, undefined)

  let first = row.line
  let last = row.line
  while (first > 0 && rows[first - 1]?.text.trim()) first--
  while (last + 1 < rows.length && rows[last + 1]?.text.trim()) last++

  const start = rows[first] ?? row
  const end = rows[last] ?? row

  // On a line of its own the name follows its block, as it does under a table; at
  // the end of a line it is part of the line.
  const alone = row.text.trim() === `^${anchor.block}`
  return {
    from: start.from,
    to: end.from + end.text.length,
    shape: 'paragraph',
    keep: alone ? `\n^${anchor.block}` : ` ^${anchor.block}`,
  }
}

/** A task's words: what follows its box, without a block name at the end. Null for a
 *  line that is not a task. */
export function taskWords(line: string): string | null {
  const task = taskAt(line)
  if (!task) return null

  const words = line.slice(task.marker)
  const id = blockIdOf(words)
  return (id ? words.slice(0, words.lastIndexOf(`^${id}`)) : words).trim()
}

/** One task line, found by its words. The whole line as written - `- [ ] Buy milk` -
 *  names the same task. */
function taskNamed(anchor: Extract<Anchor, { task: string }>, text: string): Place {
  const wanted = (taskWords(anchor.task) ?? anchor.task).trim()
  const found = [...lines(text)].filter((row) => !row.code && taskWords(row.text) === wanted)

  const row = one(found, anchor, anchor.nth)
  return { from: row.from, to: row.from + row.text.length, shape: 'line' }
}
