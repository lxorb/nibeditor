import {
  type ChangeSpec,
  type EditorState,
  EditorSelection,
  type Line,
  type StateCommand,
} from '@codemirror/state'
import { type Callout, calloutOf } from '@nib/markdown/callouts'
import { closesFence } from '@nib/markdown/fences'
import { taskAt } from '@nib/markdown/tasks'

/** Wraps the selection, or unwraps it when the markers are already there -
 *  so the same shortcut turns emphasis on and off. */
export function toggleWrap(before: string, after = before): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const { from, to } = range
      const doc = state.doc

      const leading = doc.sliceString(Math.max(0, from - before.length), from)
      const trailing = doc.sliceString(to, Math.min(doc.length, to + after.length))

      // Markers sit just outside the selection.
      if (leading === before && trailing === after) {
        return {
          changes: [
            { from: from - before.length, to: from },
            { from: to, to: to + after.length },
          ],
          range: EditorSelection.range(from - before.length, to - before.length),
        }
      }

      const text = doc.sliceString(from, to)

      // Markers are part of the selection.
      if (
        text.length >= before.length + after.length &&
        text.startsWith(before) &&
        text.endsWith(after)
      ) {
        return {
          changes: { from, to, insert: text.slice(before.length, text.length - after.length) },
          range: EditorSelection.range(from, to - before.length - after.length),
        }
      }

      return {
        changes: { from, to, insert: before + text + after },
        range: EditorSelection.range(from + before.length, to + before.length),
      }
    })

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

function selectedLines(state: Parameters<StateCommand>[0]['state']) {
  const numbers = new Set<number>()

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let line = first; line <= last; line++) numbers.add(line)
  }

  return [...numbers].map((number) => state.doc.line(number))
}

const HEADING = /^(#{1,6})\s+/

/** What the `#` run at the head of a line says, and how much of the line it
 *  takes with the whitespace after it. Level zero is a line that is not a
 *  heading, and then there is nothing to replace. Both commands below want
 *  exactly this, so it is decided in one place. */
function headingOf(text: string): { level: number; length: number } {
  const match = HEADING.exec(text)
  const hashes = match?.[1]
  if (!match || hashes === undefined) return { level: 0, length: 0 }
  return { level: hashes.length, length: match[0].length }
}

/** Level 0 turns the line back into a paragraph. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = selectedLines(state).map((line) => ({
      from: line.from,
      to: line.from + headingOf(line.text).length,
      insert: level ? `${'#'.repeat(level)} ` : '',
    }))

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

export function shiftHeading(delta: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = selectedLines(state).map((line) => {
      const existing = headingOf(line.text)
      const next = Math.min(6, Math.max(0, existing.level + delta))

      return {
        from: line.from,
        to: line.from + existing.length,
        insert: next ? `${'#'.repeat(next)} ` : '',
      }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

/** Adds the prefix to every selected line, or strips it if all lines have it. */
function toggleLinePrefix(prefix: string, pattern: RegExp): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state)
    const allPrefixed = lines.every((line) => pattern.test(line.text))

    const changes: ChangeSpec[] = lines.map((line) => {
      const existing = pattern.exec(line.text)

      if (allPrefixed && existing) {
        return { from: line.from, to: line.from + existing[0].length, insert: '' }
      }
      return { from: line.from, to: line.from + (existing?.[0].length ?? 0), insert: prefix }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

export const toggleQuote = toggleLinePrefix('> ', /^>\s?/)
export const toggleBulletList = toggleLinePrefix('- ', /^\s*[-*+]\s+/)

/** Whatever marker a line already carries, task or plain list. */
const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/
const INDENT = /^\s*/

/** The selected lines as tasks, or back to plain lines when all of them already
 *  are. A line that is a bullet or a number keeps its indentation and trades its
 *  marker for a box; a line that is neither gets both. */
export const toggleTaskList: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state)
  const allTasks = lines.every((line) => taskAt(line.text) !== null)

  const changes: ChangeSpec[] = lines.map((line) => {
    const task = taskAt(line.text)
    const indent = task?.indent ?? (INDENT.exec(line.text)?.[0] ?? '').length

    if (allTasks && task) {
      return { from: line.from + indent, to: line.from + task.marker, insert: '' }
    }

    const marker = task ? task.marker : MARKER.exec(line.text)?.[0].length
    return {
      from: line.from + indent,
      to: line.from + (marker ?? indent),
      insert: '- [ ] ',
    }
  })

  dispatch(state.update({ changes, userEvent: 'input' }))
  return true
}

