import { redo, undo } from '@codemirror/commands'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { label, type LabelKey } from '../labels'
import {
  attached,
  button,
  collapsedAt,
  element,
  posOnRow,
  sameCell,
  showRendered,
  showSource,
} from './cells'
import {
  caretAtEdge,
  caretOffset,
  caretRect,
  selectAtPoint,
  selectIn,
  selectionIn,
  textRows,
} from './caret'
import { type Align, type Order, type TableModel, serializeTable, setCell } from './model'
import {
  type CellAddress,
  type Side,
  cellAbove,
  cellAfter,
  cellBefore,
  cellBelow,
  firstCell,
  lastCell,
  lineBeside,
  type TableSpan,
  tableAt,
} from './navigation'
import {
  alignedColumn,
  type Edit,
  type Focus,
  insertedColumn,
  insertedRow,
  movedColumn,
  movedRow,
  removedColumn,
  removedRow,
  sortedColumn,
} from './edits'
import { inlineShortcut, runInCell } from './shortcuts'

/** What a table's widget knows: the text it renders, and where that text is. */
export interface TableSource {
  source: string
  from: number
  to: number
}

/** Where the caret goes in a cell it has just been moved into: an end of the
 *  text, all of it, or the spot on the top or bottom row nearest to an x. */
export type Placement = 'start' | 'end' | 'all' | { x: number; edge: 'top' | 'bottom' }

/** Where the caret goes when it steps out: an end of the line, or the spot
 *  nearest to where it was. */
export type Landing = 'start' | 'end' | { x: number }

/** How long a cell may sit untouched before its edit is written out anyway.
 *  Blur is the primary trigger; this is the safety net for when focus never
 *  leaves the cell. */
const IDLE_COMMIT = 700

/** The table currently holding an uncommitted cell edit. Rewriting the source
 *  on every keystroke would be a document change per character, so edits
 *  land when the cell is left - or when this is flushed. */
let active: TableView | null = null

/** Writes any in-progress cell edit into the document. Call before saving. */
export function flushTableEdits() {
  active?.flush()
}

/** Remembers which table holds an uncommitted edit, so the flush above can find
 *  it. Named rather than assigned in place: handing an object's own `this` out
 *  to something that outlives it is worth being able to see. */
function holdsEdit(table: TableView) {
  active = table
}

const ALIGN_PATHS = {
  left: 'M0 2h10M0 5h6M0 8h10',
  center: 'M0 2h10M2 5h6M0 8h10',
  right: 'M0 2h10M4 5h6M0 8h10',
} as const

const ALIGN_LABELS = {
  left: 'alignLeft',
  center: 'alignCenter',
  right: 'alignRight',
} as const

/** The live DOM of one rendered table. Built once and then kept up to date
 *  with the document, so that column widths, the caret and the controls
 *  survive each edit instead of being rebuilt around it. */
export class TableView {
  readonly dom: HTMLElement

  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement
  private readonly columnBar: HTMLElement
  private readonly rowBar: HTMLElement
  private readonly alignButtons: Record<'left' | 'center' | 'right', HTMLButtonElement>

  private model: TableModel
  private source: string

  /** The focused cell's text, not yet in the document. */
  private pending: { at: CellAddress; value: string } | null = null
  private idle: number | undefined

  /** The cell to put the caret in once the next redraw has happened. */
  private focusAfter: Focus | null = null

  /** Column widths set by dragging; markdown records none, so they are the
   *  view's to keep. */
  private widths: (number | null)[]

  /** The column whose controls are up. */
  private barColumn = -1

  /** The row whose controls are up. */
  private barRow = -1

  /** Which column this table was last sorted by, and which way, so pressing the
   *  button again turns it round. The view's own and never the note's: the order
   *  is written into the rows, and how it got there is not a fact about the file.
   *  A table read again tomorrow sorts upwards first, which is where anybody
   *  starts. */
  private sortedAs: { column: number; order: Order } | null = null

  /** How to end a column drag that is still going, so the document listeners it
   *  put down come off even if the table goes first. */
  private dragging: (() => void) | null = null

