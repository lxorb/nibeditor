/** Folding: a heading's section, a list item's children, a callout's body, a
 *  fence or a table put out of sight until it is wanted again.
 *
 *  What folding is *for* is skimming. A note long enough to need it is a note
 *  nobody reads top to bottom, and the shape of it - the headings - is the map.
 *  So there are five commands and not six:
 *
 *  - **Fold**, which folds whatever the caret is inside and opens it again on a
 *    second press. One command, because the chevron in the margin is a toggle
 *    too and two names for one gesture is two things to learn.
 *  - **Fold everything**, which folds the top-level heading sections and
 *    nothing else. Not the lists, not the callouts, not the fences: those are
 *    content, and hiding them does not draw a map. What is left on screen is
 *    the outline of the note.
 *  - **Unfold everything**, which opens all of it, whatever was folded and
 *    however it came to be folded. Deliberately not the mirror image of the one
 *    above: "show me all of it" has only one honest reading.
 *  - **Fold more** and **Fold less**, Obsidian's pair, which take the note one
 *    level at a time: more folds every block at the deepest level that still has
 *    something open, less opens the shallowest level that has something folded.
 *
 *  The pair used to be left out, and the reason was a good one: a level is a
 *  number nobody can see, and "which level are we on?" is a question an editor
 *  should never make a reader ask. They are here because neither of them holds
 *  one. The level is read out of the note every time: how deeply a foldable block
 *  sits inside the others is what the syntax tree already says - a subsection
 *  inside a section, a child item inside its item, a fence inside a callout - and
 *  what is folded is read out of the fold state. Nothing is stored, nothing is
 *  reset by an edit, and the two of them walk each other back exactly. They are
 *  two rows and no chord, so the keyboard is no more crowded than it was.
 *
 *  Where a fold *ends* is never decided here. `foldable` answers that, out of the
 *  language: `@codemirror/lang-markdown` registers a fold service for a heading's
 *  section and a fold prop for every other block - a list item with children, a
 *  blockquote or callout, a fence, an indented block, a table. One source of truth
 *  for the ranges, so a chevron, a chord and a restored fold can never disagree
 *  about where a fold ends.
 *
 *  Which lines are *asked* is decided here, and it is `COULD_FOLD`: a heading, a
 *  quote, a list item, a fence, or anything set in from the margin. Two things the
 *  language would fold are deliberately never asked about. An unindented paragraph,
 *  because a note is read down its left edge and a chevron beside every paragraph is
 *  a map of nothing. And a table, which folds to a row of pipes that says less than
 *  the table did.
 *
 *  A fold is view state and never touches the file: see foldLines below, which
 *  is what the app writes down per note per device. */

import { codeFolding, foldable, foldedRanges, foldEffect } from '@codemirror/language'
import type { EditorState, Extension, Line, StateCommand, TransactionSpec } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { calloutOf } from '@nib/markdown/callouts'
import { CHEVRON } from '@nib/markdown/icons'
import {
  foldMovement,
  type FoldRange,
  openFolds,
  shutFolds,
  shuttingAt,
  shuttingChanged,
  stopShutting,
} from './fold-motion'
import { iconElement } from './icon'
import { label } from './labels'
import { NibWidget } from './live-preview/widget'

/** A fold as it is written down: the line that owns it and the last line it
 *  covers, counting from one.
 *
 *  Lines rather than offsets, because a note edited elsewhere between one
 *  reading and the next has moved every offset in it while the lines around a
 *  heading are usually still the lines around that heading. And two numbers a
 *  person could read, rather than a serialised range set. */
export type FoldLines = readonly [head: number, last: number]

/** Which lines could open a fold, judged on their first characters: a heading, a
 *  quote or callout, a list item, a fence - or an indented block, which is any line
 *  that starts two spaces or a tab in. `foldable` resolves the syntax tree, so it
 *  is only asked about a line that could plausibly answer yes.
 *
 *  The indent is the whole of what says an indented block: a paragraph or a run of
 *  code set in from the margin, which Obsidian folds the way it folds a list item's
 *  children. What the markdown around those lines makes of them - an indented code
 *  block, a paragraph continued, a second paragraph inside a list item - is the
 *  language's answer rather than this pattern's, and a line that opens no block of
 *  its own is asked and says no.
 *
 *  Two spaces and not four, because four is only where a code block starts and a
 *  reader who set a thought in by two meant it to be under the thing above. An
 *  unindented paragraph is deliberately left out even though the language would
 *  fold one: a note is read down its left edge, and a chevron beside every
 *  paragraph in it draws a map of nothing. */