/** The box on the line the caret is on, ticked or cleared. Gives way where there
 *  is no task, so it shares its key with running a code fence: a line is one or
 *  the other and never both. */
export const toggleTask: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = []

  for (const line of selectedLines(state)) {
    const task = taskAt(line.text)
    if (!task) continue

    // One character, inside the brackets: see tasks.ts in @nib/markdown, which is
    // what says where they are.
    const at = line.from + task.box + 1
    changes.push({ from: at, to: at + 1, insert: task.done ? ' ' : 'x' })
  }

  if (!changes.length) return false

  dispatch(state.update({ changes, userEvent: 'input' }))
  return true
}

export const toggleOrderedList: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state)
  const pattern = /^\s*\d+[.)]\s+/
  const allNumbered = lines.every((line) => pattern.test(line.text))

  const changes: ChangeSpec[] = lines.map((line, index) => {
    const existing = pattern.exec(line.text)
    return {
      from: line.from,
      to: line.from + (existing?.[0].length ?? 0),
      insert: allNumbered ? '' : `${index + 1}. `,
    }
  })

  dispatch(state.update({ changes, userEvent: 'input' }))
  return true
}

/** Inserts a block on its own lines, leaving the caret where you type next. */
function insertBlock(build: () => { text: string; caret: number }): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main
    const line = state.doc.lineAt(range.from)
    const atLineStart = range.from === line.from && range.empty

    const { text, caret } = build()
    const prefix = atLineStart || !line.text ? '' : '\n'
    const insert = prefix + text

    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + prefix.length + caret },
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

export const insertCodeFence = insertBlock(() => ({ text: '```\n\n```', caret: 3 }))

/** A fence line: up to three spaces, then three or more backticks or tildes,
 *  then whatever names the language. A backtick fence may not have backticks
 *  in that part, or it would be inline code. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

function fenceOf(text: string): { mark: string; info: string } | null {
  const match = FENCE.exec(text)
  const mark = match?.[1]
  const info = match?.[2]
  if (mark === undefined || info === undefined) return null
  if (mark.startsWith('`') && info.includes('`')) return null
  return { mark, info: info.trim() }
}

/** A line that is quote marks and nothing else, with each mark captured so the
 *  levels can be counted. Up to three spaces of indent, which is as far as
 *  CommonMark lets a block be pushed in before it is code. */
const EMPTY_QUOTE = /^ {0,3}((?:> ?)+)$/

/** Enter on an empty quoted line leaves the quote, one level per press.
 *
 *  The same thing the writer means by pressing Enter on an empty list item, and
 *  the same thing it means in Typora, in Obsidian and in GitHub's own editor.
 *  CodeMirror's markup command ends a quote only once there are two empty quoted
 *  lines in a row, so the press that should have finished the quote wrote
 *  another `>` instead and the writer had to press again and then delete a line.
 *
 *  Only where the line holds nothing but the marks: a quote with words on it is
 *  a quote being written, and its next line is quoted too. */
export const leaveQuote: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  if (range.head !== line.to) return false

  const marks = EMPTY_QUOTE.exec(line.text)?.[1]
  if (marks === undefined) return false

  // One level goes; what is left is the quote this line was nested inside, or
  // an empty line when there was nothing outside it.
  const levels = marks.split('>').length - 1
  const kept = levels > 1 ? `${'> '.repeat(levels - 1).trimEnd()} ` : ''

  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: kept },
      selection: { anchor: line.from + kept.length },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

/** Enter at the end of an opening fence closes the fence as well, with the
 *  caret on the blank line between. The parser treats a fence nothing closes
 *  as plain text (see `FencedCode` in markdown/fences.ts), so this is
 *  what turns a typed ``` into a code block: typing it does nothing, Enter
 *  makes the block. Only a fence nothing later closes gets this; Enter on a
 *  closed one, or on the closing line of a block, is left to the ordinary
 *  handler. This reads the lines, not the tree, so it does not wait on a
 *  parse. */
