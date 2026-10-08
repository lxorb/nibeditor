/** Whole keyboards, so hands that learned another app carry over.
 *
 *  A preset holds only the keys that differ from Nib's own, the same shape a
 *  reader's own map has: what a preset does not name is at whatever the app
 *  says today, so a default that improves later reaches everybody rather than
 *  being frozen into five copies of it.
 *
 *  One rule decides the awkward cases, and it is the rule the other app
 *  already follows: the key goes to the action that app uses it for. Where that
 *  takes a key Nib had spent on something the other app has no counterpart for,
 *  the Nib action is left with no key rather than moved to a chord nobody would
 *  guess. It keeps its place in the menus, the palette and the shortcut list,
 *  and its row reads "Not set", which is something a reader can see and change.
 *
 *  Data only, and not in front of the first paint: the Settings sheet is the one
 *  place a keyboard is chosen, and it hands the one it chose to the store next door.
 *  What the launch reads is the name alone; see preset-ids.ts. */

import type { KeyOverrides } from '@nib/editor'
import { t } from '../i18n.svelte'
import type { PresetId } from './preset-ids'

export interface Preset {
  id: Exclude<PresetId, 'custom'>
  label: () => string
  /** Differences from Nib's defaults, by shortcut id. Null takes a key away. */
  keys: KeyOverrides
  /** Whether the preset is modal editing as well as a map. */
  vim: boolean
}

/** Obsidian's own keys.
 *
 *  Most of Nib's already are Obsidian's - Ctrl+E for reading, Ctrl+W,
 *  Ctrl+Shift+T for the last closed tab, Ctrl+Tab, Ctrl+K, Ctrl+comma,
 *  Ctrl+Shift+F and Ctrl+Shift+V - so what is written here is only where the two
 *  differ.
 *
 *  Nib's palette is both of Obsidian's, and here it answers on both of their keys:
 *  Ctrl+O opens it, which is the quick switcher, and Ctrl+P narrows it to the
 *  commands, which is the command palette. Double Shift stays its first key and
 *  Ctrl+Shift+P the commands as well, where every editor has them. Ctrl+O is the
 *  palette's second key here rather than its third, so a Mac's menu names it; see
 *  `chordFor` in native-menu.ts. */