const COULD_FOLD =
  /^(?:[ \t]*(?:#{1,6}[ \t]|>|[-*+][ \t]|\d+[.)][ \t]|```|~~~)|(?: {2}|\t)[ \t]*\S)/

const HEADING = /^[ \t]*#{1,6}[ \t]/

/** The fold a line opens, or nothing. */
function foldAtLine(state: EditorState, line: Line): FoldRange | null {
  return foldable(state, line.from, line.to) ?? null
}

/** The fold one line owns, or nothing - the one question every part of folding
 *  asks, asked in one place.
 *
 *  Which lines are worth asking the language about is the cheap half and is
 *  `COULD_FOLD`; what a fold covers is the language's answer. Asked by the chevron
 *  in the margin for every line on screen, by the toggle walking up from the caret,
 *  and by the two levels walking the whole note - so a chevron, a chord and a
 *  restored fold can never disagree about which lines fold at all. Exported for the
 *  tests, which have no margin to mount. */
export function foldOpenedBy(state: EditorState, line: Line): FoldRange | null {
  return COULD_FOLD.test(line.text) ? foldAtLine(state, line) : null
}

/** The folded range a line already owns, or nothing. */
function foldedAtLine(state: EditorState, line: Line): FoldRange | null {
  let found: FoldRange | null = null
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (from >= line.from && from <= line.to && !found) found = { from, to }
  })
  return found
}

/** The fold the caret is inside: the nearest line at or above it that opens one
 *  reaching past it. Nearest, so a heading inside a heading gives up the
 *  section the caret is actually in rather than the whole chapter. */
function enclosingFold(state: EditorState, pos: number): FoldRange | null {
  const start = state.doc.lineAt(pos)

  for (let number = start.number; number >= 1; number--) {
    const range = foldOpenedBy(state, state.doc.line(number))
    if (range && range.to >= pos) return range
  }

  return null
}

/** Where the caret has to go for these folds to hold, when one of them is in the
 *  way.
 *
 *  A fold starts at the end of the line that owns it, so putting the caret
 *  there is putting it on the one line of the fold that stays on screen. The
 *  library drops any fold that covers the selection head, and a head exactly on
 *  a fold's first offset does not count as covered - which is why this is the
 *  one place the caret may be moved and the fold still holds.
 *
 *  The innermost of the folds that would swallow it, so a press that folds a
 *  subsection brings the caret up to that subsection's own heading rather than to
 *  the chapter's. */
function caretFor(state: EditorState, ranges: readonly FoldRange[]): TransactionSpec {
  const head = state.selection.main.head
  let holder: FoldRange | null = null

  for (const range of ranges) {
    if (head <= range.from || head >= range.to) continue
    if (!holder || range.from > holder.from) holder = range
  }

  return holder ? { selection: { anchor: holder.from } } : {}
}

/** Folds what the caret is in, or opens it again.
 *
 *  The caret's own line first: pressing the key on a heading folds that
 *  heading, and pressing it again opens it. Only when the caret's line owns no
 *  fold does this look outwards for the one the caret is inside. */
export const toggleFold: StateCommand = (target) => {
  const { state } = target
  const line = state.doc.lineAt(state.selection.main.head)

  // A fold whose lines are still on their way out gives way: pressing again
  // before it has landed is changing your mind, and nothing folds.
  if (target instanceof EditorView && shuttingAt(state, line.from, line.to)) {
    stopShutting(target)
    return true
  }

  const open = foldedAtLine(state, line)
  if (open) {
    openFolds(target, [open])
    return true
  }

  const range = enclosingFold(state, state.selection.main.head)
  if (!range) return false

  shutFolds(target, [range], caretFor(state, [range]))
  return true
}

/** Every top-level heading section, folded: the outline of the note.
 *
 *  Top-level, because a section already folded hides the headings inside it and
 *  folding those as well would be work nobody can see. Walking past a folded
 *  section rather than into it also keeps the ranges from nesting, so exactly
 *  one of them can hold the caret. */
