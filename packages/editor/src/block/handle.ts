/** The mark in the margin beside every block: take hold of it to move the block,
 *  press it for everything else the block can do.
 *
 *  Moving is the part that needs a mark. Everything else a block can do already
 *  has a home - the menu a right press opens, which is the same menu this one
 *  opens, built in the app beside every other command. So the press here does not
 *  build a menu of its own: it asks for that one, at the mark, by sending the
 *  event the app is already listening for. One menu, one list of rows, one place
 *  they are written down.
 *
 *  What is dragged is a block as span.ts means it, which for a heading is its
 *  whole section. Where it lands is a line between two blocks, drawn as it is
 *  dragged; how the text is cut and put back is move.ts. Nothing is moved until
 *  the button comes up, so a drag that ends anywhere else leaves the note exactly
 *  as it was.
 *
 *  Only where there is a pointer. A finger has no hover to bring a mark out with,
 *  the margin is a thumb's width on a phone, and dragging a paragraph across a
 *  screen that scrolls under the finger is not a gesture anybody wants; the menu
 *  is a long press away there, which is the same menu again. */

import { type Extension, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { label } from '../labels'
import { NibWidget } from '../live-preview/widget'
import { landing, moveBlock } from './move'
import { blockAt, blocksIn, type BlockSpan } from './span'

/** A block on its way somewhere: what is being moved, and the line it would land
 *  in front of - the end of the note, when it lands after everything. */
interface Carrying {
  span: BlockSpan
  at: number | null
}

const lift = StateEffect.define<Carrying>()
const drop = StateEffect.define()

/** What is being carried, so the lines can say so: the block goes quiet and the
 *  place it would land is drawn. State rather than a class written onto the DOM,
 *  because the editor redraws lines whenever it likes and would take a class with
 *  it. */
const carrying = StateField.define<Carrying | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(lift)) return effect.value
      if (effect.is(drop)) return null
    }

    // A document that changed under a drag is a document whose offsets have
    // moved; the drag is called off rather than moving the wrong lines.
    return transaction.docChanged ? null : value
  },

  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const held = state.field(field)
      if (!held) return Decoration.none

      const doc = state.doc
      const marks = []

      for (
        let number = doc.lineAt(held.span.from).number;
        number <= doc.lineAt(held.span.to).number;
        number++
      ) {
        marks.push(Decoration.line({ class: 'nib-block-lifted' }).range(doc.line(number).from))
      }

      if (held.at !== null) {
        const landing = held.at >= doc.length ? doc.line(doc.lines) : doc.lineAt(held.at)
        marks.push(
          Decoration.line({
            class: held.at >= doc.length ? 'nib-block-under' : 'nib-block-over',
          }).range(landing.from),
        )
      }

      return Decoration.set(marks, true)
    }),
})

/** Six dots, the way every editor draws something to take hold of. */
function grip(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 10 14')

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M3 3h.01M3 7h.01M3 11h.01M7 3h.01M7 7h.01M7 11h.01')
  svg.append(path)

  return svg
}

/** The line a drag over `y` would put the block in front of: the start of the
 *  block the pointer is in the top half of, the start of the one after it
 *  otherwise, and the end of the note when there is none. */
function landingAt(view: EditorView, y: number): number | null {
  const edge = view.contentDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: edge.left + 1, y }, false)
  const block = blockAt(view.state, pos)
  if (!block) return null

  // The editor measures its blocks from the top of the document; the pointer is
  // measured from the top of the window. `documentTop` is the difference.
  const top = view.documentTop + view.lineBlockAt(block.from).top
  const bottom = view.documentTop + view.lineBlockAt(block.to).bottom
  if (y < (top + bottom) / 2) return block.from

  const doc = view.state.doc
  let next = doc.lineAt(block.to).number + 1
  while (next <= doc.lines && doc.line(next).text.trim() === '') next++

  return next > doc.lines ? doc.length : doc.line(next).from
}

/** Where a block would land, or nothing when it would not move at all: dropping
 *  a block on itself, or back where it already is. Asked of move.ts rather than
 *  worked out again here, so the line drawn and the edit made agree - a drop
 *  between an item and the items nested under it is drawn where the block really
 *  goes, in front of the item. */
