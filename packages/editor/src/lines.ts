/** Commands on whole lines: deleting them, joining them, sorting and reversing them,
 *  and opening a new one above.
 *
 *  What a code editor has taught every hand that has used one, and what a note is
 *  written with as often: a list put in order, two lines that should have been one.
 *  Each reads the lines the selection touches and nothing else, so none of them
 *  costs more in a long note than in a short one.
 *
 *  None of them reaches into metadata the reader asked to hide: the caret is never
 *  up there, and the one command that looks past the caret's own lines - a sort
 *  with nothing selected, which sorts the run of lines around it - stops at the
 *  first line that shows. The rest is hidden-front-matter.ts, which moves or drops
 *  anything done by hand that would land up there. */

import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Line,
  type StateCommand,
} from '@codemirror/state'
import { hiddenFrontMatter } from './live-preview/hidden-front-matter'

/** A run of whole lines, by number. */
interface Lines {
  first: number
  last: number
}

/** The lines a range covers. A selection that ends at the very start of a line - a
 *  run of lines selected with Shift and the arrows - does not take that line: the
 *  caret is in front of it, not in it. */
function linesOf(state: EditorState, from: number, to: number): Lines {
  const first = state.doc.lineAt(from).number
  const end = state.doc.lineAt(to)
  const last = to > from && to === end.from && end.number > first ? end.number - 1 : end.number
  return { first, last }
}

/** The first line the reader can see: past the metadata when it is hidden. */
function firstShown(state: EditorState): number {
  const hidden = hiddenFrontMatter(state)
  return hidden ? state.doc.lineAt(hidden.after).number : 1
}

const blank = (line: Line) => line.text.trim() === ''

/** The run of lines with words on them around a line - the list or the paragraph
 *  the caret is in. */
function runAround(state: EditorState, number: number): Lines {
  const doc = state.doc
  const top = firstShown(state)
  let first = number
  let last = number
  while (first > top && !blank(doc.line(first - 1))) first--
  while (last < doc.lines && !blank(doc.line(last + 1))) last++
  return { first, last }
}

/** Each selection's lines, joined where two share one, in document order. */
function blocksOf(state: EditorState, around: boolean): Lines[] {
  const found = state.selection.ranges
    .map((range) => {
      const lines = linesOf(state, range.from, range.to)
      return around && lines.first === lines.last ? runAround(state, lines.first) : lines
    })
    .sort((one, other) => one.first - other.first)

  const merged: Lines[] = []
  for (const lines of found) {
    const previous = merged.at(-1)
    if (previous && lines.first <= previous.last) {
      previous.last = Math.max(previous.last, lines.last)
    } else {
      merged.push({ ...lines })
    }
  }
  return merged
}

/** A list item's marker and box, a quote's marks, and the indent in front of them:
 *  what a line starts with that is not its words. */
const LEAD = /^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/

/** The order a person means: case aside, and `item 2` before `item 10`. */
let collator: Intl.Collator | null = null

function compare(one: string, other: string): number {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(one.replace(LEAD, ''), other.replace(LEAD, ''))
}

/** Rewrites each block of lines with what `reorder` makes of them, and leaves each
 *  one selected, so what moved is what shows. */
function reordered(reorder: (lines: string[]) => string[]): StateCommand {
  return ({ state, dispatch }) => {
    const doc = state.doc
    const blocks = blocksOf(state, true).filter((lines) => lines.last > lines.first)
    if (!blocks.length) return false

    const changes: ChangeSpec[] = []
    const ranges = blocks.map(({ first, last }) => {
      const from = doc.line(first).from
      const to = doc.line(last).to
      const lines: string[] = []
      for (let number = first; number <= last; number++) lines.push(doc.line(number).text)

      changes.push({ from, to, insert: reorder(lines).join(state.lineBreak) })
      return EditorSelection.range(from, to)
    })

    dispatch(
      state.update({
        changes,
        selection: EditorSelection.create(ranges),
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

/** The selected lines in order - or, with nothing selected over more than one line,
 *  the list or paragraph the caret is in. Stable, so two lines that read the same
 *  keep the order they had. Markers and boxes are read past, so a list sorts by
 *  what its items say. */
export const sortLines = reordered((lines) => [...lines].sort(compare))

/** The same lines the other way up: a sort and then this is a sort downwards. */
export const reverseLines = reordered((lines) => [...lines].reverse())

/** Every line the selection touches, gone, and the caret on the line that took
 *  their place, as far along it as it was - VS Code's Ctrl+Shift+K.
 *
 *  The library has one, but it asks the view where the caret should go, which is a
 *  view a palette row and a test do not always have; this asks the lines. */
export const deleteLine: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc
  const { head } = state.selection.main
  const column = head - doc.lineAt(head).from
  const changes: ChangeSpec[] = []
  const carets: number[] = []

  for (const { first, last } of blocksOf(state, false)) {
    // The line break after the last one, or before the first when they end the note.
    const from = last < doc.lines ? doc.line(first).from : Math.max(0, doc.line(first).from - 1)
    const to = last < doc.lines ? doc.line(last + 1).from : doc.line(last).to
    changes.push({ from, to })
    carets.push(from)
  }

  const set = state.changes(changes)
  const after = set.apply(doc)
  const ranges = carets.map((at) => {
    const line = after.lineAt(set.mapPos(at, 1))
    return EditorSelection.cursor(line.from + Math.min(column, line.length))
  })

  dispatch(
    state.update({
      changes: set,
      selection: EditorSelection.create(ranges),
      scrollIntoView: true,
      userEvent: 'delete.line',
    }),
  )
  return true
}

/** The next line pulled up onto this one, or every selected line onto the first.
 *
 *  What joins them is one space, and the indent, quote marks and list marker at the
 *  front of the line that comes up go: two bullets joined are one bullet saying
 *  both things, which is what somebody joining them meant. */
export const joinLines: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc
  const changes: ChangeSpec[] = []
  const carets: number[] = []

  for (const { first, last } of blocksOf(state, false)) {
    const end = first === last ? Math.min(last + 1, doc.lines) : last
    for (let number = first; number < end; number++) {
      const line = doc.line(number)
      const next = doc.line(number + 1)
      const lead = LEAD.exec(next.text)?.[0].length ?? 0
      const spaced = /\s$/.test(line.text) || next.text.length === lead || !line.text ? '' : ' '
      changes.push({ from: line.to, to: next.from + lead, insert: spaced })
      carets.push(line.to)
    }
  }
  if (!changes.length) return false

  const set = state.changes(changes)
  dispatch(
    state.update({
      changes: set,
      // Where the last join happened, the way VS Code leaves it: on the seam.
      selection: EditorSelection.create(
        state.selection.ranges.length > 1 || !state.selection.main.empty
          ? state.selection.ranges.map((range) => range.map(set))
          : [EditorSelection.cursor(set.mapPos(carets.at(-1) ?? 0, 1))],
      ),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

/** A new empty line above the caret's, indented like it, with the caret on it -
 *  VS Code's Ctrl+Shift+Enter, the other half of the library's line below. */
export const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const indent = /^[ \t]*/.exec(line.text)?.[0] ?? ''
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}
