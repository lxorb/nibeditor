/** A note's front matter, read as the handful of things it usually says.
 *
 *  The block is YAML, and nothing here is a YAML parser. What it reads is what a
 *  note written by hand, by nib or by Obsidian actually holds: a top-level key on
 *  a line, and after the colon a word, a number, a date, a yes or no, a list
 *  written either of the two ways, or the pairs of a small map - which is the
 *  shape nib's own `export:` page setup uses.
 *
 *  The rule for everything else is the important one: **if any line of the block
 *  is a shape this does not know, the whole block is left as source.** Not a
 *  table with one row missing, and not a row saying it could not read itself - a
 *  half-drawn table is a table that lies about what is in the file. Somebody
 *  whose front matter holds a Dataview query gets their YAML, which is always
 *  right, and everybody else gets rows.
 *
 *  Nothing here writes. What a row's control writes back is property-edits.ts next
 *  door, which is built on `frontMatterEdit` so that whatever a control does to a
 *  note, the note stays plain front matter that every other reader can read. */

import { frontMatterBlock } from './front-matter'
import { escape } from './html'
import { flowItems, listItem, unquoted } from './yaml'

/** What a surface does with a note's front matter. Three answers, and every
 *  surface that shows a whole note reads the same one, so a reader who asked for
 *  the YAML gets the YAML in the pane and a reader who asked for nothing gets
 *  nothing in either.
 *
 *  `properties` draws the rows, which is where a value is changed in the control
 *  its shape asks for. `source` draws the block as it was typed, which is what
 *  somebody with a Dataview query in their metadata wants all the time rather than
 *  only while the caret is in it. `hidden` draws neither: the metadata is still in
 *  the file and still read, it is simply not on the page. Obsidian asks the same
 *  question with the same three answers. */
export type PropertiesMode = 'properties' | 'source' | 'hidden'

/** The three, in the order they are offered, which is most shown to least. */
export const PROPERTIES_MODES: readonly PropertiesMode[] = ['properties', 'source', 'hidden']

/** The mode a saved or shared answer names, or the rows for anything else. */
export function propertiesMode(value: unknown): PropertiesMode {
  return PROPERTIES_MODES.find((one) => one === value) ?? 'properties'
}

/** What a value looks like it is, which decides what it is drawn as. */
export type PropertyKind = 'text' | 'list' | 'number' | 'date' | 'checkbox' | 'map'

export interface Property {
  key: string
  kind: PropertyKind
  /** The value as written, quotes off. Empty for a list, and for a key with
   *  nothing after its colon. */
  value: string
  /** A list's items. Empty for everything else. */
  items: string[]
  /** Where the key's own line sits in the note, so a click can put the caret on
   *  it rather than somewhere near it. */
  from: number
  to: number
}

/** A top-level `key:`. Indented lines belong to the key above them, and a line
 *  that is only a value is part of a list. */
const KEY = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/

/** A `key: value` line indented under another key: the shape `export:` uses to
 *  say what paper a note prints on. */
