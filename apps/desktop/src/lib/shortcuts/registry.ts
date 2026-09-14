/** Every shortcut the app has, and what each is called.
 *
 *  A list rather than a scattering of keymaps: a key nobody can find in the
 *  settings is a key nobody can change, and this is what makes finding one
 *  possible. Half of it comes from the editor package, which declares its own
 *  bindings with stable ids; the words for those live here, where the
 *  dictionaries are, and shortcuts.test.ts fails if either half grows without
 *  the other.
 *
 *  Data only. What a reader has chosen instead, and what happens when a key is
 *  pressed, is the store next door. */

import {
  type BindingSpec,
  type EditorView,
  imageBindings,
  nibBindings,
  standardBindings,
  tableBindings,
} from '@nib/editor'
import { type ExportId, EXPORT_KEYS, labelOf } from '../export/offer'
import { chooseNewKind, openSpaces, revealPanel, stepRegionFocus } from '../focus'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { openFile } from '../open-file'
import { settings } from '../settings.svelte'
// The space actions are already in the first chunk, since the sidebar and the app
// menu both reach them, so this costs nothing to load early.
import { stepSpace } from '../space-actions'
import { present } from '../slides/present.svelte'
import { invoke } from '../tauri'
import type { Platform } from '../keys'
import { workspace } from '../workspace.svelte'

/** Where an entry sits in the list. The first five are the app's own menus,
 *  so a reader looking for Bold looks under Format either way. */
export type Category =
  | 'file'
  | 'edit'
  | 'format'
  | 'paragraph'
  | 'view'
  | 'panel'
  | 'canvas'
  | 'pages'
  | 'table'
  | 'picture'
  | 'fixed'

export const CATEGORIES: { id: Category; label: () => string }[] = [
  { id: 'file', label: () => t('File') },
  { id: 'edit', label: () => t('Edit') },
  { id: 'format', label: () => t('Format') },
  { id: 'paragraph', label: () => t('Paragraph') },
  { id: 'view', label: () => t('View') },
  { id: 'panel', label: () => t('File list') },
  { id: 'canvas', label: () => t('Canvas') },
  { id: 'pages', label: () => t('Pages') },
  { id: 'table', label: () => t('Tables') },
  { id: 'picture', label: () => t('Pictures') },
  { id: 'fixed', label: () => t('Fixed keys') },
]

/** What an app-level shortcut needs that only the running app has: the view
 *  on screen, and the two things that live in App.svelte's own state. */
export interface AppContext {
  view?: EditorView | undefined
  /** Opens the palette. `'commands'` opens it on the commands rather than on the
   *  notes, which is the `>` in the field and nothing else: one palette with two
   *  ways in, so the field is what says which of the two it is showing and
   *  deleting the `>` is the way back. */
  palette(mode?: 'commands'): void
  fullscreen(): void
}

/** One shortcut, whole: what it is called, where it belongs, which key it
 *  starts on, and how it runs.
 *
 *  `scope` is the difference that matters for conflicts. An `app` binding is
 *  read off the window and fires wherever the focus is, so it shadows an
 *  `editor` binding on the same key rather than sharing it. A `panel` one is
 *  read inside the file list and only while the focus is in it. A `fixed` one
 *  cannot be changed at all and is here to be seen: a key that is spoken for
 *  and a reason why, rather than a gap in the list. */
export interface Shortcut {
  id: string
  label: () => string
  category: Category
  scope: 'app' | 'editor' | 'panel' | 'fixed'
  key: string | null
  /** Absent where the platform has nothing of its own to say, which is how the
   *  editor's own specs read - and `defaultKeyFor` tells absent from null. */
  mac?: string | null
  win?: string | null
  linux?: string | null
  /** Gives way when what it is looking for is not there, so it can share a
   *  key without being in anyone's way. See BindingSpec in the editor. */
  contextual?: boolean
  /** A second key for a command that already has one. */
  alias?: boolean
  /** Why it cannot be changed. Present only on the fixed ones. */
  why?: () => string
  run?: (context: AppContext) => void
}

/** The other half of every binding the editor package declares: what it is
 *  called, and which group of the list it belongs to. The keys and the
 *  commands live over there; the words live here, where the dictionaries
 *  are. An id in one and not the other fails shortcuts.test.ts. */
