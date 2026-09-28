/** A note's front matter kept off the page, and the caret and the keys kept out of
 *  where it was.
 *
 *  Hidden is where every note starts. The metadata at the top of a file is what the
 *  app reads - the icon a note wears, its cover, its tags - and not something to read
 *  on the way into the note. Emil, of a note whose first three lines were
 *  `---`, `icon: list-checks` and `---`: that should not be shown by default. The
 *  rows and the YAML are one setting away; see `propertiesMode`.
 *
 *  blocks.ts draws hidden metadata as a block replacement with nothing in it, which
 *  is atomic, so the caret cannot stand inside it. What is left are the two edges,
 *  and both are on the wrong side of the fence for writing: the position before the
 *  block is the start of the note, where a word typed goes in front of the opening
 *  `---`, and the position after it is the end of the closing `---`'s own line. So
 *  a caret put anywhere up there by hand is put at the start of the first line the
 *  reader can see, and an edit made by hand that would reach into what is hidden is
 *  moved clear of it or not made - a Backspace at the top of what shows joins
 *  nothing, as it does at the top of any note. Ctrl+A selects what is on the page,
 *  so a note selected and typed over keeps its metadata, and Ctrl+Z is the way back
 *  from anything else. Nothing here rewrites the metadata itself: a file is saved
 *  with it exactly as it was.
 *
 *  Edits the app makes on purpose - an icon chosen, a cover dragged, a meeting note
 *  written whole - carry user events of their own and are left alone.
 *
 *  Inserting front matter while it is hidden shows it for as long as the caret stays
 *  in it, as the YAML, and tucks it away again once the caret leaves. */

import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  type SelectionRange,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { PropertiesMode } from '@nib/markdown/properties'
import { isExternal } from '../external'

/** What the note's front matter is drawn as: the rows it says, the YAML it is
 *  written in, or nothing at all. The reader's own answer, asked once in Settings
 *  and read by the reading view through the same three words; see properties.ts in
 *  @nib/markdown. Nothing is where a note with no answer starts. */
export const propertiesMode = Facet.define<PropertiesMode, PropertiesMode>({
  combine: (values) => values[0] ?? 'hidden',
})

/** Shows hidden front matter for as long as the caret stays in it; see
 *  `insertFrontMatter` in commands.ts, which is where it is sent from. */
export const showFrontMatter = StateEffect.define()

/** Where a note's front matter sits: `end` is the end of its closing fence's line,
 *  `after` the first position past that line break, or the end of a note that is
 *  nothing but its metadata. */
export interface FrontMatterSpan {
  end: number
  after: number
}

/** The note's front matter, or null where it has none or where its closing fence has
 *  not been written yet - an unclosed block is the parser reading to the end of the
 *  note, and hiding that would hide the note.
 *
 *  Asked of the tree's first node, so it costs the same however long the note is. */
export function frontMatterSpan(state: EditorState): FrontMatterSpan | null {
  const first = syntaxTree(state).topNode.firstChild
  if (first?.name !== 'FrontMatter' || first.from !== 0) return null
  if (first.getChildren('FrontMatterMark').length < 2) return null

  const end = state.doc.lineAt(first.to).to
  return { end, after: Math.min(end + 1, state.doc.length) }
}

/** Whether the metadata is showing for now, though the answer is to hide it. */
const shownForNow = StateField.define<boolean>({
  create: () => false,

  update(shown, transaction) {
    if (transaction.effects.some((effect) => effect.is(showFrontMatter))) return true
    if (!shown) return false
    // Another note, or this one as somebody else wrote it: nobody's caret is in it.
    if (isExternal(transaction)) return false
    if (!transaction.docChanged && !transaction.selection) return true

    // A block written a moment ago may not be in the tree yet, and nothing is
    // hidden until it is.
    const span = frontMatterSpan(transaction.state)
    return !span || transaction.state.selection.main.head <= span.end
  },
})

/** What the front matter is drawn as in this state, with a block shown for now drawn
 *  as the YAML the caret is in. */
export function drawnAs(state: EditorState): PropertiesMode {
  const asked = state.facet(propertiesMode)
  return asked === 'hidden' && state.field(shownForNow, false) === true ? 'source' : asked
}

/** Whether a block that was shown for now has just been tucked away, or the other way
 *  round, which changes what is drawn without the setting moving. */
export function shownChanged(before: EditorState, after: EditorState): boolean {
  return before.field(shownForNow, false) !== after.field(shownForNow, false)
}

/** The front matter this state keeps off the page, or null where nothing is hidden.
 *  Null too without the live preview, which is source mode: the file as written,
 *  metadata and all. */
export function hiddenFrontMatter(state: EditorState): FrontMatterSpan | null {
  if (state.field(shownForNow, false) !== false) return null
  if (state.facet(propertiesMode) !== 'hidden') return null
  return frontMatterSpan(state)
}

