import type { Field, Group, Pane } from './preferences'
import type { Section } from './settings.svelte'

/** Something a hand-written pane shows - a storage meter, an export button -
 *  that search should be able to land on. `label` is what the hit is called;
 *  `text` is every other word on it worth matching. */
export interface Place {
  section: Section
  label: string
  text: string[]
}

export type Hit =
  | { kind: 'field'; section: Section; pane: Pane; group: Group; field: Field }
  | { kind: 'place'; section: Section; label: string }

/** Nobody remembers which pane holds a setting, and often not its exact name
 *  either - only a word that is somewhere on it. So every word counts: the
 *  field's own label, the group and pane it sits in, the choices a dropdown
 *  offers, a slider's unit. Plain substring, case aside: a settings search
 *  is looked up by a word, not by initials. */
export function search(query: string, panes: Pane[], places: Place[]): Hit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const has = (text: string) => text.toLowerCase().includes(needle)
  const hits: Hit[] = []

  for (const pane of panes) {
    for (const group of pane.groups) {
      for (const field of group.fields) {
        if (words(field, group, pane).some(has)) {
          hits.push({ kind: 'field', section: pane.id, pane, group, field })
        }
      }
    }
  }

  for (const place of places) {
    if ([place.label, ...place.text].some(has)) {
      hits.push({ kind: 'place', section: place.section, label: place.label })
    }
  }

  return hits
}

function words(field: Field, group: Group, pane: Pane): string[] {
  const own =
    field.kind === 'select' || field.kind === 'segmented'
      ? field.options.map((option) => option.label)
      : field.kind === 'slider' && field.unit
        ? [field.unit]
        : []

  // The sentence behind a setting's `i` is words about it, and somebody looking
  // for "footnotes" is looking for the switch that turns them off.
  return [
    field.label,
    group.title,
    pane.label,
    ...(field.hint ? [field.hint] : []),
    ...own,
    ...(field.words ?? []),
  ]
}