  /** Whether the cells were drawn as fields. Reading mode takes that away, and
   *  the table has to be redrawn for it: a cell is contenteditable in the DOM,
   *  which no stylesheet can undo. */
  private editable: boolean

  constructor(
    readonly editor: EditorView,
    text: TableSource,
    model: TableModel,
  ) {
    this.model = model
    this.source = text.source
    this.widths = model.header.map(() => null)
    this.editable = !editor.state.readOnly

    this.dom = element('div', 'nib-table-wrap')
    // Outside the editor's editable region: the cells opt back in one by one.
    // Without this the whole table is part of what CodeMirror believes is
    // document text, and the caret can be placed into DOM that maps to nothing.
    this.dom.contentEditable = 'false'

    this.scroller = element('div', 'nib-table-scroll')
    this.table = element('table', 'nib-table')
    this.scroller.append(this.table)

    this.alignButtons = {
      left: this.columnButton('left', ALIGN_PATHS.left, (column) =>
        this.toggleAlign(column, 'left'),
      ),
      center: this.columnButton('center', ALIGN_PATHS.center, (column) =>
        this.toggleAlign(column, 'center'),
      ),
      right: this.columnButton('right', ALIGN_PATHS.right, (column) =>
        this.toggleAlign(column, 'right'),
      ),
    }
    this.columnBar = this.buildColumnBar()
    this.rowBar = this.buildRowBar()
    this.dom.append(this.scroller, this.columnBar, this.rowBar)
    this.watchColumnHover()
    this.watchRowHover()

    this.render()
  }

  /** Where this table's text is in the document, right now, or null when the
   *  editor has let go of the widget.
   *
   *  Asked of the view rather than remembered, for the same reason image.ts
   *  gives: prose typed elsewhere in the note moves the table's text without
   *  redrawing anything. The block field maps the decoration along and hands
   *  the very same widget back, so nothing here is told that anything happened.
   *  A remembered offset then points at the wrong text - and since `commit`
   *  checks the text before writing, a cell edit made after such a keystroke
   *  was quietly thrown away. */
  span(): TableSpan | null {
    const { editor, dom } = this
    if (!editor.contentDOM.contains(dom)) return null

    // `posAtDOM` gives the start of the block the widget replaces, which is the
    // start of the table's first line. The end of that line is inside the node
    // whatever the indent, which is what the tree can be asked about.
    const at = Math.min(editor.posAtDOM(dom), editor.state.doc.length)
    return tableAt(editor.state, editor.state.doc.lineAt(at).to)
  }

  /** Points the DOM at a newer version of the source. Redrawn only when the
   *  document says something the cells do not already show - after an edit
   *  made here, it never does. */
  adopt(text: TableSource, model: TableModel) {
    // Compared in canonical form: a table typed by hand is rarely aligned
    // the way the serializer writes it, and that is not a difference.
    const shown = serializeTable(model) === serializeTable(this.current())
    this.source = text.source
    this.model = model

    if (shown && this.editable === !this.editor.state.readOnly) {
      this.focusAfter = null
      return
    }
    this.editable = !this.editor.state.readOnly
    this.clearPending()
    this.render()
  }

  destroy() {
    this.clearPending()
    this.dragging?.()
  }

  flush() {
    if (this.pending) this.commit(this.current())
  }

  /** Walks the caret in from the line above or below. */
  enter(side: Side, where: Landing): boolean {
    if (where === 'start') return this.focusCell(firstCell, 'start')
    if (where === 'end') return this.focusCell(lastCell(this.model), 'end')

    const row = side === 'above' ? -1 : this.model.rows.length - 1
    const column = this.columnAt(row, where.x)
    return this.focusCell(
      { row, column },
      { x: where.x, edge: side === 'above' ? 'top' : 'bottom' },
    )
  }