const EDITOR_ENTRIES: Record<string, [Category, () => string]> = {
  'format.bold': ['format', () => t('Bold')],
  'format.italic': ['format', () => t('Italic')],
  'format.underline': ['format', () => t('Underline')],
  'format.code': ['format', () => t('Code')],
  'format.strikethrough': ['format', () => t('Strikethrough')],
  'format.highlight': ['format', () => t('Highlight')],
  'format.link': ['format', () => t('Link')],
  'format.image': ['format', () => t('Image')],
  'format.clear': ['format', () => t('Clear formatting')],
  'format.comment': ['format', () => t('Comment')],

  'paragraph.body': ['paragraph', () => t('Paragraph')],
  'paragraph.heading-1': ['paragraph', () => t('Heading {level}', { level: 1 })],
  'paragraph.heading-2': ['paragraph', () => t('Heading {level}', { level: 2 })],
  'paragraph.heading-3': ['paragraph', () => t('Heading {level}', { level: 3 })],
  'paragraph.heading-4': ['paragraph', () => t('Heading {level}', { level: 4 })],
  'paragraph.heading-5': ['paragraph', () => t('Heading {level}', { level: 5 })],
  'paragraph.heading-6': ['paragraph', () => t('Heading {level}', { level: 6 })],
  'paragraph.heading-up': ['paragraph', () => t('One heading level up')],
  'paragraph.heading-down': ['paragraph', () => t('One heading level down')],
  'paragraph.table': ['paragraph', () => t('Table')],
  'paragraph.code-block': ['paragraph', () => t('Code block')],
  'paragraph.math-block': ['paragraph', () => t('Math block')],
  'paragraph.chart': ['paragraph', () => t('Chart')],
  'paragraph.quote': ['paragraph', () => t('Quote')],
  'paragraph.ordered-list': ['paragraph', () => t('Numbered list')],
  'paragraph.bullet-list': ['paragraph', () => t('Bulleted list')],
  'paragraph.rule': ['paragraph', () => t('Horizontal rule')],
  'paragraph.task-list': ['paragraph', () => t('Task list')],
  'paragraph.task': ['paragraph', () => t('Tick the task')],
  'paragraph.callout': ['paragraph', () => t('Callout')],
  'paragraph.footnote': ['paragraph', () => t('Footnote')],
  'paragraph.toc': ['paragraph', () => t('Table of contents')],
  'paragraph.front-matter': ['paragraph', () => t('Front matter')],

  // Folding is not an edit: it changes what is on screen and never the note, so
  // it reads with the other things View decides. See fold.ts in the editor.
  'view.fold': ['view', () => t('Fold')],
  'view.fold-all': ['view', () => t('Fold everything')],
  'view.fold-more': ['view', () => t('Fold more')],
  'view.fold-less': ['view', () => t('Fold less')],
  'view.unfold-all': ['view', () => t('Unfold everything')],

  'edit.indent': ['edit', () => t('Indent')],
  'edit.outdent': ['edit', () => t('Outdent')],
  'edit.run-fence': ['edit', () => t('Run this code block')],
  'edit.select-word': ['edit', () => t('Select the word, then the next')],
  'edit.select-line': ['edit', () => t('Select the line')],
  'edit.select-all-occurrences': ['edit', () => t('Select every one like it')],
  'edit.cursor-above': ['edit', () => t('Add a cursor above')],
  'edit.cursor-below': ['edit', () => t('Add a cursor below')],
  'edit.copy-markdown': ['edit', () => t('Copy as markdown')],
  'edit.paste-plain': ['edit', () => t('Paste as plain text')],
  'edit.undo': ['edit', () => t('Undo')],
  'edit.redo': ['edit', () => t('Redo')],
  'edit.redo.alt': ['edit', () => t('Redo')],
  'edit.select-all': ['edit', () => t('Select all')],
  'edit.find': ['edit', () => t('Find')],
  'edit.replace': ['edit', () => t('Replace')],
  'edit.find-next': ['edit', () => t('Find next')],
  'edit.find-next.alt': ['edit', () => t('Find next')],
  'edit.find-previous': ['edit', () => t('Find previous')],
  'edit.find-previous.alt': ['edit', () => t('Find previous')],
  'edit.goto-line': ['edit', () => t('Go to line')],
  'edit.move-line-up': ['edit', () => t('Move the line up')],
  'edit.move-line-down': ['edit', () => t('Move the line down')],
  'edit.copy-line-up': ['edit', () => t('Copy the line up')],
  'edit.copy-line-down': ['edit', () => t('Copy the line down')],
  'edit.follow-link': ['edit', () => t('Follow the link')],

  'table.below': ['table', () => t('Into the table below')],
  'table.above': ['table', () => t('Into the table above')],
  'table.ahead': ['table', () => t('Forward into the table')],
  'table.behind': ['table', () => t('Back into the table')],
  'table.delete': ['table', () => t('Forward into the table instead of deleting')],
  'table.backspace': ['table', () => t('Back into the table instead of deleting')],

  'image.select-behind': ['picture', () => t('Select the picture behind')],
  'image.select-ahead': ['picture', () => t('Select the picture ahead')],
  'image.edit': ['picture', () => t('Edit the picture’s markdown')],
  'image.leave': ['picture', () => t('Leave the selected picture')],
  'image.step-up': ['picture', () => t('Step off the picture upwards')],
  'image.step-down': ['picture', () => t('Step off the picture downwards')],
}

/** The editor's bindings, in the order the editor installs them. */
const EDITOR_SPECS: BindingSpec[] = [
  ...nibBindings,
  ...standardBindings,
  ...tableBindings,
  ...imageBindings,
]