export const closeFence: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  if (range.head !== line.to) return false

  const fence = fenceOf(line.text)
  if (!fence) return false

  // Whether this line opens a block or ends one depends on everything above.
  let open: string | null = null
  for (let number = 1; number < line.number; number++) {
    const text = state.doc.line(number).text
    if (open) {
      if (closesFence(text, open)) open = null
    } else {
      open = fenceOf(text)?.mark ?? null
    }
  }
  if (open) return false

  for (let number = line.number + 1; number <= state.doc.lines; number++) {
    if (closesFence(state.doc.line(number).text, fence.mark)) return false
  }

  dispatch(
    state.update({
      changes: { from: line.to, insert: `\n\n${fence.mark}` },
      selection: { anchor: line.to + 1 },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}
export const insertMathBlock = insertBlock(() => ({ text: '$$\n\n$$', caret: 3 }))

/** A ` ```chart ` fence with a chart already in it.
 *
 *  Filled in rather than blank, because the shape is the one thing about a chart
 *  nobody guesses: three keys, one of them a list of lists. An empty fence would
 *  send the writer to the documentation, and a chart with numbers in it is a
 *  chart they can edit into theirs. The caret lands on the title, which is the
 *  first thing they will want to change. See chart.ts in @nib/markdown. */
export const insertChart = insertBlock(() => ({
  text: '```chart\ntype: bar\ntitle: \nlabels: [one, two, three]\nseries:\n  - data: [1, 2, 3]\n```\n',
  caret: 26,
}))

/** An ` ```ai ` fence with nothing in it and the caret inside.
 *
 *  Empty, unlike a chart: what goes in is a question in somebody's own words, and
 *  a question written for them would be a question to delete. The answer goes
 *  under the fence when it is asked; see ai/block.ts. */
export const insertAiBlock = insertBlock(() => ({ text: '```ai\n\n```\n', caret: 7 }))

export const insertHorizontalRule = insertBlock(() => ({ text: '---\n', caret: 4 }))

/** A GitHub alert, which is the callout the renderer draws and the editor marks.
 *  `NOTE` because it is the one that says nothing beyond "read this"; the other
 *  twelve are a word away. No fold sign, because most callouts are not folded and a
 *  sign written into every one of them would be a note full of punctuation nobody
 *  asked for; the two rows below are how one gets its sign without being typed by
 *  hand. See `callouts` in @nib/markdown. */
export const insertCallout = insertBlock(() => ({ text: '> [!NOTE]\n> ', caret: 12 }))

/** The callout the caret is in: its marker line, where in that line the brackets
 *  start, and what the line says.
 *
 *  Walked up from the caret's own line, because a callout is a blockquote and every
 *  line of one carries the quote marks: the first line going up that also carries a
 *  `[!type]` is the line that opened it. Nothing above a line that is not quoted at
 *  all, which is where the callout ends.
 *
 *  Read by the one grammar, with the quote marks taken off the front the way every
 *  other reader of a callout takes them off; see callouts.ts in @nib/markdown. */
function calloutAt(state: EditorState): { line: Line; at: number; callout: Callout } | null {
  const doc = state.doc

  for (let number = doc.lineAt(state.selection.main.head).number; number >= 1; number--) {
    const line = doc.line(number)
    if (!/^[ \t]*>/.test(line.text)) return null

    const at = line.text.indexOf('[!')
    if (at < 0 || !/^[ \t>]*$/.test(line.text.slice(0, at))) continue

    const callout = calloutOf(line.text.slice(at))
    if (callout) return { line, at, callout }
  }

  return null
}

/** Whether the callout the caret is in carries a fold sign, and which one - or null
 *  when the caret is not in a callout at all.
 *
 *  What the two rows in the menu are ticked by. A callout folds in nib whatever it
 *  says, because the chevron in the margin folds any block; the sign is what the file
 *  carries, which is what Obsidian reads and what says the callout opens shut. */
export function calloutSign(state: EditorState): '+' | '-' | '' | null {
  const found = calloutAt(state)
  if (!found) return null

  return found.callout.foldable ? (found.callout.folded ? '-' : '+') : ''
}

/** Writes a fold sign on the callout the caret is in, or takes the one that is
 *  there off again - `+` for a callout that may be folded, `-` for one that opens
 *  shut. Asking for the sign that is already there takes it off, which is what makes
 *  each of the two rows a switch rather than a one-way door.
 *
 *  The sign goes directly after the `]`, which is where Obsidian writes it and where
 *  the grammar reads it. Nothing else about the line is touched, title and all. */
export function setCalloutSign(sign: '+' | '-'): StateCommand {
  return ({ state, dispatch }) => {
    const found = calloutAt(state)
    if (!found) return false

    const { line, at, callout } = found
    const closed = line.text.indexOf(']', at)
    if (closed < 0) return false

    const from = line.from + closed + 1
    const held = callout.foldable ? 1 : 0
    const insert = callout.foldable && (callout.folded ? '-' : '+') === sign ? '' : sign

    dispatch(state.update({ changes: { from, to: from + held, insert }, userEvent: 'input' }))
    return true
  }
}

/** Typora's `[toc]`: a table of contents that follows the headings. */
export const insertToc = insertBlock(() => ({ text: '[toc]\n', caret: 6 }))

/** The note's own metadata, at the top where every parser looks for it. A note
 *  that already has some gets the caret in it rather than a second block, since
 *  two front matters are one front matter and a paragraph of colons. */
export const insertFrontMatter: StateCommand = ({ state, dispatch }) => {
  if (state.doc.line(1).text.trim() === '---') {
    const inside = state.doc.line(Math.min(2, state.doc.lines))
    dispatch(state.update({ selection: EditorSelection.cursor(inside.to), scrollIntoView: true }))
    return true
  }

  const block = '---\ntitle: \n---\n\n'
  dispatch(
    state.update({
      changes: { from: 0, insert: block },
      selection: EditorSelection.cursor(block.indexOf('\n---\n')),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

/** A footnote: the mark where the caret is, the definition at the end of the
 *  note, and the caret in the definition ready to write it.
 *
 *  Numbered by what the note already uses rather than by counting what is there:
 *  `[^3]` may well be the only footnote in it. */
export const insertFootnote: StateCommand = ({ state, dispatch }) => {
  const text = state.doc.toString()
  const used = new Set([...text.matchAll(/\[\^([^\]\s]+)\]/g)].map((found) => found[1]))

  let number = 1
  while (used.has(String(number))) number++
  const label = `[^${number}]`

  // The definition goes after the last of the note's words, not after the blank
  // lines under them, so a note is not slowly pushed down its own file.
  const end = text.replace(/\s+$/, '').length
  const at = Math.min(state.selection.main.to, end)
  const definition = `\n\n${label}: `

  // The mark is an insert and never a replacement: a footnote is something added
  // to what is selected, not instead of it. Where the caret is already at the end
  // of the words, both inserts land on the same offset and are one change - two
  // at one offset is not a change set.
  const changes: ChangeSpec[] =
    at === end
      ? [{ from: end, to: state.doc.length, insert: label + definition }]
      : [
          { from: at, insert: label },
          { from: end, to: state.doc.length, insert: definition },
        ]

  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(end + label.length + definition.length),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

/** An HTML comment around the selection. Markdown has no comment of its own, and
 *  this is the one every editor uses for one; it is hidden wherever the note is
 *  read, so what it holds is between the writer and the file. See comments.ts in
 *  @nib/markdown. */
export const insertComment = toggleWrap('<!-- ', ' -->')

/** A new slide: the rule that breaks a deck, and the caret on the empty slide
 *  after it.
 *
 *  Not through `insertBlock`, because the blank line above the rule is what makes
 *  it a break at all: a line of dashes directly under a line of text is the
 *  underline of a heading in CommonMark, so a rule written without it would turn
 *  the writer's last line into a heading and break nothing. See
 *  packages/markdown/src/slides.ts. */
export const insertSlideBreak: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const emptyHere = line.text.slice(0, range.from - line.from).trim() === ''
  const above = line.number > 1 ? state.doc.line(line.number - 1) : null
  const emptyAbove = above === null || above.text.trim() === ''

  // Nothing to add where the caret already stands under a blank line; one break
  // where the caret is on an empty line under words; two where it is in them.
  const lead = emptyHere ? (emptyAbove ? '' : '\n') : '\n\n'
  const insert = `${lead}---\n\n`

  dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

/** Markdown has no page break, so this is the HTML every exporter understands. */
export const insertPageBreak = insertBlock(() => ({
  text: '<div style="page-break-after: always;"></div>\n',
  caret: 45,
}))

export function insertTable(rows = 2, columns = 2): StateCommand {
  const header = `| ${Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from(
    { length: rows },
    () => `| ${Array.from({ length: columns }, () => '   ').join(' | ')} |`,
  )

  return insertBlock(() => ({ text: [header, divider, ...body].join('\n'), caret: 2 }))
}

const INLINE_MARKERS = /(\*\*|__|\*|_|~~|==|`)/g

/** Strips inline markers from the selection - Typora's Clear Format. */
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    if (range.empty) return { range }

    const text = state.doc.sliceString(range.from, range.to).replace(INLINE_MARKERS, '')
    return {
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.range(range.from, range.from + text.length),
    }
  })

  dispatch(state.update(update, { userEvent: 'input' }))
  return true
}

/** Wraps the selection as a link, putting the caret in the empty target. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const label = state.doc.sliceString(range.from, range.to)
    const insert = `[${label}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

export const insertImage: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const label = state.doc.sliceString(range.from, range.to)
    const insert = `![${label}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

// Find, Replace and the steps through the matches are next door in find.ts.
// Undo and redo are in shared.ts, which is where the history of a note open in
// two panes lives.