export const foldHeadings: StateCommand = (target) => {
  const { state } = target
  const ranges: FoldRange[] = []

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (!HEADING.test(line.text)) continue

    const range = foldAtLine(state, line)
    if (!range) continue

    ranges.push(range)
    number = state.doc.lineAt(range.to).number
  }

  if (!ranges.length) return false

  shutFolds(target, ranges, caretFor(state, ranges))
  return true
}

/** One foldable block of the note, with everything the level commands ask about
 *  it. Nothing here is stored: all three answers are read off the note and the
 *  fold state at the moment of the press. */
interface Block extends FoldRange {
  /** How many other foldable blocks hold this one. A `##` section inside a `#`
   *  one is 1, a child list item inside its parent is 1, a fence inside a callout
   *  inside a section is 2. The outline of the note as written, rather than the
   *  hash count: a `###` that follows a `#` with no `##` between them is the
   *  second level of that note, and reads as one. */
  depth: number
  /** Whether it is folded right now. */
  folded: boolean
  /** Whether a fold above it has already taken it off the screen. Neither command
   *  touches one of these: folding what nobody can see is a press that does
   *  nothing, and opening it would open nothing. */
  hidden: boolean
}

/** Every foldable block of the note, in document order, each with its depth and
 *  its state.
 *
 *  One pass down the lines, asking the language only about the ones that could
 *  open a fold - the same question the chevron in the margin asks of every line on
 *  screen, and here only on a press. The depths come off a stack rather than out of
 *  a comparison of every pair: the blocks arrive in document order, so the ones
 *  still on the stack are exactly the ones holding the next. Markdown blocks nest
 *  or stand apart and never half overlap, which is what makes a stack enough. */
function foldableBlocks(state: EditorState): Block[] {
  const shut: FoldRange[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    shut.push({ from, to })
  })

  const blocks: Block[] = []
  const holding: FoldRange[] = []

  for (let number = 1; number <= state.doc.lines; number++) {
    const range = foldOpenedBy(state, state.doc.line(number))
    if (!range) continue

    while (holding.length && (holding.at(-1)?.to ?? 0) < range.to) holding.pop()

    blocks.push({
      ...range,
      depth: holding.length,
      // A fold starts at the end of the line that owns it, so a fold and the
      // block it belongs to share that offset exactly.
      folded: shut.some((one) => one.from === range.from),
      hidden: shut.some((one) => one.from < range.from && one.to >= range.to),
    })
    holding.push(range)
  }

  return blocks
}

/** The deepest level that still has something open, folded: the detail goes
 *  first, and pressing again walks out towards the outline.
 *
 *  Every block of that one level in one press and on one clock, which is what
 *  makes it read as a level rather than as a fold. They are siblings by
 *  construction - one level of one note - so no range in the press holds another,
 *  and the movement has one box per line to move. */
export const foldMore: StateCommand = (target) => {
  const { state } = target
  const open = foldableBlocks(state).filter((one) => !one.folded && !one.hidden)
  if (!open.length) return false

  const deepest = open.reduce((most, one) => Math.max(most, one.depth), 0)
  const ranges = open.filter((one) => one.depth === deepest)

  shutFolds(target, ranges, caretFor(state, ranges))
  return true
}

/** The shallowest level that has something folded, opened: the mirror of the one
 *  above, so however many presses folded the note down, the same number of these
 *  brings it back exactly.
 *
 *  Shallowest, because that is the fold the reader can see. A level opened this
 *  way can leave the level under it still folded, which is the whole point: one
 *  more section of the map at a time. */
export const foldLess: StateCommand = (target) => {
  const shut = foldableBlocks(target.state).filter((one) => one.folded && !one.hidden)
  if (!shut.length) return false

  const shallowest = shut.reduce(
    (least, one) => Math.min(least, one.depth),
    Number.MAX_SAFE_INTEGER,
  )

  openFolds(
    target,
    shut.filter((one) => one.depth === shallowest),
  )
  return true
}

/** Opens all of it. */
export const unfoldEverything: StateCommand = (target) => {
  const open: FoldRange[] = []
  foldedRanges(target.state).between(0, target.state.doc.length, (from, to) => {
    open.push({ from, to })
  })

  if (!open.length) return false

  openFolds(target, open)
  return true
}