  /** Puts the caret in a cell. The cell swaps to its markdown as it takes
   *  focus, so the caret is placed after that, into the source text. */
  focusCell(at: CellAddress, placement: Placement | number): boolean {
    // A rendered table is something to read like any other block while the note
    // is read-only; its cells are not fields. The key that asked to walk in gets
    // its answer back and steps over the table instead.
    if (this.editor.state.readOnly) return false

    // The cell may be gone - an undo can take the column it was in - so the
    // nearest one that exists takes the caret instead.
    const { model } = this
    const cell = this.cellAt({
      row: Math.min(at.row, model.rows.length - 1),
      column: Math.min(at.column, model.header.length - 1),
    })
    if (!cell) return false

    cell.focus()
    const length = cell.textContent.length

    if (typeof placement === 'number') selectIn(cell, Math.min(placement, length))
    else if (placement === 'start') selectIn(cell, 0)
    else if (placement === 'end') selectIn(cell, length)
    else if (placement === 'all') selectIn(cell, 0, length)
    else {
      const rows = textRows(cell)
      const row = placement.edge === 'top' ? rows[0] : rows[rows.length - 1]
      if (!row) selectIn(cell, 0)
      else {
        const x = Math.max(row.left, Math.min(row.right - 1, placement.x))
        selectAtPoint(cell, x, (row.top + row.bottom) / 2)
      }
    }
    return true
  }

  /** Hands the caret back to the editor, on the line above or below. */
  leave(side: Side, where: Landing) {
    this.flush()

    const { editor } = this
    // Read after the flush, since that may have rewritten the table.
    const span = this.span()
    if (!span) return

    const line = lineBeside(editor.state, span, side)
    let pos = line.from
    if (!line.made) {
      if (where === 'end') pos = line.to
      else if (typeof where === 'object') pos = posOnRow(editor, line, side, where.x)
    }

    // A vertical step out carries its column on, the way it does between
    // lines, so the next arrow press continues in the same column.
    const goal =
      typeof where === 'object'
        ? where.x - editor.contentDOM.getBoundingClientRect().left
        : undefined
    editor.dispatch({
      changes: line.changes,
      selection: EditorSelection.create([EditorSelection.cursor(pos, undefined, undefined, goal)]),
      scrollIntoView: true,
    })
    editor.focus()
  }

  /** The model including whatever the focused cell currently reads. */
  private current(): TableModel {
    const { pending, model } = this
    return pending ? setCell(model, pending.at.row, pending.at.column, pending.value) : model
  }

  /** Writes a model into the document. The new widget then adopts this DOM,
   *  which is where `focusAfter` is acted on. */
  private commit(next: TableModel, focus?: Focus) {
    // Every edit a table makes comes through here, so this is where read-only
    // mode stops them - the buttons in the margins and the idle timer of a
    // cell that was being typed in when the mode came on, both.
    if (this.editor.state.readOnly) {
      this.clearPending()
      return
    }

    window.clearTimeout(this.idle)
    this.focusAfter = focus ?? null

    const text = serializeTable(next)
    // The document may have moved on without this table, in which case the
    // widget is about to be dropped and the edit with it. Better than writing
    // over whatever took its place.
    const { editor } = this
    const span = this.span()
    const current = span && editor.state.doc.sliceString(span.from, span.to) === this.source

    if (text !== this.source && span && current) {
      // The edit stays pending through the dispatch: the new widget compares
      // the document against what the cells show, and the edit is part of it.
      editor.dispatch({ changes: { from: span.from, to: span.to, insert: text } })
    }

    this.clearPending()
    this.focusAfter = null
  }

  private clearPending() {
    window.clearTimeout(this.idle)
    this.pending = null
    if (active === this) active = null
  }