const OBSIDIAN: KeyOverrides = {
  'app.palette.alt': 'Mod-o',
  'app.palette.open': null,
  'app.commands.alt': 'Mod-p',
  // Obsidian has no key that prints.
  'app.print': null,
  'pane.split-right': 'Mod-\\',
  'pane.split-down': 'Mod-Shift-\\',
  // Ctrl+\ is the split, and Obsidian has nothing that clears formatting.
  'format.clear': null,
  'app.graph': 'Mod-g',
  // Find next keeps F3, which is its second key.
  'edit.find-next': null,
  'edit.follow-link': 'Alt-Enter',
  // Back and forward on Obsidian's Ctrl+Alt and an arrow, which the split held here
  // and gave up for Ctrl+\ above.
  'app.back': 'Mod-Alt-ArrowLeft',
  'app.forward': 'Mod-Alt-ArrowRight',
  // Obsidian's Ctrl+D deletes the paragraph, which in a markdown file is the line.
  // Deselect tab, which holds it in Nib, has no counterpart there.
  'edit.delete-line': 'Mod-d',
  'app.deselect-tab': null,
  // Ctrl+] indents and Ctrl+[ outdents, the way round Obsidian and VS Code have it.
  // Nib's own order is Typora's; see `edit.indent` in @nib/editor's keymap.
  'edit.indent': 'Mod-]',
  'edit.outdent': 'Mod-[',
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
 *  Three of Notion's keys land on something of Nib's own: Ctrl+E is inline code
 *  there and the reading view here, Ctrl+backslash is the sidebar there and clear
 *  formatting here, and Ctrl+P is the search there and Print here. Notion's action
 *  takes the key and Nib's is left without one. Ctrl+Shift+S, strikethrough there,
 *  is free here.
 *
 *  Nib's own digits are all on Ctrl+Alt, and its panels are on letters, so
 *  Notion's block types have the whole Ctrl+Shift row to themselves. */
const NOTION: KeyOverrides = {
  // Notion's search, which is this palette on the notes, and so not Print.
  'app.palette.alt': 'Mod-p',
  'app.print': null,
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
  // The block the caret is in, as the grip's own Duplicate and Move rows. Deselect tab,
  // which holds Ctrl+D in Nib, has no counterpart in Notion. On a Mac the move is
  // Cmd+Shift and an arrow, which takes selecting to either end of the note away, the
  // way Notion does itself.
  'edit.duplicate-block': 'Mod-d',
  'app.deselect-tab': null,
  'edit.move-block-up': 'Mod-Shift-ArrowUp',
  'edit.move-block-down': 'Mod-Shift-ArrowDown',
}

/** VS Code's own keys.
 *
 *  Nib already has most of them: Ctrl+Shift+P, Ctrl+L for the line, Alt and Shift+Alt
 *  with Up and Down for moving and copying lines, Ctrl+Shift+Enter for a line above,
 *  Shift+Alt+Right and Left for the selection outwards and back, Ctrl+Shift+E for the
 *  files, Ctrl+Shift+F, Ctrl+H and F3. What is here is where they part.
 *
 *  Ctrl+B is the one key of VS Code's that stays where it is. There it shows and
 *  hides the sidebar; in a note it is Bold, which is what the markdown extensions
 *  for VS Code put on it as well, and a writing app with no key for bold is broken.
 *  So the sidebar is left without a key of its own, and a code editor's hand has
 *  Ctrl+Shift+E, VS Code's key for the files, which opens them and gives the note
 *  the keyboard back on the second press. */
const VSCODE: KeyOverrides = {
  // Ctrl+P is the palette's first key here, so it is the one a menu row shows, and
  // double Shift the second: the hand that learned VS Code looks for Ctrl+P.
  'app.palette': 'Mod-p',
  'app.palette.alt': 'Shift Shift',
  // VS Code prints nothing on Ctrl+P, or anywhere else.
  'app.print': null,
  // Ctrl+G on every platform, which is VS Code's on a Mac as well, rather than Cmd+G.
  // Find next keeps F3, its second key and VS Code's own.
  'edit.goto-line': 'Ctrl-g',
  'edit.find-next': null,
  // Ctrl+D selects the word and then the next one like it, which is what every hand
  // from VS Code presses it for; Deselect tab, which holds it in Nib, has none here.
  'edit.select-word': 'Mod-d',
  'app.deselect-tab': null,
  // Ctrl+Shift+K deletes the line. It was Code block, which VS Code has no key for.
  'edit.delete-line': 'Mod-Shift-k',
  'paragraph.code-block': null,
  // Ctrl+Shift+L selects every one like it, and the sidebar gives it up; see above.
  'edit.select-all-occurrences': 'Mod-Shift-l',
  'app.sidebar': null,
  // Ctrl+\ splits the pane to the right, and VS Code has nothing that clears formatting.
  'pane.split-right': 'Mod-\\',
  'format.clear': null,
  // Ctrl+] indents and Ctrl+[ outdents. Nib's own order is Typora's, the other way
  // round; see `edit.indent` in @nib/editor's keymap.
  'edit.indent': 'Mod-]',
  'edit.outdent': 'Mod-[',
}

/** Every keyboard there is to choose from, in the order the select shows them,
 *  which is PRESET_IDS' order.
 *
 *  Vim is Nib's own map with modal editing on top of it: what a Vim reader
 *  wants back is the modes, not somebody else's Ctrl chords, and every one of
 *  those chords goes on working in every mode. See packages/editor/src/vim.ts. */
export const PRESETS: Preset[] = [
  { id: 'default', label: () => t('Default'), keys: {}, vim: false },
  // Four names of four programs, which is what they are called in every
  // language. Only Default is a word, so only Default is translated.
  { id: 'notion', label: () => 'Notion', keys: NOTION, vim: false },
  { id: 'obsidian', label: () => 'Obsidian', keys: OBSIDIAN, vim: false },
  { id: 'vscode', label: () => 'VS Code', keys: VSCODE, vim: false },
  { id: 'vim', label: () => 'Vim', keys: {}, vim: true },
]

export const presetById = (id: string): Preset | undefined => PRESETS.find((one) => one.id === id)
