/** Whole keyboards, so hands that learned another app carry over.
 *
 *  A preset holds only the keys that differ from Nib's own, the same shape a
 *  reader's own map has: what a preset does not name is at whatever the app
 *  says today, so a default that improves later reaches everybody rather than
 *  being frozen into four copies of it.
 *
 *  One rule decides the awkward cases, and it is the rule the other app
 *  already follows: the key goes to the action that app uses it for. Where that
 *  takes a key Nib had spent on something the other app has no counterpart for,
 *  the Nib action is left with no key rather than moved to a chord nobody would
 *  guess. It keeps its place in the menus, the palette and the shortcut list,
 *  and its row reads "Not set", which is something a reader can see and change.
 *
 *  Data only. Choosing one is the store next door. */

import type { KeyOverrides } from '@nib/editor'
import { t } from '../i18n.svelte'

/** Custom is not chosen, it is arrived at: the map becomes it the moment one
 *  key is rebound by hand. */
export type PresetId = 'default' | 'notion' | 'obsidian' | 'vim' | 'custom'

export interface Preset {
  id: PresetId
  label: () => string
  /** Differences from Nib's defaults, by shortcut id. Null takes a key away. */
  keys: KeyOverrides
  /** Whether the preset is modal editing as well as a map. */
  vim: boolean
}

/** Obsidian's own keys.
 *
 *  Most of Nib's already are Obsidian's - Ctrl+E for reading, Ctrl+P for the
 *  palette, Ctrl+N, Ctrl+W, Ctrl+Shift+T for the last closed tab,
 *  Ctrl+Tab, Ctrl+K, Ctrl+comma, Ctrl+Shift+F and Ctrl+Shift+V - so what is
 *  written here is only where the two differ.
 *
 *  Nib's palette answers for two of Obsidian's. Typed into, it is the quick
 *  switcher; `>` turns it into the command palette. It stays on Ctrl+P, and
 *  Ctrl+O keeps Open file, which is the same gesture arriving at a note either
 *  way. */
const OBSIDIAN: KeyOverrides = {
  'pane.split-right': 'Mod-\\',
  'pane.split-down': 'Mod-Shift-\\',
  // Ctrl+\ is the split, and Obsidian has nothing that clears formatting.
  'format.clear': null,
  'app.graph': 'Mod-g',
  // Find next keeps F3, which is its second key.
  'edit.find-next': null,
  'edit.follow-link': 'Alt-Enter',
}

// The digits are the change worth knowing about. Obsidian gives Ctrl+1 to
// Ctrl+9 to the notes on the strip, and a hand that reaches for the third note
// and gets a third-level heading has just edited the document by accident. So
// the digits go to the notes; the heading levels are left with no key and stay
// in the Paragraph menu and the palette.
for (let index = 1; index <= 9; index++) OBSIDIAN[`app.note-${index}`] = `Mod-${index}`
for (let level = 1; level <= 6; level++) OBSIDIAN[`paragraph.heading-${level}`] = null
// The plane's Ctrl+1 goes the same way, and for a sharper reason: it is read off
// the plane itself and the press goes on to the window afterwards, so leaving it
// there would zoom to what is picked and switch note from one key. Obsidian's digits
// are 1 to 9, and the plane's Fit is on Ctrl+Alt+0 for the same reason, so neither of
// those is in anybody's way.
OBSIDIAN['canvas.frame'] = null

/** Notion's own keys.
 *
 *  Notion writes its number shortcuts as Ctrl+Shift on Windows and Linux and
 *  Cmd+Option on a Mac; one map covers both, since `Mod` is already whichever
 *  of the two this machine uses. Ctrl+Shift+7 and 9 are a toggle list and a
 *  sub-page, neither of which Nib has, and are left alone.
 *
 *  Two of Notion's keys land on something of Nib's own: Ctrl+E is inline code
 *  there and the reading view here, and Ctrl+backslash is the sidebar there and
 *  clear formatting here. Notion's action takes the key and Nib's is left without
 *  one.
 *
 *  Nib's own digits are all on Ctrl+Alt, and its panels are on letters, so
 *  Notion's block types have the whole Ctrl+Shift row to themselves. */
const NOTION: KeyOverrides = {
  'app.sidebar': 'Mod-\\',
  'format.clear': null,
  'format.code': 'Mod-e',
  'app.reading': null,
  'format.strikethrough': 'Mod-Shift-s',
  // Notion's own is Ctrl+Shift+0, and that is the one key of theirs this cannot take:
  // on AZERTY the nought is the shifted character, so Ctrl+Shift+0 is Ctrl+0 there as
  // well, and Ctrl+0 is the text size. So Paragraph keeps Nib's own letter.
  'paragraph.heading-1': 'Mod-Shift-1',
  'paragraph.heading-2': 'Mod-Shift-2',
  'paragraph.heading-3': 'Mod-Shift-3',
  // Notion's fourth digit is a to-do, which Nib does have.
  'paragraph.task-list': 'Mod-Shift-4',
  'paragraph.bullet-list': 'Mod-Shift-5',
  'paragraph.ordered-list': 'Mod-Shift-6',
  'paragraph.code-block': 'Mod-Shift-8',
}

/** Every keyboard there is to choose from, in the order the select shows them.
 *
 *  Vim is Nib's own map with modal editing on top of it: what a Vim reader
 *  wants back is the modes, not somebody else's Ctrl chords, and every one of
 *  those chords goes on working in every mode. See packages/editor/src/vim.ts. */
export const PRESETS: Preset[] = [
  { id: 'default', label: () => t('Default'), keys: {}, vim: false },
  // Three names of three programs, which is what they are called in every
  // language. Only Default is a word, so only Default is translated.
  { id: 'notion', label: () => 'Notion', keys: NOTION, vim: false },
  { id: 'obsidian', label: () => 'Obsidian', keys: OBSIDIAN, vim: false },
  { id: 'vim', label: () => 'Vim', keys: {}, vim: true },
]

export const presetById = (id: string): Preset | undefined => PRESETS.find((one) => one.id === id)

/** What a name written down here or carried by the account means.
 *
 *  Nothing at all is no opinion, and the machine keeps what it had. A name
 *  this version has never heard of - a preset a newer app added - is a map
 *  this one cannot put a name to, which is what Custom is for. */
export function knownPreset(value: unknown): PresetId | null {
  if (typeof value !== 'string' || !value) return null
  if (value === 'custom' || presetById(value)) return value as PresetId

  return 'custom'
}
