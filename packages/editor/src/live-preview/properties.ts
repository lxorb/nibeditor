/** A note's front matter, drawn as the rows it says rather than as the YAML it
 *  is written in - and edited in them.
 *
 *  Each row's value is the control its shape asks for: a field for a word, a number
 *  field for a number, a date picker for a date, a real checkbox for a `true`, chips
 *  with an `x` each and a field to add one for a list, and a menu where the key is
 *  one the app has a fixed set of answers for. What every one of them writes is
 *  plain front matter - `tags: [one, two]`, `done: true`, `due: 2026-09-14` - through
 *  property-edits.ts in @nib/markdown, which is built on `frontMatterEdit`. So the
 *  file stays a file every other reader can read, and nothing here can write a shape
 *  the rows could not read back.
 *
 *  The source is still one caret away, and that has not changed: clicking a row's
 *  key puts the caret on that row's own line, and the whole block gives way to the
 *  YAML it is written in. What has changed is that somebody who only wants to tick a
 *  box no longer has to go through the YAML to do it. The reader who wants the source
 *  all the time, or none of it, says so once in Settings; see `propertiesMode` in
 *  blocks.ts and properties.ts in @nib/markdown.
 *
 *  One document change per gesture, on the change rather than per keystroke for a
 *  field, so a value typed into a row is one thing to undo. A block holding a shape
 *  @nib/markdown cannot read stays source, whole; see properties.ts there. */

import { EditorSelection, Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { type Property, propertiesTable, readProperties } from '@nib/markdown/properties'
import { withItem, withoutItem, writeList, writeProperty } from '@nib/markdown/property-edits'
import { label } from '../labels'
import { applied, clearOfBlock } from './front-matter'
import { pressedByKey } from '../press'
import { NibWidget } from './widget'

/** The keys the app knows a fixed set of answers for, so a row offers a menu rather
 *  than a field somebody has to spell something into.
 *
 *  Supplied by the host, because which answers are fixed is the app's business and
 *  not the editor's: the accent names, the paper sizes. An empty map is every key
 *  being anybody's to write, which is what the editor on its own says. */
export const propertyChoices = Facet.define<
  Record<string, readonly string[]>,
  Record<string, readonly string[]>
>({ combine: (values) => values[0] ?? {} })

export class PropertiesWidget extends NibWidget {
  constructor(private readonly source: string) {
    super()
  }

  override eq(other: PropertiesWidget) {
    return other.source === this.source
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div')
    host.className = 'nib-properties'

    const properties = readProperties(this.source)
    if (properties === null) return host

    // The renderer's own markup, out of escaped text; see properties.ts in
    // @nib/markdown. The reading view draws the same rows from the same string, and
    // the controls below are put into the cells it left.
    host.innerHTML = propertiesTable(properties)

    // The block sits at the top of the note, so the offsets the rows carry are
    // the offsets in the document.
    host.addEventListener('mousedown', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      // A press inside a control belongs to the control; the key and the space
      // beside it are the way back to the source.
      if (target.closest('.property-value')) return

      const row = target.closest('.property')
      if (!(row instanceof HTMLElement)) return

      const at = Number(row.dataset.from)
      if (!Number.isFinite(at)) return

      event.preventDefault()
      // At the end of the key's own line, which is where somebody who clicked a
      // row wants to be: after the value, ready to change it.
      const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length))
      view.dispatch({ selection: EditorSelection.cursor(line.to), scrollIntoView: true })
      view.focus()
    })

    const choices = view.state.facet(propertyChoices)
    for (const [at, row] of [...host.querySelectorAll('.property')].entries()) {
      const property = properties[at]
      const cell = row.querySelector('.property-value')
      if (!property || !(cell instanceof HTMLElement)) continue
      control(view, property, cell, choices[property.key] ?? null)
    }

    host.append(adder(view, properties.length))
    return host
  }

  /** The rows are the widget's own: it runs the controls in them and puts the caret
   *  where a click on a key asked. */
  override ignoreEvent() {
    return true
  }
}

/** Writes one property and answers whether anything changed, so a control that was
 *  put back where it was costs no undo step. */
function write(view: EditorView, property: Property, value: string | null): boolean {
  if (view.state.readOnly) return false

  const source = view.state.doc.toString()
  const edit = writeProperty(source, property.key, value, property.kind)
  if (!edit) return false

  const keep = clearOfBlock(view, applied(source, edit))
  view.dispatch({
    changes: edit,
    ...(keep ? { selection: keep } : {}),
    userEvent: 'input.property',
  })
  return true
}

function writeItems(view: EditorView, key: string, items: readonly string[] | null): boolean {
  if (view.state.readOnly || items === null) return false

  const source = view.state.doc.toString()
  const edit = writeList(source, key, items)
  if (!edit) return false

  const keep = clearOfBlock(view, applied(source, edit))
  view.dispatch({
    changes: edit,
    ...(keep ? { selection: keep } : {}),
    userEvent: 'input.property',
  })
  return true
}

/** The control a row's value is edited in, put into the cell the renderer drew.
 *
 *  The drawn value is replaced rather than decorated, so a row is the control and not
 *  a control beside a copy of the same words. Read-only leaves the cell exactly as
 *  the renderer left it: a note nobody may write is a note nobody may write. */
