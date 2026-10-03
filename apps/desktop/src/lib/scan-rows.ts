/** What a note gives the rows of its space: its front matter as written, and its task
 *  lines with the headings above them (docs/tasks.md 5.3).
 *
 *  The twin of the same two fields of `scan_links` in links.rs, read the same way:
 *  outside code, below the front matter, every line a task is with the heading path
 *  the walk has come past. Raw rather than parsed, because the rows parse the fields
 *  with the one reader they have (`@nib/bases`), so the crate and the window cannot
 *  disagree about what a date is. The cases in scan-rows.test.ts are the twins of
 *  the crate's.
 *
 *  Its own module rather than a part of scan-note.ts, which the first paint carries:
 *  nothing before the launch order is over asks a note for its tasks. The browser's
 *  scan reads it for every note (web/commands.ts) and the rows for a note just saved
 *  (rows/store.svelte.ts). */

import { frontMatterBlock } from '@nib/markdown/front-matter'
import { taskAt } from '@nib/markdown/tasks'

/** One task line, as written. */
export interface ScannedTask {
  /** The line it is on, counting from zero. */
  line: number
  /** How far it is indented, in characters: a sub-task is indented under its task. */
  indent: number
  /** What is between the brackets, as written. */
  mark: string
  /** Everything after the box, fields and all. */
  text: string
  /** The headings above it, outermost first. */
  section: string[]
}

/** A file's size and times, milliseconds since the epoch. */
export interface Stamp {
  size: number
  mtime: number
  ctime: number
}

/** The two fields. */
export interface ScannedRows {
  /** The lines between the fences, or null for a note that opens with anything else. */
  front: string | null
  tasks: ScannedTask[]
}

/** How many task lines one note is read for; `MOST_TASKS` in links.rs. */
const MOST_TASKS = 5000

/** How much of a task line is kept, in characters; `LONGEST_TASK` in links.rs. */
export const LONGEST_TASK = 2000

export function scanRows(content: string): ScannedRows {
  const block = frontMatterBlock(content)
  const front = block
    ? content.slice(block.body.from, block.body.to).replace(/\r?\n$/, '')
    : null
  // The block's own lines hold no task and no section.
  const wordsFrom = block ? lineOf(content, block.close) + 1 : 0

  const tasks: ScannedTask[] = []
  const section: { level: number; text: string }[] = []
  const lines = content.split('\n')
  let fenced = false

  for (let index = 0; index < lines.length && tasks.length < MOST_TASKS; index++) {
    const line = (lines[index] ?? '').replace(/\r$/, '')
    const fence = isFence(line)
    if (fence) fenced = !fenced
    if (fenced || fence || index < wordsFrom) continue

    const heading = headingAt(line)
    if (heading) {
      while ((section.at(-1)?.level ?? 0) >= heading.level) section.pop()
      section.push(heading)
    }

    const task = taskAt(line)
    if (task) {
      tasks.push({
        line: index,
        indent: task.indent,
        mark: task.mark,
        text: clipped(line.slice(task.marker)),
        section: section.map((one) => one.text),
      })
    }
  }

  return { front, tasks }
}

/** Which line an offset is on. */
function lineOf(content: string, at: number): number {
  let lines = 0
  for (let found = content.indexOf('\n'); found !== -1 && found < at; found = content.indexOf('\n', found + 1)) {
    lines++
  }
  return lines
}

/** Whether a line opens or closes a fenced code block: `is_fence` in links.rs. */
function isFence(line: string): boolean {
  const trimmed = line.trimStart()
  return (
    line.length - trimmed.length <= 3 && (trimmed.startsWith('```') || trimmed.startsWith('~~~'))
  )
}

/** A heading's level and words: `heading_of` in links.rs. */
function headingAt(line: string): { level: number; text: string } | null {
  const trimmed = line.trimStart()
  if (line.length - trimmed.length > 3) return null

  let level = 0
  while (trimmed[level] === '#') level++
  if (level === 0 || level > 6) return null

  const rest = trimmed.slice(level)
  if (!rest.startsWith(' ') && !rest.startsWith('\t')) return null

  return { level, text: rest.trim().replace(/#+$/, '').trim() }
}

/** At most `LONGEST_TASK` characters, cut on a character rather than a code unit. */
function clipped(text: string): string {
  if (text.length <= LONGEST_TASK) return text
  return Array.from(text).slice(0, LONGEST_TASK).join('')
}
