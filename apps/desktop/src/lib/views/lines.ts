/** A task's lines moved as a view moves them: up or down among its siblings, in or
 *  out a level, under another heading, out of one note and into another, and a new
 *  line written where a view's add row says.
 *
 *  A task is its line and everything indented under it - its description, its
 *  comments, its sub-tasks - so every move here takes the whole block (docs/tasks.md
 *  5.1). Each answer is the note's words after the move, worked out on the words as
 *  they are; the writer turns the two versions into one edit, which is one undo.
 *
 *  The line is found again by its anchor, as the write path finds it (`taskLine` in
 *  rows/write.ts): the note may have been edited since the view was drawn. */

import { taskLine } from '../rows/write'

interface Anchor {
  line: number
  hash: string
}

interface Line {
  text: string
  from: number
}

function linesOf(text: string): Line[] {
  const out: Line[] = []
  let from = 0
  for (const one of text.split('\n')) {
    out.push({ text: one, from })
    from += one.length + 1
  }
  return out
}

const indentOf = (text: string) => /^[ \t]*/.exec(text)?.[0].replace(/\t/g, '    ').length ?? 0

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

/** Which line of the note an anchor names now, by number, or null. */
export function lineOfAnchor(text: string, anchor: Anchor): number | null {
  const span = taskLine(text, anchor)
  if (span === null) return null
  let line = 0
  for (let at = text.indexOf('\n'); at !== -1 && at < span.from; at = text.indexOf('\n', at + 1)) {
    line++
  }
  return line
}

/** The lines a task is: its own, and every line under it that is indented further
 *  (a blank line counts when a line after it is still indented further). */
function blockAt(lines: readonly { text: string }[], index: number): [number, number] {
  const own = indentOf(lines[index]?.text ?? '')
  let end = index + 1
  while (end < lines.length) {
    const text = lines[end]?.text ?? ''
    if (text.trim() === '') {
      const next = lines.slice(end + 1).find((one) => one.text.trim() !== '')
      if (!next || indentOf(next.text) <= own) break
    } else if (indentOf(text) <= own) break
    end++
  }
  return [index, end]
}

/** The note with its lines from `from` up to `to` replaced by `insert`. */
function spliced(lines: readonly Line[], from: number, to: number, insert: string[]): string {
  const texts = lines.map((one) => one.text)
  texts.splice(from, to - from, ...insert)
  return texts.join('\n')
}

/** The block of the sibling before (or after) a task, under the same parent: the
 *  nearest block above at the same indentation, with nothing less indented between. */
function siblingBlock(lines: readonly Line[], index: number, up: boolean): [number, number] | null {
  const own = indentOf(lines[index]?.text ?? '')
  if (up) {
    for (let at = index - 1; at >= 0; at--) {
      const text = lines[at]?.text ?? ''
      if (text.trim() === '') continue
      const depth = indentOf(text)
      if (depth < own || HEADING.test(text)) return null
      if (depth === own) return blockAt(lines, at)
    }
    return null
  }
  const [, end] = blockAt(lines, index)
  const next = lines[end]
  if (!next || indentOf(next.text) !== own || next.text.trim() === '' || HEADING.test(next.text)) {
    return null
  }
  return blockAt(lines, end)
}

/** The note with a task's block swapped with its sibling's above or below; null where
 *  it is first or last of its siblings. Alt+↑ and Alt+↓. */
export function movedBlock(text: string, anchor: Anchor, up: boolean): string | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const own = blockAt(lines, index)
  const other = siblingBlock(lines, index, up)
  if (!other) return null

  const take = (span: [number, number]) => lines.slice(span[0], span[1]).map((one) => one.text)
  const [first, second] = up ? [other, own] : [own, other]
  return spliced(lines, first[0], second[1], [...take(second), ...take(first)])
}

/** The note with a task's block one level further in (under the task above it) or
 *  one level out. Tab and Shift+Tab. Null where it cannot go: a first task has
 *  nothing to be under, and a task at the margin nothing to come out of. */
export function indentedBlock(text: string, anchor: Anchor, deeper: boolean): string | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const [from, to] = blockAt(lines, index)
  const own = indentOf(lines[index]?.text ?? '')

  if (deeper && !siblingBlock(lines, index, true)) return null
  if (!deeper && own === 0) return null

  const step = (lines[index]?.text ?? '').startsWith('\t') ? '\t' : '  '
  const moved = lines.slice(from, to).map((one) => {
    if (one.text.trim() === '') return one.text
    if (deeper) return step + one.text
    return one.text.replace(/^(\t| {1,4})/, '')
  })
  return spliced(lines, from, to, moved)
}

/** Where a new block goes under a heading: after the last line of its section, before
 *  the blank lines that end it. The end of the note where the heading is not there
 *  or none is named. */
function endOfSection(lines: readonly Line[], heading?: string): number {
  let at = lines.length
  if (heading !== undefined) {
    const start = lines.findIndex((one) => HEADING.exec(one.text)?.[2] === heading)
    if (start !== -1) {
      const level = HEADING.exec(lines[start]?.text ?? '')?.[1]?.length ?? 6
      at = lines.length
      for (let next = start + 1; next < lines.length; next++) {
        const found = HEADING.exec(lines[next]?.text ?? '')
        if (found && (found[1]?.length ?? 6) <= level) {
          at = next
          break
        }
      }
    }
  }
  while (at > 0 && (lines[at - 1]?.text ?? '').trim() === '') at--
  return at
}

/** The note with these lines added at the end of a heading's section, or at the end
 *  of the note. */
export function withLines(text: string, block: readonly string[], heading?: string): string {
  if (text === '') return `${block.join('\n')}\n`
  const lines = linesOf(text)
  const at = endOfSection(lines, heading)
  return spliced(lines, at, at, [...block])
}

/** A task's block taken out of its note: the note without it, and its lines with their
 *  indentation brought back to the margin. Null where the anchor names no line. */
export function cutBlock(text: string, anchor: Anchor): { rest: string; block: string[] } | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const [from, to] = blockAt(lines, index)
  const own = /^[ \t]*/.exec(lines[index]?.text ?? '')?.[0] ?? ''
  const block = lines
    .slice(from, to)
    .map((one) => (one.text.startsWith(own) ? one.text.slice(own.length) : one.text.trimStart()))
  return { rest: spliced(lines, from, to, []), block }
}

/** The note with a task's block moved to stand just before (or after) another task of
 *  the same note, at that task's indentation: a row dragged within its note. */
export function movedBeside(
  text: string,
  anchor: Anchor,
  target: Anchor,
  after: boolean,
): string | null {
  const cut = cutBlock(text, anchor)
  if (!cut) return null
  const index = lineOfAnchor(cut.rest, target)
  if (index === null) return null
  const lines = linesOf(cut.rest)
  const at = after ? blockAt(lines, index)[1] : index
  const indent = /^[ \t]*/.exec(lines[index]?.text ?? '')?.[0] ?? ''
  return spliced(
    lines,
    at,
    at,
    cut.block.map((one) => (one.trim() === '' ? one : indent + one)),
  )
}

/** The note with a task's block moved under another of its headings. */
export function movedUnder(text: string, anchor: Anchor, heading: string): string | null {
  const cut = cutBlock(text, anchor)
  if (!cut) return null
  return withLines(cut.rest, cut.block, heading)
}