  private render() {
    const { model } = this
    // A redraw pulls the caret out of the cell it is in; note where it was.
    const focus = this.focusAfter ?? this.focusedCell()
    this.focusAfter = null

    const head = element('thead')
    const headRow = element('tr')
    head.append(headRow)

    model.header.forEach((text, column) => {
      const at = { row: -1, column }
      const th = this.cell(text, at, 'th', sameCell(at, focus?.at))

      // Markdown records no column widths, so a resize is a view-level nicety,
      // exactly as it is in Typora.
      const grip = element('span', 'nib-table-resize')
      grip.contentEditable = 'false'
      grip.title = label('dragToResize')
      grip.addEventListener('mousedown', (event) => this.startResize(event, th, column))
      th.append(grip)

      const width = this.widths[column]
      if (width != null) th.style.width = `${width}px`
      headRow.append(th)
    })

    const body = element('tbody')
    model.rows.forEach((row, index) => {
      const tr = element('tr')
      const cells = row.map((text, column) => {
        const at = { row: index, column }
        return this.cell(text, at, 'td', sameCell(at, focus?.at))
      })
      tr.append(...cells)
      body.append(tr)
    })

    this.table.replaceChildren(head, body)

    // The row the bar was put beside is gone. It stays where it was, for the row
    // that has that place now, which is the one under a pointer that has not
    // moved - as it was when every row had controls of its own - and the caret's
    // row takes it back as soon as the caret is in again.
    if (this.rowBar.classList.contains('is-shown')) {
      const tr = this.bodyRow(this.barRow)
      if (tr) this.showRowBar(tr)
      else this.hideRowBar()
    }

    // The editor is still mid-update while it adopts the DOM; the caret goes
    // in once that has settled - unless the editor itself has taken it by
    // then, which means the caret was on its way out of the table.
    if (focus) {
      queueMicrotask(() => {
        if (document.activeElement === this.editor.contentDOM) return
        this.focusCell(focus.at, focus.offset)
      })
    }
  }

  private cell(text: string, at: CellAddress, tag: 'th' | 'td', editing: boolean) {
    const cell = element(tag)
    cell.contentEditable = this.editable ? 'true' : 'false'
    cell.spellcheck = true
    cell.dataset.row = String(at.row)
    cell.dataset.column = String(at.column)

    // The cell is its own little source editor, so its text has to be the
    // markdown while the caret is in it. Everywhere else it shows the result,
    // which is the same bargain the rest of the editor makes with syntax. A
    // cell about to take the caret starts as source, so it does not flash.
    cell.dataset.source = text
    if (editing) showSource(cell)
    else showRendered(cell)

    const align = this.model.align[at.column]
    if (align) cell.style.textAlign = align

    // The browser places the caret from the click, but the text under the
    // click changes as the cell takes focus and shows its markdown. So the
    // caret is placed by hand, once the markdown is up.
    cell.addEventListener('mousedown', (event) => {
      // Not a caret to place while the note is read-only, and not
      // preventDefault either:
      // dragging a selection across the table is how a reader copies it.
      if (this.editor.state.readOnly) return
      if (event.button !== 0 || document.activeElement === cell) return
      event.preventDefault()
      cell.focus()
      selectAtPoint(cell, event.clientX, event.clientY)
    })

    cell.addEventListener('focus', () => showSource(cell))
    cell.addEventListener('blur', () => this.left(cell, at))
    cell.addEventListener('input', () => this.edited(cell, at))
    cell.addEventListener('keydown', (event) => this.keyInCell(event, cell, at))
    cell.addEventListener('beforeinput', (event) => this.inputInCell(event, cell, at))
    cell.addEventListener('paste', (event) => this.pasteInCell(event, cell, at))

    return cell
  }

  private edited(cell: HTMLElement, at: CellAddress) {
    // Reading mode can arrive with the caret already in a cell. What is typed
    // after that has nowhere to go, so the cell hands the caret back and shows
    // the document again.
    if (this.editor.state.readOnly) {
      cell.blur()
      return
    }

    this.pending = { at, value: cell.textContent }
    holdsEdit(this)

    window.clearTimeout(this.idle)
    this.idle = window.setTimeout(() => this.flush(), IDLE_COMMIT)
  }

  private left(cell: HTMLElement, at: CellAddress) {
    // A redraw blurs the old cell; its text is already in the document.
    if (!attached(cell)) return
    this.flush()
    // Which may have rewritten the table and taken this cell with it. Asked
    // through a function, since the compiler holds the answer to the first
    // question and would otherwise call the second one pointless.
    if (!attached(cell)) return

    cell.dataset.source = this.textOf(at)
    showRendered(cell)
  }

