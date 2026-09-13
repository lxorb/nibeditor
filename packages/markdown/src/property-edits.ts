/** What a property row's control writes back into the note.
 *
 *  A reader typing in a date field, ticking a checkbox or taking a tag off a list is
 *  changing their own metadata, and what has to come out the other side is plain
 *  front matter: `tags: [one, two]`, `done: true`, `due: 2026-09-14`. Nothing here
 *  invents a spelling of its own, and nothing here writes a shape `readProperties`
 *  next door could not read back - a row that wrote something the rows cannot read
 *  would turn the whole block into source the moment it was written.
 *
 *  Built on `frontMatterEdit`, which is the one thing in this package that knows how
 *  to change a key without disturbing the rest of the block. A list is the one shape
 *  that edit cannot do on its own, because a list may be several lines and that
 *  function thinks in single-line scalars; a list's own span is what
 *  `readProperties` already reports, so writing one is replacing that span.
 *
 *  Every answer is one `TextEdit`, so one gesture is one thing to undo. Null where
 *  the note already says it, so a control that was pressed and put back writes no
 *  file at all. */

import { oneEdit, type TextEdit } from './edits'
import { frontMatterEdit } from './front-matter'
import { type Property, type PropertyKind, readProperties } from './properties'
import { flowItem, scalar } from './yaml'

/** A list as a note writes one: a flow sequence, which is what Obsidian writes and
 *  what `frontMatterList` reads back. `[]` for a list with nothing in it, because a
 *  key with an empty list is still a fact about the note. */
export function writtenList(items: readonly string[]): string {
  return `[${items.map((one) => flowItem(one)).join(', ')}]`
}

/** How a value is written for each kind of control.
 *
 *  A checkbox and a number mean the bare word and the bare digits: `done: true` is
 *  the thing a checkbox is, and `done: 'true'` would be a note saying its own
 *  checkbox is a piece of text. Everything else goes through `scalar`, which quotes
 *  whatever YAML would read as something other than the words it says - so a title
 *  somebody typed the word `true` into comes back as the word.
 *
 *  A number field that somehow holds something that is not a number falls back to
 *  the same quoting: the file says what was typed, and the row it comes back as is
 *  whatever that reads as. Nothing here writes a value the rows cannot read. */
function written(value: string, kind: PropertyKind): string {
  if (kind === 'checkbox') return value.toLowerCase() === 'true' ? 'true' : 'false'
  if (kind === 'number' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim()
  return scalar(value)
}

/** One edit that sets a top-level key to a scalar, or takes the key away when the
 *  value is null. `kind` is the control the value came out of, which is what decides
 *  whether it is written bare or quoted. */
export function writeProperty(
  source: string,
  key: string,
  value: string | null,
  kind: PropertyKind = 'text',
): TextEdit | null {
  return frontMatterEdit(source, key, value === null ? null : written(value, kind))
}

/** One edit that sets a top-level key to a list.
 *
 *  The property's own span is replaced, which is what makes a list written over
 *  several lines come back as one: `readProperties` reports a key's line through to
 *  the last of its items, so a `- item` list of four lines and a `[a, b]` of one are
 *  the same span to replace.
 *
 *  A key the block does not hold yet is appended the way any other key is. */
export function writeList(source: string, key: string, items: readonly string[]): TextEdit | null {
  const found = readProperties(source)?.find((one) => one.key === key)
  if (!found) return frontMatterEdit(source, key, writtenList(items))

  const after = `${source.slice(0, found.from)}${key}: ${writtenList(items)}${source.slice(found.to)}`
  return oneEdit(source, after)
}

/** The same list with `item` on the end, or unchanged where it is already in it. A
 *  list is a set of names and the same name twice says nothing twice. */
export function withItem(property: Property, item: string): string[] | null {
  const said = item.trim()
  if (!said || property.items.includes(said)) return null
  return [...property.items, said]
}

/** The same list with `item` gone. Null where it was not in it, which is a chip
 *  pressed twice before the document caught up. */
export function withoutItem(property: Property, item: string): string[] | null {
  if (!property.items.includes(item)) return null
  return property.items.filter((one) => one !== item)
}