/** What is folded, as lines, ready to be written down beside the scroll
 *  position.
 *
 *  In document order, and sorted rather than trusted to arrive that way: a range
 *  set keeps its ranges in chunks and hands back one chunk after another, so a
 *  fold made after a wider one that starts above it comes out last. Order is not
 *  cosmetic here - putting these back is a range set being built, and a range
 *  set refuses ranges out of order. */
export function foldLines(state: EditorState): FoldLines[] {
  const out: FoldLines[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    out.push([state.doc.lineAt(from).number, state.doc.lineAt(to).number])
  })

  return out.sort((one, other) => one[0] - other[0] || one[1] - other[1])
}

/** The folds those lines stand for, in this document.
 *
 *  A pair naming a line the note no longer has, or naming the same line twice,
 *  is dropped rather than guessed at: a note that grew shorter somewhere else
 *  should open readable, not with a fold over whatever now sits there. */
function foldsFor(state: EditorState, lines: readonly FoldLines[]): FoldRange[] {
  const out: FoldRange[] = []

  for (const [head, last] of lines) {
    if (head < 1 || last <= head || last > state.doc.lines) continue
    out.push({ from: state.doc.line(head).to, to: state.doc.line(last).to })
  }

  // Sorted here as well as on the way out, because what was written down may
  // have been written by a build that did not sort, and a range set out of order
  // is an exception rather than a wrong fold.
  return out.sort((one, other) => one.from - other.from || one.to - other.to)
}

/** The callouts the note itself says are shut: `> [!warning]- Mind the gap`.
 *
 *  The only fold that is written in the file rather than remembered per device,
 *  because Obsidian's callout syntax carries it and a note is the same note in
 *  both. Nib never writes the sign and never rewrites it - opening one of these
 *  is a view of the note changing, not the note - so a `-` means "opens shut"
 *  every time rather than "is shut for ever". */
function markerFolds(state: EditorState): FoldRange[] {
  const out: FoldRange[] = []

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    const opened = line.text.indexOf('[!')
    if (opened < 0 || !/^[ \t>]*$/.test(line.text.slice(0, opened))) continue
    if (!calloutOf(line.text.slice(opened))?.folded) continue

    const range = foldAtLine(state, line)
    if (!range) continue

    out.push(range)
    number = state.doc.lineAt(range.to).number
  }

  return out
}

/** A state with those folds already in it, and with every callout the note
 *  itself says is shut.
 *
 *  In the state rather than dispatched into the view afterwards, for the same
 *  reason the caret is: a fold applied a frame later is a frame the reader
 *  spends looking at the note unfolded. The selection rides along so the
 *  library drops any fold that would have covered the caret. */
export function withFolds(state: EditorState, lines: readonly FoldLines[]): EditorState {
  const ranges = [...foldsFor(state, lines), ...markerFolds(state)].sort(
    (one, other) => one.from - other.from || one.to - other.to,
  )
  if (!ranges.length) return state

  return state.update({
    effects: ranges.map((range) => foldEffect.of(range)),
    selection: state.selection,
  }).state
}

/** Whether two written-down sets of folds say the same thing. What tells a fold
 *  worth writing down from one already written: the two arrive in document order,
 *  so this is a walk rather than a comparison of sets. */
export function sameFolds(
  one: readonly FoldLines[] | undefined,
  other: readonly FoldLines[] | undefined,
): boolean {
  const first = one ?? []
  const second = other ?? []
  if (first.length !== second.length) return false

  for (let at = 0; at < first.length; at++) {
    const mine = first[at]
    const theirs = second[at]
    if (!mine || !theirs) return false
    if (mine[0] !== theirs[0] || mine[1] !== theirs[1]) return false
  }

  return true
}

/** Whether an update folded or unfolded anything. The field is a range set, and
 *  a new one is a different object, so identity is the whole question. */
export function foldsChanged(update: ViewUpdate): boolean {
  return foldedRanges(update.startState) !== foldedRanges(update.state)
}

/** The fold mark, turned by the stylesheet when the fold is open. The same
 *  drawing a foldable callout carries beside its title in the reading view, on
 *  paper and on a published page; see @nib/markdown/icons. */
function chevron(): SVGElement {
  return iconElement(CHEVRON)
}