  private keyInCell(event: KeyboardEvent, cell: HTMLElement, at: CellAddress) {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (key === 'Tab' && !mod && !event.altKey) {
      event.preventDefault()
      const next = event.shiftKey ? cellBefore(this.model, at) : cellAfter(this.model, at)
      // Tab past the last cell grows the table; Shift-Tab out of the first one
      // hands the caret to the line above, the way ArrowLeft there does. It used
      // to do nothing at all, having already swallowed the key.
      if (next === 'below') this.growBelow(0)
      else if (next === 'above') this.leave('above', 'end')
      else this.focusCell(next, event.shiftKey ? 'end' : 'start')
      return
    }

    // A cell holds one line, so no kind of Enter makes a new one inside it.
    if (key === 'Enter') {
      event.preventDefault()
      const next = cellBelow(this.model, at)
      if (next === 'below') this.growBelow(at.column)
      else this.focusCell(next, 'end')
      return
    }

    if (key === 'Escape') {
      event.preventDefault()
      this.leave('below', 'start')
      return
    }

    if (mod && !event.altKey) {
      const lower = key.toLowerCase()
      if (lower === 'z' && !event.shiftKey) {
        this.history(event, undo, cell, at)
        return
      }
      if (lower === 'y' || (lower === 'z' && event.shiftKey)) {
        this.history(event, redo, cell, at)
        return
      }
      // The browser's select-all reaches past the cell to the whole document.
      if (lower === 'a' && !event.shiftKey) {
        event.preventDefault()
        selectIn(cell, 0, cell.textContent.length)
        return
      }
    }

    const inline = inlineShortcut(event)
    if (inline) {
      event.preventDefault()
      this.runInline(inline, cell, at)
      return
    }

    if (mod || event.altKey || event.shiftKey) return

    switch (key) {
      case 'ArrowUp':
        if (!caretAtEdge(cell, 'top')) return
        event.preventDefault()
        this.stepVertically(cellAbove(at), cell, 'above')
        return
      case 'ArrowDown':
        if (!caretAtEdge(cell, 'bottom')) return
        event.preventDefault()
        this.stepVertically(cellBelow(this.model, at), cell, 'below')
        return
      case 'ArrowLeft': {
        if (!collapsedAt(cell, 0)) return
        event.preventDefault()
        const previous = cellBefore(this.model, at)
        if (previous === 'above') this.leave('above', 'end')
        else if (previous !== 'below') this.focusCell(previous, 'end')
        return
      }
      case 'ArrowRight': {
        if (!collapsedAt(cell, cell.textContent.length)) return
        event.preventDefault()
        const next = cellAfter(this.model, at)
        if (next === 'below') this.leave('below', 'start')
        else if (next !== 'above') this.focusCell(next, 'start')
        return
      }
    }
  }

  /** Up or down: into the cell in the same column, at the same x - or out of
   *  the table when there is no such cell. */
  private stepVertically(step: CellAddress | Side, cell: HTMLElement, side: Side) {
    const x = (caretRect() ?? cell.getBoundingClientRect()).left
    if (typeof step === 'string') this.leave(side, { x })
    else this.focusCell(step, { x, edge: side === 'above' ? 'bottom' : 'top' })
  }

  private growBelow(column: number) {
    const rows = this.model.rows.length
    this.apply(insertedRow(this.current(), rows - 1, column))
  }

  /** Undo and redo are the editor's, not the browser's: a cell's edits live
   *  in the document. The caret stays in the cell through the redraw. */
  private history(event: Event, command: StateCommand, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    this.flush()
    this.focusAfter = { at, offset: caretOffset(cell) }
    command(this.editor)
    this.focusAfter = null
  }

  private runInline(command: StateCommand, cell: HTMLElement, at: CellAddress) {
    const selection = selectionIn(cell)
    if (!selection) return

    const result = runInCell(command, cell.textContent, selection.from, selection.to)
    if (!result) return

    cell.textContent = result.text
    selectIn(cell, result.from, result.to)
    this.edited(cell, at)
  }