function fromEditor(spec: BindingSpec): Shortcut {
  const named = EDITOR_ENTRIES[spec.id]

  return {
    id: spec.id,
    label: named ? named[1] : () => spec.id,
    category: named ? named[0] : 'edit',
    scope: 'editor',
    key: spec.key,
    // Only what the spec actually carries. A platform key that is absent means
    // "use `key`", while one set to null means "no key on this platform", and
    // copying an absent one over as undefined would blur the two.
    ...(spec.mac === undefined ? {} : { mac: spec.mac }),
    ...(spec.win === undefined ? {} : { win: spec.win }),
    ...(spec.linux === undefined ? {} : { linux: spec.linux }),
    ...(spec.contextual === undefined ? {} : { contextual: spec.contextual }),
    ...(spec.alias === undefined ? {} : { alias: spec.alias }),
  }
}

/** Runs an export through the very row the palette and the File menu run, so a
 *  key can never do something the menu does not. Imported when the key is
 *  pressed: the command list reaches half the app, and this file is loaded
 *  before anything is on screen.
 *
 *  A key bound to a format the thing on screen does not go out as does nothing: a
 *  canvas has no Word file in it, and the row is either not on the list or on it
 *  and greyed out. Nothing to report, either - the answer is the greyed row in
 *  the menu, not a message about a key. */
function runExport(id: ExportId) {
  void import('../commands').then(({ exportCommands }) => {
    const command = exportCommands().find((one) => one.id === `export-${id}`)
    if (command && !command.disabled) command.run()
  })
}

/** Printing, through the same row the File menu and the palette press, and
 *  imported when the key is pressed for the same reason as the export above: the
 *  renderer behind it is most of what the app can load. */
function runPrint() {
  void import('../commands').then(({ appCommands }) => {
    const command = appCommands().find((one) => one.id === 'print')
    if (command && !command.disabled) command.run()
  })
}

/** Runs an app-level command. The two that need the component say so through
 *  the context; everything else reaches the stores directly, the way the
 *  command palette does. */