const NESTED = /^[ \t]+([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/

/** `true` and `false`, which is how Obsidian writes a checkbox. YAML 1.1 also
 *  reads `yes` and `no` as booleans, and this deliberately does not: a note whose
 *  `status: no` became a cleared checkbox would be a note lied to about itself. */
const YES_NO = /^(true|false)$/i

/** A number, as YAML writes one. */
const NUMBER = /^-?\d+(?:\.\d+)?$/

/** A date, and a date with a time after it. Not a full ISO parse: what this has
 *  to tell apart is a date from a word, and `2025-09-08` is not a word. */
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/

/** Well past any note's metadata, and a ceiling so a file that opens with a
 *  thousand lines between two fences is left as the source it is. */
const MOST_KEYS = 64

/** What a value on the line is. */
function kindOf(value: string): PropertyKind {
  if (YES_NO.test(value)) return 'checkbox'
  if (NUMBER.test(value)) return 'number'
  if (DATE.test(value)) return 'date'
  return 'text'
}

/** Every line of the block, with where each one sits. */
function linesOf(
  source: string,
  from: number,
  to: number,
): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = []
  let at = from

  while (at < to) {
    const end = source.indexOf('\n', at)
    const stop = end === -1 || end > to ? to : end
    out.push({ text: source.slice(at, stop).replace(/\r$/, ''), from: at, to: stop })
    if (end === -1) break
    at = end + 1
  }

  return out
}

/** The note's front matter as rows, or null when there is none to read - either
 *  because the note has no block, or because the block says something this
 *  cannot draw without guessing. Both answers mean the same thing to a caller:
 *  show the source. */
export function readProperties(source: string): Property[] | null {
  const block = frontMatterBlock(source)
  if (!block) return null

  const lines = linesOf(source, block.body.from, block.body.to)
  const out: Property[] = []

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (!line || line.text.trim() === '') continue

    // A comment is not a row, and a block that carries one is a block somebody
    // is keeping notes in. Left as source rather than silently dropped.
    if (line.text.trimStart().startsWith('#')) return null

    const found = KEY.exec(line.text)
    if (!found) return null

    // Asked before the row is made rather than after, so that every shape of row
    // is counted. Asked at the end it only ever caught the last of the three,
    // and a block of a thousand `tags: [a]` lines drew a thousand rows.
    if (out.length >= MOST_KEYS) return null

    const key = found[1] ?? ''
    const written = (found[2] ?? '').trim()
    const listed = flowItems(written)

    if (listed !== null) {
      out.push({ key, kind: 'list', value: '', items: listed, from: line.from, to: line.to })
      continue
    }

    if (written) {
      const value = unquoted(written)
      out.push({ key, kind: kindOf(value), value, items: [], from: line.from, to: line.to })
      continue
    }

    // Nothing after the colon: what is indented under it. Either `- item` lines,
    // which are a list, or `key: value` lines, which are a map - `export:` with
    // a paper size under it is nib's own, and a note that uses it should still
    // get rows. Anything else indented is a shape nobody here can name, and the
    // block goes back to being source.
    const items: string[] = []
    let mapped = false
    let last = line.to

    while (at + 1 < lines.length) {
      const next = lines[at + 1]
      if (!next) break
      if (next.text.trim() === '') break

      const item = listItem(next.text)
      // What belongs to the key above is indented under it - except a list,
      // which YAML lets sit at the key's own margin. Read by the same helper
      // `frontMatterList` uses, so the rows and the values agree about that.
      const indented = next.text.startsWith(' ') || next.text.startsWith('\t')
      if (item === null && !indented) break

      const pair = item === null ? NESTED.exec(next.text) : null
      if (item === null && !pair) return null
      // One or the other, never both: a key with a list and a map under it is
      // not something YAML means either.
      if (item !== null && mapped) return null
      if (pair && items.length && !mapped) return null

      if (item !== null) items.push(item)
      else {
        mapped = true
        items.push(`${pair?.[1] ?? ''}: ${unquoted(pair?.[2] ?? '')}`.trim())
      }

      last = next.to
      at++
    }

    out.push({
      key,
      kind: mapped ? 'map' : items.length ? 'list' : 'text',
      value: '',
      items,
      from: line.from,
      to: last,
    })
  }

  return out
}

/** The rows as markup, for the editor's block and for the reading view, so the
 *  two are one drawing rather than two that look alike.
 *
 *  Every row carries where its line sits, which is what lets a click in the
 *  editor put the caret on the line the row was drawn from. */
export function propertiesTable(properties: readonly Property[]): string {
  const rows = properties.map((one) => row(one)).join('')
  return `<div class="properties" role="table">${rows}</div>`
}

function row(property: Property): string {
  return (
    `<div class="property nib-row is-short" role="row"` +
    ` data-key="${escape(property.key)}" data-from="${property.from}" data-to="${property.to}">` +
    `<span class="property-key nib-row-label" role="rowheader">${escape(property.key)}</span>` +
    `<span class="property-value" role="cell">${value(property)}</span>` +
    `</div>`
  )
}

/** The block as it was typed, for a reader who asked for the source and for a block
 *  whose shape the rows cannot read. Empty where the note has no block at all.
 *
 *  A `<pre>` of the characters: the point of asking for the source is that it is the
 *  file, so nothing here reflows it, colours it or sorts it. Escaped, because a note
 *  whose metadata holds a `<script>` is a note like any other. */
export function propertiesSource(source: string): string {
  const block = frontMatterBlock(source)
  if (!block) return ''

  return `<pre class="properties-source">${escape(source.slice(block.body.from, block.body.to))}</pre>`
}

function value(property: Property): string {
  if (property.kind === 'list' || property.kind === 'map') {
    // A list of nothing still says the key is there and empty, which is a fact
    // about the note rather than a gap.
    return property.items.map((one) => `<span class="property-chip">${escape(one)}</span>`).join('')
  }

  if (property.kind === 'checkbox') {
    const on = property.value.toLowerCase() === 'true'
    return `<span class="property-check${on ? ' is-on' : ''}" role="img" aria-label="${on ? 'true' : 'false'}"></span>`
  }

  if (property.value === '') return '<span class="property-empty"></span>'

  return `<span class="property-said" data-kind="${property.kind}">${escape(property.value)}</span>`
}