  private inputInCell(event: InputEvent, cell: HTMLElement, at: CellAddress) {
    const type = event.inputType
    // The browser's own formatting would put HTML in the cell, and its line
    // breaks would split the row.
    if (type.startsWith('format') || type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
    } else if (type === 'historyUndo') {
      this.history(event, undo, cell, at)
    } else if (type === 'historyRedo') {
      this.history(event, redo, cell, at)
    }
  }

  private pasteInCell(event: ClipboardEvent, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r?\n/g, ' ')
    if (!text) return

    // Goes through the browser's own editing so that it fires `input` like
    // typing does, and so the cell's undo stack knows about the paste. Nothing
    // has replaced `execCommand` for that; the branch below is what happens
    // where it is gone.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement reaches the browser's own undo stack
    if (document.execCommand('insertText', false, text)) return

    const selection = selectionIn(cell)
    if (!selection) return
    const before = cell.textContent
    cell.textContent = before.slice(0, selection.from) + text + before.slice(selection.to)
    selectIn(cell, selection.from + text.length)
    this.edited(cell, at)
  }

  private toggleAlign(column: number, align: NonNullable<Align>) {
    this.apply(alignedColumn(this.current(), column, align, this.focusedCell() ?? undefined))
  }

  /** Sorts by this column, and again the other way. One button rather than two:
   *  a column is sorted one way or the other, and which way it is showing is the
   *  mark on the button. Written into the note, because the rows really are in
   *  that order now; see `sortRows`. */
  private sortBy(column: number) {
    const order = this.sortedAs?.column === column && this.sortedAs.order === 'up' ? 'down' : 'up'
    const edit = sortedColumn(this.current(), column, order, this.focusedCell() ?? undefined)
    if (edit.next === this.current()) return

    this.sortedAs = { column, order }
    this.apply(edit)
  }

  private moveColumnBy(column: number, step: number) {
    const edit = movedColumn(this.current(), column, step, this.focusedCell() ?? undefined)
    if (edit.next === this.current()) return

    // A width is the view's own, so it travels with the column here.
    const [width] = this.widths.splice(column, 1)
    this.widths.splice(column + step, 0, width ?? null)
    this.apply(edit)
  }

  private insertColumnAfter(column: number) {
    this.widths.splice(column + 1, 0, null)
    this.apply(insertedColumn(this.current(), column))
  }

  private deleteColumn(column: number) {
    const edit = removedColumn(this.current(), column, this.focusedCell() ?? undefined)
    if (edit.next === this.current()) return

    this.widths.splice(column, 1)
    this.apply(edit)
  }

  private moveRowBy(row: number, step: number) {
    this.apply(movedRow(this.current(), row, step, this.focusedCell() ?? undefined))
  }

  private insertRowAfter(row: number) {
    this.apply(insertedRow(this.current(), row))
  }

  private deleteRow(row: number) {
    this.apply(removedRow(this.current(), row, this.focusedCell() ?? undefined))
  }

  /** Writes what one of the margin controls decided; see edits.ts. */
  private apply(edit: Edit) {
    this.commit(edit.next, edit.focus)
  }

  /** One set of row controls for the whole table, beside whichever row is
   *  hovered or holds the caret, the way the column bar is over a header cell.
   *
   *  It used to be one set per row, drawn inside the row's first cell because a
   *  positioned <td> still reserves a table column. But a cell swaps what it holds
   *  as it takes the caret and gives it back, and the controls went with it: the
   *  row whose first cell was being written in was the one row without any, until
   *  the table was drawn again. Out here nothing a cell does can reach them, and
   *  they stay put when a wide table is scrolled sideways. */
  private buildRowBar(): HTMLElement {
    const bar = element('div', 'nib-table-rows')
    bar.contentEditable = 'false'
    bar.append(
      button('nib-table-btn', 'moveRowUp', 'M1 6l4-4 4 4', () => this.moveRowBy(this.barRow, -1)),
      button('nib-table-btn', 'moveRowDown', 'M1 4l4 4 4-4', () => this.moveRowBy(this.barRow, 1)),
      button('nib-table-btn', 'insertRow', 'M5 1v8M1 5h8', () => this.insertRowAfter(this.barRow)),
      button('nib-table-btn nib-table-btn-danger', 'deleteRow', 'M1 1l8 8M9 1l-8 8', () =>
        this.deleteRow(this.barRow),
      ),
    )
    return bar
  }

  /** One set of column controls for the whole table, shown over whichever
   *  header cell is hovered or holds the caret. Kept outside the scrolling
   *  part so it can hang above the table without the table making room. */
  private buildColumnBar(): HTMLElement {
    const bar = element('div', 'nib-table-columns')
    bar.contentEditable = 'false'
    bar.append(
      this.alignButtons.left,
      this.alignButtons.center,
      this.alignButtons.right,
      this.columnButton('moveColumnLeft', 'M6 1L2 5l4 4', (column) =>
        this.moveColumnBy(column, -1),
      ),
      this.columnButton('moveColumnRight', 'M4 1l4 4-4 4', (column) =>
        this.moveColumnBy(column, 1),
      ),
      // An arrow down a stack of lines, which is what sorting is: the rows put
      // in the order this column says.
      this.columnButton('sortColumn', 'M2 2h6M2 5h4M2 8h2', (column) => this.sortBy(column)),
      this.columnButton('insertColumn', 'M5 1v8M1 5h8', (column) => this.insertColumnAfter(column)),
      this.columnButton(
        'deleteColumn',
        'M1 1l8 8M9 1l-8 8',
        (column) => this.deleteColumn(column),
        true,
      ),
    )
    return bar
  }

  private columnButton(
    name: LabelKey | 'left' | 'center' | 'right',
    path: string,
    onPress: (column: number) => void,
    danger = false,
  ): HTMLButtonElement {
    const key =
      name in ALIGN_LABELS ? ALIGN_LABELS[name as keyof typeof ALIGN_LABELS] : (name as LabelKey)
    const className = danger ? 'nib-table-btn nib-table-btn-danger' : 'nib-table-btn'
    return button(className, key, path, () => onPress(this.barColumn))
  }

  private watchColumnHover() {
    this.dom.addEventListener('mouseover', (event) => {
      const target = event.target as Element
      const th = target.closest('th')
      if (th && this.table.contains(th)) this.showColumnBar(th)
      else if (!this.columnBar.contains(target)) this.hideColumnBar()
    })
    this.dom.addEventListener('mouseleave', () => this.hideColumnBar())

    this.table.addEventListener('focusin', (event) => {
      const th = (event.target as Element).closest('th')
      if (th) this.showColumnBar(th)
    })
    this.table.addEventListener('focusout', (event) => {
      const next = (event.relatedTarget as Element | null)?.closest('th')
      if (next && this.table.contains(next)) this.showColumnBar(next)
      else this.hideColumnBar()
    })

    // The bar sits outside the scrolling part, so it has to follow by hand.
    this.scroller.addEventListener('scroll', () => {
      const th = this.headerCell(this.barColumn)
      if (th && this.columnBar.classList.contains('is-shown')) this.showColumnBar(th)
    })
  }

  private watchRowHover() {
    this.dom.addEventListener('mouseover', (event) => {
      const target = event.target as Element
      const tr = target.closest('tr')
      if (tr && this.table.tBodies[0]?.contains(tr)) this.showRowBar(tr)
      else if (!this.rowBar.contains(target)) this.hideRowBar()
    })
    this.dom.addEventListener('mouseleave', () => this.hideRowBar())

    this.table.addEventListener('focusin', (event) => {
      const tr = (event.target as Element).closest('td')?.closest('tr')
      if (tr) this.showRowBar(tr)
    })
    this.table.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as Element | null
      // Onto one of the bar's own buttons, which act on the row it is up for.
      if (next && this.rowBar.contains(next)) return
      const tr = next?.closest('td')?.closest('tr')
      if (tr && this.table.contains(tr)) this.showRowBar(tr)
      else this.hideRowBar()
    })

    // A row grows a line as its words wrap, and the bar is put by its middle.
    this.table.addEventListener('input', (event) => {
      const tr = (event.target as Element).closest('td')?.closest('tr')
      if (tr) this.showRowBar(tr)
    })
  }

  private bodyRow(row: number): HTMLTableRowElement | undefined {
    return this.table.tBodies[0]?.rows[row]
  }

  private showRowBar(tr: HTMLTableRowElement) {
    this.barRow = tr.sectionRowIndex

    const bar = this.rowBar
    bar.classList.add('is-shown')
    const wrap = this.dom.getBoundingClientRect()
    const row = tr.getBoundingClientRect()
    bar.style.top = `${row.top - wrap.top + row.height / 2}px`
  }

  /** Unless a body cell holds the caret: its row's controls stay reachable. */
  private hideRowBar() {
    const focused = document.activeElement?.closest('td')?.closest('tr')
    if (focused && this.table.contains(focused)) this.showRowBar(focused)
    else this.rowBar.classList.remove('is-shown')
  }

  private showColumnBar(th: HTMLTableCellElement) {
    const column = Number(th.dataset.column)
    this.barColumn = column

    const bar = this.columnBar
    bar.classList.add('is-shown')
    const wrap = this.dom.getBoundingClientRect()
    const cell = th.getBoundingClientRect()
    const left = Math.max(0, Math.min(cell.left - wrap.left, wrap.width - bar.offsetWidth))
    bar.style.left = `${left}px`

    const align = this.model.align[column]
    for (const [name, element] of Object.entries(this.alignButtons)) {
      element.classList.toggle('is-active', name === align)
    }
  }

  /** Unless a header cell holds the caret: its controls stay reachable. */
  private hideColumnBar() {
    const focused = document.activeElement?.closest('th')
    if (focused && this.table.contains(focused)) this.showColumnBar(focused)
    else this.columnBar.classList.remove('is-shown')
  }

  /** Drags the boundary between two columns. Width lives on the header cell,
   *  and the rest of the column follows because the table is laid out from it.
   *
   *  The handle sits on the column's own end edge, which is its left in a note
   *  that reads right to left, so there a drag to the left is the one that makes
   *  the column wider. The note's direction is read once, at the press: a note
   *  cannot turn round half way through a drag. */
  private startResize(event: MouseEvent, header: HTMLTableCellElement, column: number) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = header.getBoundingClientRect().width
    const factor = getComputedStyle(header).direction === 'rtl' ? -1 : 1

    const move = (moved: MouseEvent) => {
      const width = Math.max(48, startWidth + (moved.clientX - startX) * factor)
      this.widths[column] = width
      header.style.width = `${width}px`
    }
    const finish = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', finish)
      this.dragging = null
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', finish)
    // A drag can outlive its table: an edit elsewhere in the note, or a sync
    // arriving, takes the widget away without a mouseup. Both listeners are on
    // the document, so nothing else would ever take them off it, and the next
    // pointer move would go on sizing a column of a table that is gone.
    this.dragging = finish
  }

  private cellAt(at: CellAddress): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(
      `[data-row="${at.row}"][data-column="${at.column}"]`,
    )
  }

  private headerCell(column: number): HTMLTableCellElement | null {
    return this.table.querySelector<HTMLTableCellElement>(`th[data-column="${column}"]`)
  }

  private focusedCell(): { at: CellAddress; offset: number } | null {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement) || !this.table.contains(focused)) return null
    if (focused.dataset.row === undefined) return null

    return {
      at: { row: Number(focused.dataset.row), column: Number(focused.dataset.column) },
      offset: caretOffset(focused),
    }
  }

  /** The column under an x coordinate, in a given row; the nearest one past
   *  the table's edges. */
  private columnAt(row: number, x: number): number {
    const columns = this.model.header.length
    for (let column = 0; column < columns; column++) {
      const cell = this.cellAt({ row, column })
      if (cell && x < cell.getBoundingClientRect().right) return column
    }
    return columns - 1
  }

  private textOf(at: CellAddress): string {
    const { model } = this
    return (at.row < 0 ? model.header[at.column] : model.rows[at.row]?.[at.column]) ?? ''
  }
}