function control(
  view: EditorView,
  property: Property,
  cell: HTMLElement,
  choices: readonly string[] | null,
) {
  if (view.state.readOnly) return

  if (property.kind === 'list') {
    cell.replaceChildren(...chips(view, property), adderField(view, property))
    return
  }

  // A map is nib's own `export:` page setup, whose pairs are two keys deep. Left as
  // the chips it is drawn as: what a nested key means is the surface's business that
  // wrote it, and a control that guessed would write a shape the rows cannot read.
  if (property.kind === 'map') return

  cell.replaceChildren(choices ? menu(view, property, choices) : field(view, property))
}

/** A list's items, each with the `x` that takes it off. */
function chips(view: EditorView, property: Property): HTMLElement[] {
  return property.items.map((item) => {
    const chip = document.createElement('span')
    chip.className = 'property-chip'
    chip.textContent = item

    const off = document.createElement('button')
    off.type = 'button'
    off.className = 'property-chip-off'
    off.title = label('removeFromList')
    off.setAttribute('aria-label', label('removeFromList'))
    off.textContent = '×'

    const take = () => writeItems(view, property.key, withoutItem(property, item))
    off.addEventListener('mousedown', (event) => {
      event.preventDefault()
      take()
    })
    pressedByKey(off, take)

    chip.append(off)
    return chip
  })
}

/** The field at the end of a list that adds another item. Written on Enter and on
 *  leaving it, which is the two ways somebody finishes typing a tag. */
function adderField(view: EditorView, property: Property): HTMLElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'property-add'
  input.placeholder = label('addToList')
  input.setAttribute('aria-label', label('addToList'))

  const add = () => {
    const said = input.value
    input.value = ''
    if (writeItems(view, property.key, withItem(property, said))) view.focus()
  }

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    add()
  })
  input.addEventListener('blur', add)

  return input
}

/** The field, the number field, the date picker or the checkbox a value's own shape
 *  asks for. One element either way, so the row stays a row. */
function field(view: EditorView, property: Property): HTMLElement {
  if (property.kind === 'checkbox') {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'property-box nib-checkbox'
    box.checked = property.value.toLowerCase() === 'true'
    box.setAttribute('aria-label', property.key)

    box.addEventListener('change', () => {
      write(view, property, box.checked ? 'true' : 'false')
    })

    return box
  }

  const input = document.createElement('input')
  input.className = 'property-field'
  input.value = property.value
  input.setAttribute('aria-label', property.key)

  // A date picker for a date, and the browser's own: it knows the reader's calendar,
  // their week's first day and their language, none of which is worth writing again.
  // `datetime-local` where the value carries a time, since a date field would drop it.
  if (property.kind === 'date') input.type = property.value.length > 10 ? 'datetime-local' : 'date'
  else if (property.kind === 'number') input.type = 'number'
  else input.type = 'text'

  if (input.type === 'datetime-local') input.value = property.value.replace(' ', 'T')

  // On change rather than on every keystroke: a value typed into a row is one thing
  // to undo, and a document rewritten per letter would move the caret out of the
  // field it is being typed in.
  input.addEventListener('change', () => {
    const said = input.type === 'datetime-local' ? input.value.replace('T', ' ') : input.value
    write(view, property, said === '' ? null : said)
  })

  return input
}

/** A menu, where the key is one the app has a fixed set of answers for. The value
 *  the note already carries is offered too even where it is not one of them: a note
 *  that says something this build has not heard of is not corrected by being looked
 *  at. */
function menu(view: EditorView, property: Property, choices: readonly string[]): HTMLElement {
  const select = document.createElement('select')
  select.className = 'property-menu'
  select.setAttribute('aria-label', property.key)

  const said = property.value
  for (const one of choices.includes(said) || said === '' ? choices : [said, ...choices]) {
    const option = document.createElement('option')
    option.value = one
    option.textContent = one
    select.append(option)
  }

  select.value = said
  select.addEventListener('change', () => {
    write(view, property, select.value === '' ? null : select.value)
  })

  return select
}

/** The one affordance the block adds: a new key, on a line of its own, with the
 *  caret on it. A row rather than a plus in a corner, so it is where the next row
 *  would go and reads as the empty line at the end of a list. */
function adder(view: EditorView, count: number): HTMLElement {
  const button = document.createElement('button')
  button.className = 'nib-property-add nib-row is-short'
  button.type = 'button'
  button.textContent = label('addProperty')

  const add = () => addProperty(view, count)
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    add()
  })
  pressedByKey(button, add)

  return button
}

/** Writes an empty key in front of the closing fence and puts the caret on it.
 *
 *  In front of the fence rather than after the last row read, because a block
 *  may hold blank lines the rows do not: the fence is the one place a new key is
 *  certainly still inside the block. */
function addProperty(view: EditorView, count: number): void {
  const doc = view.state.doc
  const close = closingFence(view)
  if (close === null) return

  const line = doc.line(close)
  const insert = `${label('property')}${count + 1}: \n`

  view.dispatch({
    changes: { from: line.from, insert },
    selection: EditorSelection.cursor(line.from + insert.length - 1),
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** Which line the block's closing `---` is on, or null when the note has no
 *  block. Read from the text: a widget is drawn from a string and the tree it
 *  came from is not in hand. */
function closingFence(view: EditorView): number | null {
  const doc = view.state.doc
  if (doc.line(1).text.trim() !== '---') return null

  for (let number = 2; number <= doc.lines; number++) {
    if (doc.line(number).text.trim() === '---') return number
  }

  return null
}