const APP_ENTRIES: Shortcut[] = [
  {
    id: 'app.save',
    label: () => t('Save'),
    category: 'file',
    scope: 'app',
    key: 'Mod-s',
    run: () => void workspace.save(),
  },
  {
    id: 'app.new',
    label: () => t('New note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-n',
    run: () => workspace.openBlank(),
  },
  // Ctrl+T asks what kind, the way the plus does. It was a second key for New note,
  // and Emil asked for the choice by name: "When you press Ctrl + T it shouldn't just
  // be a new note, there should be a menu (as if you would click the +) where you can
  // decide what type." The chooser opens under the plus of the pane that has the
  // keyboard and lands on the first row, so Ctrl+T then Enter is still a new note; see
  // chooseNewKind in focus.ts and the list in new-kinds.ts.
  {
    id: 'app.new-kind',
    label: () => t('New'),
    category: 'file',
    scope: 'app',
    key: 'Mod-t',
    run: () => chooseNewKind(),
  },
  {
    id: 'app.new-window',
    label: () => t('New window'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-n',
    run: () => void invoke('new_window').catch(() => undefined),
  },
  {
    id: 'app.open',
    label: () => t('Open file'),
    category: 'file',
    scope: 'app',
    key: 'Mod-o',
    run: () => void openFile(),
  },
  {
    id: 'app.close',
    label: () => t('Close note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-w',
    run: () => void workspace.closeActive(),
  },
  {
    // The key every browser goes back with, and the one the editor's own syntax
    // motion was quietly holding on Windows and Linux until this took it; see
    // keymap.ts in @nib/editor.
    //
    // A Mac cannot have either pair. Alt and an arrow there is a word at a time
    // and has been for forty years, and Cmd and a bracket - which is what a Mac
    // browser uses - is indenting here. So it is the brackets under the other
    // modifier, which nothing on that platform is using, and which is a key
    // anybody who wants the browser's own can change in Settings.
    id: 'app.back',
    label: () => t('Back'),
    category: 'view',
    scope: 'app',
    key: 'Alt-ArrowLeft',
    mac: 'Ctrl-[',
    run: () => workspace.goBack(),
  },
  {
    // A browser's key for its address bar, which is what a web tab's field is.
    //
    // Read where the surface is rather than off the window, which is what lets it
    // share the key the editor selects a line with: a pane showing a page has no
    // editor in it, and a pane showing a note never sees this. The same arrangement
    // the canvas's own keys have; see WebBar.svelte and `shortcuts.pressed`.
    id: 'web.address',
    label: () => t('Address'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-l',
    contextual: true,
  },
  {
    id: 'app.forward',
    label: () => t('Forward'),
    category: 'view',
    scope: 'app',
    key: 'Alt-ArrowRight',
    mac: 'Ctrl-]',
    run: () => workspace.goForward(),
  },
  {
    // No default chord: pinning is done to a tab that is already in front of
    // you, and every key with a hand on it is spoken for. The row in the tab's
    // own menu and the palette are the two ways in, and this is here so a reader
    // who wants a key can give it one.
    id: 'app.pin',
    label: () => (workspace.active?.pinned === true ? t('Unpin') : t('Pin')),
    category: 'view',
    scope: 'app',
    key: null,
    run: () => {
      const id = workspace.activeTabId
      if (id) workspace.togglePin(id)
    },
  },
  {
    // The key a browser and Obsidian both use for it, so no hand has to be told.
    id: 'app.reopen',
    label: () => t('Reopen closed tab'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-t',
    run: () => void workspace.reopenClosed(),
  },
  {
    id: 'app.settings',
    label: () => t('Settings'),
    category: 'file',
    scope: 'app',
    key: 'Mod-,',
    run: () => settings.show(),
  },
  {
    // Every key there is, which is this list, in the pane that can also change
    // them. One list and not two: a compact sheet of "the keys worth knowing"
    // would be a second copy of half of this, and the copy is the one that goes
    // stale. It is searchable, it says which key each thing is on right now
    // rather than which key it shipped on, and every row can be rebound where it
    // is read.
    //
    // Discord and half the web open theirs with Ctrl+/. Here that is Source mode
    // and has been since the first version, so this is the shifted one, which on
    // most keyboards is the question mark - which is what asking for help looks
    // like.
    id: 'app.keys',
    label: () => t('Keyboard shortcuts'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-/',
    run: () => settings.show('shortcuts'),
  },
  {
    // The note on paper. No key out of the box, because the one every hand
    // reaches for is Ctrl+P and that is the command palette here, the way it is
    // in Obsidian and in a code editor. Printing is a row in File and in the
    // palette, and anybody who prints daily can put it on a key.
    id: 'app.print',
    label: () => t('Print'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => runPrint(),
  },
  // One row per export there is, in the list's own fixed order, so the settings
  // show every row the File menu and the palette can. All of them are here
  // whatever is open, because a key is bound once and pressed with anything in
  // front of it; a key for a format this document does not go out as does
  // nothing. None of them starts on a key: fourteen defaults would eat the file
  // category, and somebody who exports to one format every day is exactly the
  // person who will bind it.
  ...EXPORT_KEYS.map((id): Shortcut => ({
    id: `export.${id}`,
    label: () => labelOf(id),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => runExport(id),
  })),
  // Cmd+Tab is the Mac's own application switcher and never reaches a window,
  // so there the note switcher is Ctrl+Tab, which is what a Mac browser uses.
  {
    id: 'app.next-note',
    label: () => t('Next note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Tab',
    mac: 'Ctrl-Tab',
    run: () => cycleTab(1),
  },
  {
    id: 'app.previous-note',
    label: () => t('Previous note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Tab',
    mac: 'Ctrl-Shift-Tab',
    run: () => cycleTab(-1),
  },
  // The panes. Named for what they do rather than for the key they are on, since
  // a later batch maps Obsidian's own keys onto the same actions.
  {
    id: 'pane.split-right',
    label: () => t('Split right'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-ArrowRight',
    run: () => workspace.split('row'),
  },
  {
    id: 'pane.split-down',
    label: () => t('Split down'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-ArrowDown',
    run: () => workspace.split('column'),
  },
  {
    id: 'pane.focus-next',
    label: () => t('Other pane'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-o',
    run: () => workspace.panes.focusNext(),
  },
  {
    id: 'app.palette',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: 'Mod-p',
    run: (context) => context.palette(),
  },
  // The same palette, opened on the commands: the field arrives holding `>` with the
  // caret after it, so nothing new has to be learned and deleting the `>` is the way
  // back to the notes. Ctrl+Shift+P because that is where VS Code, Obsidian and every
  // editor that has a command palette put it, and because it is Ctrl+P with the one
  // modifier a reader already reaches for to mean "the other one of these".
  //
  // Emil asked for it by name: "Ctrl + P is very very handy, I really like it. There
  // should be another shortcut that is for commands (so you don't have to type > all
  // the time, maybe Ctrl + Shift + P?)". Paragraph held the chord until this took it
  // and needs none now, because setting a heading to the level it already is turns it
  // back into prose; see setHeading in @nib/editor.
  {
    id: 'app.commands',
    label: () => t('Commands'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-p',
    run: (context) => context.palette('commands'),
  },
  {
    id: 'app.sidebar',
    label: () => t('Show sidebar'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-l',
    run: () => workspace.toggleSidebar(),
  },
  // The four panels. One key each, and the same key back: it opens the panel and
  // puts the keyboard in it, and pressing it again while the keyboard is already
  // there gives the note the keyboard back. Two keys for one journey - one to go
  // and one nobody remembers for coming back - is how a panel becomes somewhere
  // you get stuck.
  //
  // Letters rather than the digits they were on. Ctrl+Shift and a digit is not a
  // key a text editor can spend: on a layout where the digit itself is the shifted
  // character - French, and every other AZERTY - the editor underneath reads the
  // press as Ctrl and the digit and sets a heading level, so Ctrl+Shift+3 both
  // opened the file list and turned the line into a heading. A letter cannot be
  // read that way round, because the shifted letter and the letter are different
  // names for the key. See runHandlers in @codemirror/view.
  //
  // Obsidian ships `file-explorer:open` and `outline:open` with no key at all and
  // Notion has nothing of the kind, so three of these are Nib's own; Ctrl+Shift+E
  // for the files is what VS Code puts its explorer on, and Ctrl+Shift+F for
  // search is already Obsidian's.
  {
    id: 'app.files',
    label: () => t('Files'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-e',
    run: () => revealPanel('tree'),
  },
  {
    id: 'app.outline',
    label: () => t('Outline'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-o',
    run: () => revealPanel('outline'),
  },
  {
    id: 'app.search',
    label: () => t('Search this space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-f',
    run: () => revealPanel('search'),
  },
  {
    // What links here and what this links to. On B for the backlinks half, which
    // is what the panel is called everywhere else; L is the sidebar's own key.
    id: 'app.links',
    label: () => t('Links'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-b',
    run: () => revealPanel('links'),
  },
  // Round the regions of the window: the sidebar's header, its panel tabs, the
  // search pill, the list, the strip of notes, the note, the bar under it.
  //
  // The one key Tab cannot be. Tab indents in a note - Obsidian and Notion both
  // spend it that way, and a markdown editor has to - so there has to be a key
  // that walks out of the note, and F6 is the one every hand already has: Windows
  // cycles a window's elements with it, VS Code moves between its parts with it,
  // and Discord moves between its sections with it. Shift+F6 goes back.
  {
    id: 'app.region-next',
    label: () => t('Next section'),
    category: 'view',
    scope: 'app',
    key: 'F6',
    run: () => void stepRegionFocus(1),
  },
  {
    id: 'app.region-previous',
    label: () => t('Previous section'),
    category: 'view',
    scope: 'app',
    key: 'Shift-F6',
    run: () => void stepRegionFocus(-1),
  },
  // The spaces. Discord switches servers with Ctrl+Alt and an arrow, which is the
  // same shape of thing; here both of those arrows are the panes', so the two keys
  // every app uses for the one before and the one after take it instead.
  {
    id: 'space.previous',
    label: () => t('Previous space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-,',
    run: () => stepSpace(-1),
  },
  {
    id: 'space.next',
    label: () => t('Next space'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-.',
    run: () => stepSpace(1),
  },
  {
    // The header's own menu, from anywhere: which space this is, the others, and
    // making one. On the space bar, because that is where the word is written.
    id: 'space.switcher',
    label: () => t('Spaces'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Space',
    run: () => openSpaces(),
  },
  {
    // The space drawn as a map of its links. No key out of the box - it opens
    // from the panel's tabs and the palette - and here so a preset that has one for it
    // has somewhere to put it. Obsidian's is Ctrl+G.
    id: 'app.graph',
    label: () => t('Graph'),
    category: 'view',
    scope: 'app',
    key: null,
    run: () => workspace.openGraph(),
  },
  {
    id: 'app.source',
    label: () => t('Source mode'),
    category: 'view',
    scope: 'app',
    key: 'Mod-/',
    run: (context) => modes.toggleSource(context.view),
  },
  {
    id: 'app.focus',
    label: () => t('Focus mode'),
    category: 'view',
    scope: 'app',
    key: 'F8',
    run: (context) => modes.toggleFocus(context.view),
  },
  {
    id: 'app.typewriter',
    label: () => t('Typewriter mode'),
    category: 'view',
    scope: 'app',
    key: 'F9',
    run: (context) => modes.toggleTypewriter(context.view),
  },
  {
    // The note through the renderer, per tab. Obsidian's key for the same
    // thing, and the one a hand reaches for without being told.
    id: 'app.reading',
    label: () => t('Reading'),
    category: 'view',
    scope: 'app',
    key: 'Mod-e',
    run: () => workspace.toggleReading(),
  },
  {
    // The note as a deck, full screen, with nothing else on it. F5 because that
    // is the key every hand already knows for starting a presentation, and
    // because the app's other view keys are already along that row. Obsidian's
    // own Slides plugin ships no key at all, so no preset takes this one back.
    // A browser keeps F5 for reloading, which the settings list warns about; the
    // palette and the View menu are the way in there.
    id: 'app.present',
    label: () => t('Present'),
    category: 'view',
    scope: 'app',
    key: 'F5',
    run: () => present.toggle(),
  },
  {
    // The editor with its doors locked, which is a different thing; see
    // setReadOnlyMode in the editor package.
    id: 'app.read-only',
    label: () => t('Read-only'),
    category: 'view',
    scope: 'app',
    key: 'F10',
    run: (context) => modes.toggleReadOnly(context.view),
  },
  {
    id: 'app.fullscreen',
    label: () => t('Fullscreen'),
    category: 'view',
    scope: 'app',
    key: 'F11',
    run: (context) => context.fullscreen(),
  },
  // The three keys every browser and every editor changes the size of the words
  // with. They are the note's own text size here - `--zoom`, never the webview's; see
  // text-size.ts - and they are these three keys because a reader who wants bigger
  // words does not read a shortcut list first. Heading up, heading down and Paragraph
  // used to hold them and are one modifier over now; see keymap.ts in the editor.
  {
    id: 'app.zoom-in',
    label: () => t('Zoom in'),
    category: 'view',
    scope: 'app',
    key: 'Mod-=',
    run: () => modes.stepZoom(1),
  },
  {
    id: 'app.zoom-out',
    label: () => t('Zoom out'),
    category: 'view',
    scope: 'app',
    key: 'Mod--',
    run: () => modes.stepZoom(-1),
  },
  {
    // A digit, which is the one kind of key a layout puts behind Shift: on AZERTY the
    // nought is Shift and the top row, so Ctrl+0 arrives with Shift down. It is
    // matched by the key underneath rather than by the character, which is what every
    // browser does with its own Ctrl+0; see `matchesCombination` in keys.ts and the
    // digit rule in shortcuts.test.ts.
    id: 'app.zoom-reset',
    label: () => t('Actual size'),
    category: 'view',
    scope: 'app',
    key: 'Mod-0',
    run: () => modes.resetZoom(),
  },
]

/** The notes of the pane being worked in, by number. Nine of them, because a
 *  tenth would need two keys and nobody counts that far along a strip.
 *
 *  Alt as well as Ctrl, because Ctrl and a digit is a heading level in the
 *  editor and has been since the first version. */
const NUMBERED: Shortcut[] = Array.from({ length: 9 }, (_unused, index) => ({
  id: `app.note-${index + 1}`,
  label: () => t('Note {number}', { number: index + 1 }),
  category: 'view' as const,
  scope: 'app' as const,
  key: `Mod-Alt-${index + 1}`,
  run: () => {
    const tab = workspace.tabsIn(workspace.panes.focusedId)[index]
    if (tab) workspace.activate(tab.id)
  },
}))

/** The file list's own keys. They are read where the list is - see
 *  Tree.svelte - and only fire while the focus is in it, which is why they
 *  can hold Ctrl+A and Delete without being in the way of the editor's. */
const PANEL_ENTRIES: Shortcut[] = [
  {
    id: 'tree.select-all',
    label: () => t('Select every file'),
    category: 'panel',
    scope: 'panel',
    key: 'Mod-a',
    contextual: true,
  },
  {
    id: 'tree.deselect',
    label: () => t('Clear the selection'),
    category: 'panel',
    scope: 'panel',
    key: 'Escape',
    contextual: true,
  },
  {
    id: 'tree.delete',
    label: () => t('Delete the selected files'),
    category: 'panel',
    scope: 'panel',
    key: 'Delete',
    contextual: true,
  },
  {
    id: 'tree.delete.alt',
    label: () => t('Delete the selected files'),
    category: 'panel',
    scope: 'panel',
    key: 'Backspace',
    contextual: true,
    alias: true,
  },
  // Walking the list. Contextual, like the plane's own arrows, so sharing the
  // four of them with the editor's motion is not reported as a clash: they only
  // mean anything while the focus is in the list. The walk itself is
  // tree-keys.ts and the rows are Tree.svelte.
  {
    id: 'tree.down',
    label: () => t('Next file'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowDown',
    contextual: true,
  },
  {
    id: 'tree.up',
    label: () => t('Previous file'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.into',
    label: () => t('Show what it holds'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowRight',
    contextual: true,
  },
  {
    id: 'tree.out',
    label: () => t('Hide what it holds'),
    category: 'panel',
    scope: 'panel',
    key: 'ArrowLeft',
    contextual: true,
  },
  {
    id: 'tree.open',
    label: () => t('Open'),
    category: 'panel',
    scope: 'panel',
    key: 'Enter',
    contextual: true,
  },
  {
    id: 'tree.rename',
    label: () => t('Rename'),
    category: 'panel',
    scope: 'panel',
    key: 'F2',
    contextual: true,
  },
  // Moving a row within the order somebody arranged, which is the one of the
  // list's seven orders a key can change: the other six are rules the notes
  // themselves decide. Alt and an arrow, because the plain arrows walk the list and
  // because it is the key every list that can be rearranged uses. Contextual, like
  // the walk itself, so sharing it with the editor's own move-a-line-up is not
  // reported as a clash: it only means anything while the focus is in the list, and
  // only in Manual. See `moveInOrder` in workspace.svelte.ts.
  {
    id: 'tree.move-up',
    label: () => t('Move up'),
    category: 'panel',
    scope: 'panel',
    key: 'Alt-ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.move-down',
    label: () => t('Move down'),
    category: 'panel',
    scope: 'panel',
    key: 'Alt-ArrowDown',
    contextual: true,
  },
  // The row's own menu, which every row in every list already has on a right
  // click and a held finger. Shift+F10 is the key a window manager has used for it
  // for thirty years, and the key beside the right Ctrl is the one with the picture
  // of a menu printed on it.
  {
    id: 'list.menu',
    label: () => t('Menu for this row'),
    category: 'panel',
    scope: 'panel',
    key: 'Shift-F10',
    contextual: true,
  },
  {
    id: 'list.menu.alt',
    label: () => t('Menu for this row'),
    category: 'panel',
    scope: 'panel',
    key: 'ContextMenu',
    contextual: true,
    alias: true,
  },
]

/** The plane's own keys. Read where the plane is - see Canvas.svelte - and only
 *  while it is the surface in front, which is why they can hold a bare letter
 *  and the arrows without being in the way of anything anybody is typing.
 *
 *  Contextual, like the file list's, so they share Delete and the arrows with it
 *  rather than being reported as a clash with it. */
const CANVAS_ENTRIES: Shortcut[] = (
  [
    ['canvas.tool.select', () => t('Select'), 'v'],
    ['canvas.tool.hand', () => t('Pan'), 'h'],
    ['canvas.tool.draw', () => t('Draw'), 'd'],
    ['canvas.tool.erase', () => t('Erase'), 'e'],
    ['canvas.tool.lasso', () => t('Lasso'), 'q'],
    ['canvas.tool.text', () => t('Card'), 'c'],
    ['canvas.tool.file', () => t('Note'), 'n'],
    ['canvas.tool.picture', () => t('Picture'), 'i'],
    ['canvas.tool.link', () => t('Link'), 'k'],
    ['canvas.tool.group', () => t('Frame'), 'f'],
    ['canvas.tool.rect', () => t('Rectangle'), 'r'],
    ['canvas.tool.ellipse', () => t('Oval'), 'o'],
    ['canvas.tool.rhombus', () => t('Diamond'), 'm'],
    ['canvas.tool.triangle', () => t('Triangle'), 't'],
    ['canvas.tool.line', () => t('Line'), 'l'],
    ['canvas.tool.arrow', () => t('Arrow'), 'a'],
    ['canvas.tool.elbow', () => t('Elbow'), 'b'],
    ['canvas.write', () => t('Write in what is picked'), 'Enter'],
    ['canvas.group', () => t('Group'), 'g'],
    ['canvas.ungroup', () => t('Ungroup'), 'u'],
    ['canvas.delete', () => t('Delete what is picked'), 'Delete'],
    ['canvas.duplicate', () => t('Duplicate'), 'Mod-d'],
    // One modifier over from the 0 a zoom is reset with everywhere else, because the
    // app's own text size holds that one now: the press is read off the plane and goes
    // on to the window afterwards, so leaving both there would fit the plane and resize
    // the words from one key. The same trade the plane's Ctrl+1 makes under the
    // Obsidian preset; see presets.ts.
    ['canvas.fit', () => t('Fit the canvas'), 'Mod-Alt-0'],
    ['canvas.frame', () => t('Zoom to what is picked'), 'Mod-1'],
    ['canvas.find', () => t('Find on the canvas'), 'Mod-f'],
    ['canvas.front', () => t('Bring to front'), 'Mod-Shift-]'],
    ['canvas.forward', () => t('Bring forward'), 'Mod-]'],
    ['canvas.back', () => t('Send to back'), 'Mod-Shift-['],
    ['canvas.backward', () => t('Send backward'), 'Mod-['],
    ['canvas.nudge.left', () => t('Nudge left'), 'ArrowLeft'],
    ['canvas.nudge.right', () => t('Nudge right'), 'ArrowRight'],
    ['canvas.nudge.up', () => t('Nudge up'), 'ArrowUp'],
    ['canvas.nudge.down', () => t('Nudge down'), 'ArrowDown'],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'canvas' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
}))

/** A page note's own keys: the zoom, and adding a page.
 *
 *  Read where the paper is - see Pages.svelte - and only while it is the surface
 *  in front, like the plane's above. Contextual for the same reason: they share
 *  Ctrl+Alt+0 with the plane's Fit, and only one of the two surfaces is ever in
 *  front of a reader.
 *
 *  One modifier over from the keys every browser zooms with, because the app's own
 *  text size holds those: Ctrl+=, Ctrl+- and Ctrl+0 make the words bigger
 *  everywhere, including over a page note, and a zoom on one of these keys would
 *  resize the words and the paper from one press. See docs/keyboard.md, which
 *  states the digit rule once, and `canvas.fit`, which made the same trade.
 *
 *  Adding a page has no key at all. The gesture is the way in - carry on scrolling
 *  past the last page - and the silhouette at the end of the column is the button;
 *  this row is here so a reader who wants a key can give it one. */
const PAGES_ENTRIES: Shortcut[] = (
  [
    ['pages.zoom.in', () => t('Zoom in'), 'Mod-Alt-='],
    ['pages.zoom.out', () => t('Zoom out'), 'Mod-Alt--'],
    ['pages.fit', () => t('Fit width'), 'Mod-Alt-0'],
    ['pages.fit.page', () => t('Fit page'), null],
    ['pages.add', () => t('Add a page'), null],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'pages' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
}))

CANVAS_ENTRIES.push({
  id: 'canvas.delete.alt',
  label: () => t('Delete what is picked'),
  category: 'canvas',
  scope: 'panel',
  key: 'Backspace',
  contextual: true,
  alias: true,
})

/** Round the strip of the pane being worked in. Every key stays inside its own
 *  pane: the other pane is somebody's reference, not their next tab. */
function cycleTab(direction: number) {
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const index = tabs.findIndex((tab) => tab.id === workspace.activeTabId)
  if (index < 0) return

  const next = tabs[(index + direction + tabs.length) % tabs.length]
  if (next) workspace.activate(next.id)
}

/** Keys that are spoken for and cannot be handed to something else.
 *
 *  They are in the list rather than left out of it, because a shortcut that
 *  is missing from a list of every shortcut reads as an oversight. Each says
 *  why: the clipboard belongs to the system, and the keys that move the caret
 *  and delete characters are how a text editor works rather than choices
 *  anybody made. */
export const FIXED_ENTRIES: Shortcut[] = [
  {
    id: 'fixed.cut',
    label: () => t('Cut'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-x',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.copy',
    label: () => t('Copy'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-c',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.paste',
    label: () => t('Paste'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Mod-v',
    why: () => t('The clipboard belongs to the system.'),
  },
  {
    id: 'fixed.caret',
    label: () => t('Moving the caret'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('The arrow keys, Home, End, Page up and Page down belong to the text.'),
  },
  {
    id: 'fixed.delete',
    label: () => t('Deleting a character'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('Backspace and Delete belong to the text.'),
  },
  {
    id: 'fixed.newline',
    label: () => t('New line'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Enter',
    why: () => t('Enter closes a code block and carries a list on.'),
  },
  {
    id: 'fixed.tab',
    label: () => t('Indent with Tab'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Tab',
    why: () => t('Tab moves on through the app as well as indenting.'),
  },
  {
    id: 'fixed.escape',
    label: () => t('Escape'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Escape',
    why: () => t('Escape closes whatever is open.'),
  },
  {
    id: 'fixed.lists',
    label: () => t('Moving through a list'),
    category: 'fixed',
    scope: 'fixed',
    key: null,
    why: () => t('The arrow keys, Enter and Esc work whatever is open; they are not shortcuts.'),
  },
  {
    id: 'fixed.quit',
    label: () => t('Quit'),
    category: 'fixed',
    scope: 'fixed',
    key: 'Alt-F4',
    mac: 'Mod-q',
    why: () => t('Your system takes this key before the app sees it.'),
  },
]

/** Every shortcut there is, in the order the settings list shows them. */
export const SHORTCUTS: Shortcut[] = [
  ...APP_ENTRIES,
  ...NUMBERED,
  ...EDITOR_SPECS.map(fromEditor),
  ...PANEL_ENTRIES,
  ...CANVAS_ENTRIES,
  ...PAGES_ENTRIES,
  ...FIXED_ENTRIES,
]

export const BY_ID = new Map(SHORTCUTS.map((one) => [one.id, one]))

const EDITOR_BY_ID = new Map(EDITOR_SPECS.map((one) => [one.id, one]))

/** Runs whatever an id names, and answers whether there was anything to run.
 *
 *  The registry holds both halves of every command already - the app entries
 *  carry their own `run`, and the editor's keep theirs in the specs the keymap
 *  is built from - so a button that presses a command by id presses the same
 *  thing the key does rather than a second copy of it. What the phone's format
 *  bar is made of; see toolbar.svelte.ts.
 *
 *  False for an id nothing answers to, for an editor command with no editor on
 *  screen, and for the panel and fixed entries: a panel key only means anything
 *  inside the file list, and a fixed one is a fact about the keyboard rather
 *  than a command. */
export function runEntry(id: string, context: AppContext): boolean {
  const spec = EDITOR_BY_ID.get(id)
  if (spec) {
    const view = context.view
    if (!view) return false

    spec.run(view)
    view.focus()
    return true
  }

  const entry = BY_ID.get(id)
  if (entry?.scope !== 'app' || !entry.run) return false

  entry.run(context)
  return true
}

/** Whether an id is one `runEntry` can press at all, which is what the settings
 *  offer and what a saved list is cleaned against. */
export function runnable(id: string): boolean {
  if (EDITOR_BY_ID.has(id)) return true

  const entry = BY_ID.get(id)
  return !!entry && entry.scope === 'app' && !!entry.run
}

/** Combinations the machine underneath usually swallows. Not a refusal - the
 *  app cannot know what a given system does with a given key - but a warning
 *  beside the binding, so nobody sets a key and wonders why nothing happens. */
export const SYSTEM_KEYS: Record<Platform, string[]> = {
  mac: [
    'Mod-q',
    'Mod-h',
    'Mod-m',
    'Mod-Tab',
    'Mod-Space',
    'Mod-Shift-3',
    'Mod-Shift-4',
    'Mod-Shift-5',
  ],
  win: ['Alt-F4', 'Alt-Tab', 'Meta-l', 'Ctrl-Shift-Escape'],
  linux: ['Alt-F4', 'Alt-Tab'],
}

/** And the ones a browser keeps for itself. Only a worry in the browser: the
 *  packaged app has no tabs to close and no developer tools to open. */
export const BROWSER_KEYS = [
  'F12',
  'F5',
  'F11',
  'Mod-Shift-i',
  'Mod-Shift-j',
  'Mod-Shift-c',
  'Mod-r',
  'Mod-Shift-r',
  'Mod-w',
  'Mod-t',
  'Mod-n',
  'Mod-Shift-n',
  'Mod-Shift-t',
]
