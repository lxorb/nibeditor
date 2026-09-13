import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Pane } from './preferences'
import { type Place, search } from './settings-search'

const panes: Pane[] = [
  {
    id: 'general',
    label: 'General',
    groups: [
      {
        title: 'Saving',
        fields: [
          { kind: 'switch', label: 'Save as I type', get: () => true, set: () => undefined },
          {
            kind: 'slider',
            label: 'Wait before saving',
            min: 0,
            max: 10,
            step: 1,
            unit: 'ms',
            get: () => 1,
            set: () => undefined,
          },
        ],
      },
      {
        title: 'Language',
        fields: [
          {
            kind: 'select',
            label: 'Language',
            options: [
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
            ],
            get: () => 'en',
            set: () => undefined,
          },
        ],
      },
      {
        title: 'Appearance',
        fields: [
          {
            kind: 'switch',
            label: 'Strict CommonMark',
            hint: 'Only the standard rules, no tables or footnotes.',
            get: () => false,
            set: () => undefined,
          },
          {
            kind: 'segmented',
            label: 'Mode',
            options: [
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Nocturne' },
            ],
            get: () => 'system',
            set: () => undefined,
          },
        ],
      },
    ],
  },
]

const places: Place[] = [
  { section: 'account', label: 'Storage', text: ['used', 'limit'] },
  { section: 'export', label: 'Export as PDF', text: [] },
]

const labels = (query: string) =>
  search(query, panes, places).map((hit) => (hit.kind === 'field' ? hit.field.label : hit.label))

describe('searching the settings', () => {
  test('finds a field by its own name', () => {
    expect(labels('wait')).toEqual(['Wait before saving'])
  })

  test('finds every field in a group by the group name', () => {
    expect(labels('saving')).toEqual(['Save as I type', 'Wait before saving'])
  })

  test('finds a field by the pane it lives in', () => {
    expect(labels('general')).toHaveLength(5)
  })

  test('finds a dropdown by one of its choices', () => {
    expect(labels('deutsch')).toEqual(['Language'])
  })

  test('finds a slider by its unit', () => {
    expect(labels('ms')).toEqual(['Wait before saving'])
  })

  test('finds a segmented control by one of its choices', () => {
    expect(labels('nocturne')).toEqual(['Mode'])
  })

  /** The sentence behind a setting's `i` is words about that setting, and
   *  somebody looking for footnotes is looking for the switch that turns them
   *  off, whatever the switch is called. */
  test('finds a setting by the sentence that explains it', () => {
    expect(labels('footnotes')).toEqual(['Strict CommonMark'])
  })

  test('finds a place in a hand-written pane by any word on it', () => {
    expect(labels('limit')).toEqual(['Storage'])
    expect(labels('pdf')).toEqual(['Export as PDF'])
  })

  test('ignores case and surrounding space', () => {
    expect(labels('  DEUTSCH ')).toEqual(['Language'])
  })

  test('finds nothing for nothing', () => {
    expect(labels('')).toEqual([])
    expect(labels('   ')).toEqual([])
  })

  test('says which pane a hit belongs to', () => {
    const [hit] = search('pdf', panes, places)
    expect(hit?.kind === 'place' ? hit.section : null).toBe('export')

    const [field] = search('wait', panes, places)
    expect(field?.kind === 'field' ? field.pane.id : null).toBe('general')
  })
})

/** Which of the hand-written panes the search knows about at all.
 *
 *  The list is a component's own derived rather than a module, so what is read here is
 *  the source - the same reading i18n.test.ts does of the tree for the strings the app
 *  asks for. The search itself is held to its answers above; what goes wrong in
 *  practice is a row on a hand-written pane that nothing put in the list, which is a
 *  setting nobody can find by typing its name. */
describe('the hand-written panes the search knows about', () => {
  const source = readFileSync(new URL('./SettingsPanel.svelte', import.meta.url), 'utf8')

  test('name how long the account keeps a note’s history', () => {
    expect(source).toContain("label: t('History on the account')")
    expect(source).toContain("t('Keep versions')")
  })

  test('and the rescue under it, which is the one nobody wants to hunt for', () => {
    expect(source).toContain("label: t('Go back')")
  })
})