function landingFor(view: EditorView, span: BlockSpan, y: number): number | null {
  const at = landingAt(view, y)
  return at === null ? null : landing(view.state, span, at)
}

/** How far the pointer travels before a press becomes a drag. Short enough that
 *  a drag feels immediate, long enough that a press with a shaking hand is still
 *  a press. */
const A_DRAG = 4

class BlockHandleWidget extends NibWidget {
  /** Every one of these is the same mark; which block it belongs to is read off
   *  the document when it is pressed, so a widget the editor kept across an edit
   *  cannot act on a block that has moved. */
  override eq() {
    return true
  }

  toDOM(view: EditorView) {
    const slot = document.createElement('span')
    slot.className = 'nib-block-slot'
    slot.contentEditable = 'false'

    const mark = document.createElement('button')
    mark.type = 'button'
    mark.className = 'nib-block-handle'
    mark.setAttribute('aria-label', label('blockHandle'))
    // Not in the tab order: every block in the note would be a stop on the way
    // through it. The keyboard reaches all of this through the commands.
    mark.tabIndex = -1
    mark.append(grip())

    mark.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.button !== 0) return

      const span = blockAt(view.state, view.posAtDOM(mark))
      if (span) carry(view, mark, span, event)
    })

    slot.append(mark)
    return slot
  }

  override ignoreEvent() {
    return false
  }
}

/** One press on a mark, from the button going down to whatever it turns out to
 *  mean: a drag that moves the block, or a press that asks for the menu. */
function carry(view: EditorView, mark: HTMLElement, span: BlockSpan, start: MouseEvent) {
  let dragging = false

  const move = (event: MouseEvent) => {
    const travelled =
      Math.abs(event.clientY - start.clientY) + Math.abs(event.clientX - start.clientX)
    if (!dragging && travelled < A_DRAG) return

    dragging = true
    const at = landingFor(view, span, event.clientY)
    // Only when the answer changes: a transaction per pointer event would redraw
    // the block's lines sixty times a second to say the same thing.
    if (view.state.field(carrying, false)?.at === at) return

    view.dispatch({ effects: lift.of({ span, at }) })
  }

  const up = (event: MouseEvent) => {
    view.dom.ownerDocument.removeEventListener('mousemove', move)
    view.dom.ownerDocument.removeEventListener('mouseup', up)

    const held = view.state.field(carrying, false)
    view.dispatch({ effects: drop.of(null) })

    if (!dragging) {
      // A press and no travel is a press: the app's own menu, at the mark. The
      // event carries where it happened, which is what places the menu and what
      // says which block it is about.
      //
      // After this press has finished being one, though. A menu in the app shuts
      // on the next click anywhere, and the click that follows this button
      // coming up would arrive a moment after the menu opened and shut it again.
      const { clientX, clientY } = event
      setTimeout(() => {
        mark.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY }))
      })
      return
    }

    if (held?.at == null) return
    const edit = moveBlock(view.state, held.span, held.at)
    if (!edit) return

    view.dispatch({
      changes: edit.changes,
      ...(edit.caret === null ? {} : { selection: { anchor: edit.caret } }),
      scrollIntoView: true,
    })
    view.focus()
  }

  view.dom.ownerDocument.addEventListener('mousemove', move)
  view.dom.ownerDocument.addEventListener('mouseup', up)
}

/** A mark on the first line of every block in view. Rebuilt when the document or
 *  the viewport changes, which is when the answer can differ. */
const handles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const marks = []
  const taken = new Set<number>()

  for (const { from, to } of view.visibleRanges) {
    for (const span of blocksIn(view.state, from, to)) {
      const line = view.state.doc.lineAt(span.from).from
      if (taken.has(line)) continue

      taken.add(line)
      marks.push(Decoration.widget({ widget: new BlockHandleWidget(), side: -2 }).range(line))
    }
  }

  return Decoration.set(marks, true)
}

/** The mark, and the state a drag needs while it lasts. */
export function blockHandles(): Extension {
  return [carrying, handles]
}
