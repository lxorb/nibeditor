/** Every setting there is, as a row the palette can find: each switch and choice in
 *  the generated panes, each row of the hand-written ones, and the panes themselves.
 *
 *  Read off the same two lists the settings' own search box reads - `preferences.ts`
 *  and settings/places.ts - so a setting is found by the same words in both, its
 *  choices and its other words included: `dark` finds Mode, `font` the text size. */

import type { Field, Pane } from '../preferences'
import type { Place } from '../settings-search'
import type { Section } from '../settings.svelte'

export interface Setting {
  section: Section
  label: string
  /** The pane it is in, which the row says after its name. */
  where: string
  /** Its other names: its choices and the words it is known by, which find it as
   *  well as its own name does. */
  names: string[]
  /** What else it is found by, for less: its group, the words on a hand-written row. */
  words: string[]
  /** The control, for a generated setting: what the row shows it is set to, and a
   *  switch the row can flip where it is. Null for a hand-written row or a pane. */
  field: Field | null
  /** Whether it is one row of a pane, which the pane scrolls to, rather than the
   *  pane itself. */
  row: boolean
}

/** What a field's choices are called, for finding it by one. */
function choices(field: Field): string[] {
  return field.kind === 'select' || field.kind === 'segmented'
    ? field.options.map((one) => one.label)
    : []
}

/** The rows. `panes` is every pane with a name, in the order the settings list them;
 *  `generated` the ones made of fields; `places` the hand-written ones. */
export function settingsOf(
  panes: readonly { id: Section; label: string }[],
  generated: readonly Pane[],
  places: readonly Place[],
  settingsWord: string,
): Setting[] {
  const nameOf = (id: Section) => panes.find((one) => one.id === id)?.label ?? ''
  const rows: Setting[] = panes.map((one) => ({
    section: one.id,
    label: one.label,
    where: settingsWord,
    names: [],
    words: [],
    field: null,
    row: false,
  }))

  for (const pane of generated) {
    for (const group of pane.groups) {
      for (const field of group.fields) {
        rows.push({
          section: pane.id,
          label: field.label,
          where: pane.label,
          names: [...choices(field), ...(field.words ?? [])],
          words: [group.title].filter(Boolean),
          field,
          row: true,
        })
      }
    }
  }

  for (const place of places) {
    rows.push({
      section: place.section,
      label: place.label,
      where: nameOf(place.section),
      names: [],
      words: place.text.filter(Boolean),
      field: null,
      row: true,
    })
  }

  return rows
}

/** What a setting is set to, the way its row says it: the choice's own name. A
 *  switch says it with a switch and a slider with its number and unit; a line of
 *  text and a row with no control say nothing. */
export function settingValue(field: Field | null): string | null {
  if (!field) return null

  switch (field.kind) {
    case 'select':
    case 'segmented': {
      const held = field.get()
      return field.options.find((one) => one.value === held)?.label ?? null
    }
    case 'slider':
      return `${field.get()}${field.unit ?? ''}`
    case 'switch':
    case 'text':
      return null
  }
}