/** The chevron in the margin beside anything that can fold.
 *
 *  Calm: nothing until the pointer is on the line, and always there once the
 *  line is folded, since that is the one state a reader has to be able to
 *  undo. A finger gets it at `--touch-target` and gets it always, because a
 *  screen with no pointer has no hover to reveal it with.
 *
 *  Where the fold is comes from the document at the moment of the press rather
 *  than from the widget, so a widget kept across an edit cannot act on a range
 *  that has moved. */
class FoldWidget extends NibWidget {
  constructor(private readonly folded: boolean) {
    super()
  }

  override eq(other: FoldWidget) {
    return other.folded === this.folded
  }

  /** The same element, told it is open now: a fresh one would start the
   *  chevron's turn over from nothing and the turn is the whole point. */
  override updateDOM(dom: HTMLElement) {
    const hinge = dom.firstElementChild
    if (!(hinge instanceof HTMLElement)) return false

    hinge.dataset.folded = String(this.folded)
    hinge.setAttribute('aria-label', label(this.folded ? 'unfold' : 'fold'))
    return true
  }

  toDOM(view: EditorView) {
    // The slot holds no width of its own, so the line starts exactly where it
    // would have; the hinge hangs off it into the margin.
    const slot = document.createElement('span')
    slot.className = 'nib-fold'
    slot.contentEditable = 'false'

    const hinge = document.createElement('button')
    hinge.type = 'button'
    hinge.className = 'nib-fold-hinge'
    hinge.dataset.folded = String(this.folded)
    hinge.setAttribute('aria-label', label(this.folded ? 'unfold' : 'fold'))
    // Not in the tab order: every foldable block would be a stop on the way
    // through a note. The keyboard's way in is the command.
    hinge.tabIndex = -1
    hinge.append(chevron())

    hinge.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(hinge)
      const line = view.state.doc.lineAt(pos)

      if (shuttingAt(view.state, line.from, line.to)) {
        stopShutting(view)
        return
      }

      const open = foldedAtLine(view.state, line)
      if (open) openFolds(view, [open])
      else {
        const range = foldAtLine(view.state, line)
        if (range) shutFolds(view, [range], caretFor(view.state, [range]))
      }
    })

    slot.append(hinge)
    return slot
  }

  override ignoreEvent() {
    return false
  }
}

/** What is left where a fold took the words away: a mark that says there is
 *  more, in no words at all.
 *
 *  Its click opens the fold the same way the chevron does, movement and all,
 *  rather than through the library's own handler: one gesture with two answers
 *  would be two gestures. The handler is still there for a mark whose fold
 *  cannot be found, which nothing has produced but which is what it is for. */
function placeholder(view: EditorView, onclick: (event: Event) => void): HTMLElement {
  const more = document.createElement('span')
  more.className = 'nib-folded'
  more.setAttribute('aria-label', label('unfold'))
  more.textContent = '⋯'

  more.addEventListener('click', (event) => {
    const line = view.state.doc.lineAt(view.posAtDOM(more))
    const open = foldedAtLine(view.state, line)

    if (open) openFolds(view, [open])
    else onclick(event)
  })

  return more
}

/** A chevron on every line in view that can fold. Rebuilt when the document,
 *  the viewport or what is folded changes - which is exactly when the answer
 *  can differ. */
const hinges = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        foldsChanged(update) ||
        shuttingChanged(update)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const marks = []
  const { state } = view

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      // A fold on its way shut counts as shut: the chevron turns as the lines
      // start to go rather than once they have gone, so the mark leads the
      // movement instead of catching up with it.
      const folded = !!foldedAtLine(state, line) || shuttingAt(state, line.from, line.to)

      if (folded || foldOpenedBy(state, line)) {
        marks.push(Decoration.widget({ widget: new FoldWidget(folded), side: -1 }).range(line.from))
      }

      if (line.to >= state.doc.length) break
      pos = line.to + 1
    }
  }

  return Decoration.set(marks, true)
}

/** Everything folding needs to work: the state the folds live in, the mark left
 *  behind, the chevron that reaches them with a pointer, and the movement that
 *  gets the lines out of the way and back again; see fold-motion.ts. */
export function folding(): Extension {
  return [codeFolding({ placeholderDOM: placeholder }), hinges, foldMovement()]
}