/** Whether a position is one the reader can see, for a search that should find only
 *  what is on the page; see finding.ts. */
export function onThePage(state: EditorState, from: number): boolean {
  const hidden = hiddenFrontMatter(state)
  return !hidden || from > hidden.end
}

/** The reader's own gestures at the caret: typing, pasting, dropping, deleting and
 *  moving lines, and a command inserting where the caret is, which says plain
 *  `input`. Every sub-event of `input` beyond those is the app writing somewhere on
 *  purpose. */
const BY_HAND = ['input.type', 'input.paste', 'input.drop', 'delete', 'move']

function byHand(transaction: Transaction): boolean {
  return (
    transaction.annotation(Transaction.userEvent) === 'input' ||
    BY_HAND.some((event) => transaction.isUserEvent(event))
  )
}

/** The edit as it goes in with the hidden block left whole, or nothing at all where
 *  there is no such edit. */
function keptClear(
  transaction: Transaction,
  hidden: FrontMatterSpan,
): Transaction | TransactionSpec | readonly TransactionSpec[] {
  const touched: { fromA: number; toA: number; text: string }[] = []
  let count = 0
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count += 1
    if (fromA <= hidden.end) touched.push({ fromA, toA, text: inserted.toString() })
  })

  const [change] = touched
  if (!change) return transaction

  // A line moved over the fence carries the fence with it, and a change among
  // several cannot be moved on its own without the others meaning something else.
  if (count > 1 || transaction.isUserEvent('move')) return []

  const { fromA, toA, text } = change
  const from = hidden.after
  const to = Math.max(toA, from)
  // Only what was hidden, and nothing written: a Backspace at the top of the page.
  if (to === from && text === '') return []

  // A note that is nothing but its metadata has no line after the fence, and a word
  // written at the end of that line would be written onto the fence.
  const lineBreak = text !== '' && from === hidden.end ? transaction.startState.lineBreak : ''
  const insert = lineBreak + text
  const changes = transaction.startState.changes({ from, to, insert })

  // Where the transaction put the caret, carried over: inside what it wrote, the same
  // distance in; anywhere else, where that place went.
  const place = (at: number) => {
    if (at >= fromA && at <= fromA + text.length) return from + lineBreak.length + (at - fromA)
    const before = at < fromA ? at : at - text.length + (toA - fromA)
    return changes.mapPos(Math.max(before, from), 1)
  }
  const selection = transaction.selection
    ? EditorSelection.create(
        transaction.selection.ranges.map((range) =>
          EditorSelection.range(place(range.anchor), place(range.head)),
        ),
        transaction.selection.mainIndex,
      )
    : clampedTo(transaction.startState.selection, from).map(changes, 1)

  return {
    changes,
    selection,
    scrollIntoView: transaction.scrollIntoView,
    userEvent: transaction.annotation(Transaction.userEvent) ?? 'input',
  }
}

/** Every range with both ends at or past `from`. */
function clampedTo(selection: EditorSelection, from: number): EditorSelection {
  const clamp = (range: SelectionRange) =>
    EditorSelection.range(Math.max(range.anchor, from), Math.max(range.head, from))
  return EditorSelection.create(selection.ranges.map(clamp), selection.mainIndex)
}

/** The caret out of the hidden lines, wherever it was put.
 *
 *  Not a caret that was only carried: every note opens with one at 0, and a
 *  transaction that states it again - the folds a note asks for do - has not moved
 *  it. Left there it is drawn at the top of the page and nothing is revealed for it;
 *  what is typed there goes where the reader sees it, by `keptClear`. */
function caretClear(
  transaction: Transaction,
): Transaction | TransactionSpec | readonly TransactionSpec[] {
  const selection = transaction.selection
  if (!selection || isExternal(transaction)) return transaction
  if (!transaction.docChanged && transaction.startState.selection.eq(selection)) return transaction

  // Asked of the state the transaction leaves, where the lines it moved now are.
  const hidden = hiddenFrontMatter(transaction.state)
  if (!hidden) return transaction
  if (selection.ranges.every((range) => range.from >= hidden.after)) return transaction

  return [transaction, { selection: clampedTo(selection, hidden.after), sequential: true }]
}

const guard = EditorState.transactionFilter.of((transaction) => {
  // The command that shows the block puts the caret in it on purpose.
  if (transaction.effects.some((effect) => effect.is(showFrontMatter))) return transaction

  const hidden = hiddenFrontMatter(transaction.startState)
  if (hidden && transaction.docChanged && byHand(transaction)) {
    const kept = keptClear(transaction, hidden)
    if (kept !== transaction) return kept
  }

  return caretClear(transaction)
})

/** The field and the filter, which live preview carries and source mode does not. */
export const hiddenFrontMatterGuard: Extension = [shownForNow, guard]
