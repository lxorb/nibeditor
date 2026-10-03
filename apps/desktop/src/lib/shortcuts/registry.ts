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
import { revealPanel, stepRegionFocus } from '../focus'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { searchFrom } from '../search.svelte'
import { askQuickly } from '../ai/quick-door'
import { toggleScratchpad } from '../scratchpad/is'
import { settings } from '../settings.svelte'
// The space actions are already in the first chunk, since the sidebar and the app
// menu both reach them, so this costs nothing to load early.
import { stepSpace } from '../space-actions'
import { present } from '../slides/present.svelte'
import { picks } from '../tab-strip/drag.svelte'
import { closeWindow, invoke, isDesktop, platform } from '../tauri'
import type { Platform } from '../keys'
import { workspace } from '../workspace.svelte'
import { type Around, closeAfterLabel } from '../workspace/closing-around'

/** What Ctrl+Shift+A asks the AI panel before it opens it: whether the press was the
 *  panel's own (its field had the keyboard, so the press means the thread list). Set by
 *  the panel while it is on screen; here rather than in a module of the panel's, which
 *  would be one more file in the first paint. */
let askAgain: (() => boolean) | null = null

/** The panel's answer to Ctrl+Shift+A, while it is on screen; null as it goes. */
export function hearAgain(answer: (() => boolean) | null): void {
  askAgain = answer
}

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
  /** Opens the palette; `'commands'` is a `>` in its field, narrowed to them. With
   *  `again`, a palette already up is put away instead: see `tapped`. */
  palette(mode?: 'commands', again?: boolean): void
  fullscreen(): void
  /** Asked by a modifier tapped twice rather than by a chord. Shift Shift with the
   *  palette up puts it away, the way the press that opened a layer closes it again
   *  (Emil, 2026-10-03); a chord keeps what it does in the palette's own field. See
   *  tapped.ts. */
  tapped?: boolean
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
  /** What it acts on is a desktop's alone - a window of its own - so nothing else
   *  offers it for a bar or a pull; see `runnable`. */
  desktop?: boolean
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
  'edit.expand-selection': ['edit', () => t('Expand the selection')],
  'edit.shrink-selection': ['edit', () => t('Shrink the selection')],
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
  'edit.insert-line-above': ['edit', () => t('Insert a line above')],
  'edit.delete-line': ['edit', () => t('Delete the line')],
  'edit.join-lines': ['edit', () => t('Join the lines')],
  'edit.sort-lines': ['edit', () => t('Sort the lines')],
  'edit.reverse-lines': ['edit', () => t('Reverse the lines')],
  'edit.upper-case': ['edit', () => t('Upper case')],
  'edit.lower-case': ['edit', () => t('Lower case')],
  'edit.title-case': ['edit', () => t('Title case')],
  'edit.duplicate-block': ['edit', () => t('Duplicate the block')],
  'edit.move-block-up': ['edit', () => t('Move the block up')],
  'edit.move-block-down': ['edit', () => t('Move the block down')],
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

/** The dialog Ctrl+T holds up, from a command: the palette and a press of the key
 *  before the chord has landed. Fetched for the same reason as the export above; it
 *  has landed by the time anybody could ask, because the chord that is its first
 *  reader is fetched at the launch's last turn. See new-kind-sheet.svelte.ts. */
export function chooseNewKind(paneId?: string) {
  void import('../new-kind-sheet.svelte').then(({ newKindSheet }) => {
    newKindSheet.show(paneId)
  })
}

/** Asked at the press rather than as this module loads, so a test can be a Mac. */
const onMac = () => isDesktop && platform() === 'macos'

/** Runs an app-level command. The two that need the component say so through
 *  the context; everything else reaches the stores directly, the way the
 *  command palette does. */
const APP_ENTRIES: Shortcut[] = [
  {
    id: 'app.new',
    label: () => t('New note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-n',
    run: () => workspace.openBlank(),
  },
  // Ctrl+T asks what kind, in a dialog in the middle of the window standing on a web
  // page: Emil, 2026-09-27, *"Ctrl + T should always open a webpage by default"*. It
  // was a second key for New note before it asked at all; see new-kind-sheet.svelte.ts
  // and the list in new-kinds.ts.
  //
  // From a key it is more than this: tapped, it makes the web page outright, the way a
  // browser does; held, it is Alt+Tab's shape - the dialog stays up while Ctrl is down,
  // each further T steps it round, and letting go chooses. That half cannot live here,
  // because a command is handed the app's context and not the keystroke, and all of it
  // turns on the keystroke: see new-kind-chord.ts. The entry stays what it was for the
  // palette, which has no modifier to hold.
  {
    id: 'app.new-kind',
    label: () => t('New'),
    category: 'file',
    scope: 'app',
    key: 'Mod-t',
    run: () => chooseNewKind(),
  },
  {
    // No key since the private tab took Chrome's for it (docs/backlog.md, Q3): Ctrl+N is
    // a new note here, so New window keeps its row and the palette's, and a reader may
    // give it a key.
    id: 'app.new-window',
    label: () => t('New window'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void invoke('new_window').catch(() => undefined),
    // A phone has the one window and no command for another: its bar offered a
    // button that did nothing. The palette's row is greyed on the same condition.
    desktop: true,
  },
  {
    // Chrome's Ctrl+Shift+N, a new Incognito window, is a private tab here: a page that
    // writes nothing down and forgets everything with its last tab; see
    // web-tab/private.ts. A desktop's alone, which is where a web tab is a page of nib's.
    id: 'app.new-private',
    label: () => t('New private tab'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-n',
    run: () => void import('../web-tab/private').then(({ openPrivate }) => openPrivate()),
    desktop: true,
  },
  // Obsidian's Random note. No key out of the box, as there; see random-note.ts.
  {
    id: 'app.random-note',
    label: () => t('Random note'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void import('../random-note').then(({ openRandomNote }) => openRandomNote()),
  },
  {
    id: 'app.close',
    label: () => t('Close note'),
    category: 'file',
    scope: 'app',
    key: 'Mod-w',
    // On a Mac the same key closes the window once nothing is left in it to close,
    // as it does in Safari and VS Code there. A pane put down with Ctrl+D still has
    // its tabs, so there it closes nothing. A pick of tabs goes whole, as in Chrome.
    run: () => {
      const pick = picks.loaded
      const many = pick?.chosen.of(workspace.panes.focusedId) ?? []
      if (pick && many.length) void pick.closeChosen(many)
      else if (workspace.activeTabId || workspace.tabs.length || !onMac())
        void workspace.closeActive()
      else void closeWindow()
    },
  },
  {
    // Every Mac app's File menu has it under the same key with Shift, and so does a
    // browser's and VS Code's on Windows and Linux.
    id: 'app.close-window',
    label: () => t('Close window'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-w',
    run: () => void closeWindow(),
    desktop: true,
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
    // Obsidian's Mac back, Cmd+Opt and an arrow, is the pane split here.
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
    // Read by the tab, so a note keeps Ctrl+Shift+I for a picture. In a page the
    // engine answers both keys itself.
    id: 'web.devtools',
    label: () => t('Developer tools'),
    category: 'view',
    scope: 'panel',
    key: 'F12',
    contextual: true,
  },
  {
    id: 'web.devtools.alt',
    label: () => t('Developer tools'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-Shift-i',
    mac: 'Mod-Alt-i',
    contextual: true,
    alias: true,
  },
  {
    // Chrome's History, Ctrl+H, and Cmd+Y on a Mac, where Cmd+H hides the app. Read by the
    // bar where a page is, like the address key, so a note keeps Ctrl+H for Replace. In a
    // page it is the page's first, as in Chrome; see web_opens.rs.
    id: 'web.history',
    label: () => t('History'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-h',
    mac: 'Mod-y',
    contextual: true,
  },
  {
    // Chrome's Delete browsing data, Ctrl+Shift+Delete; Cmd+Shift+Backspace on a Mac.
    id: 'web.clear-data',
    label: () => t('Delete browsing data'),
    category: 'view',
    scope: 'panel',
    key: 'Mod-Shift-Delete',
    mac: 'Mod-Shift-Backspace',
    contextual: true,
  },
  {
    // Chrome's Mute site has no key; a reader may give it one.
    id: 'web.mute',
    label: () => t('Mute site'),
    category: 'view',
    scope: 'panel',
    key: null,
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
  // A tab's own menu, for a reader who wants a key: Chrome gives these none, and
  // VS Code's are two-stroke chords. See tab-strip/menu.ts.
  {
    id: 'app.close-right',
    label: () => closeAfterLabel(),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => closeAroundActive('right'),
  },
  {
    id: 'app.close-all',
    label: () => t('Close all tabs'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => closeAroundActive('all'),
  },
  {
    id: 'app.duplicate-tab',
    label: () => t('Duplicate tab'),
    category: 'file',
    scope: 'app',
    key: null,
    run: () => void tabOps().then((ops) => ops.duplicateTab(workspace.activeTabId ?? '')),
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
    //
    // Except on a Mac, where Shift+Cmd+? is the system's in every app: the search
    // field AppKit puts at the top of the Help menu. There the list is the first row
    // of Help instead, with no key out of the box.
    id: 'app.keys',
    label: () => t('Keyboard shortcuts'),
    category: 'file',
    scope: 'app',
    key: 'Mod-Shift-/',
    mac: null,
    run: () => settings.show('shortcuts'),
  },
  {
    // The note on paper, on the key every program prints with. It was the palette's
    // second key until Emil, 2026-10-01: *"we don't need Ctrl+P as a default shortcut
    // for opening the search, because we already have Shift Shift"* - and a Ctrl+P
    // nothing answered would have printed the app's own window. A web tab's page has
    // it first, as in a browser: web_keys.rs never takes it.
    id: 'app.print',
    label: () => t('Print'),
    category: 'file',
    scope: 'app',
    key: 'Mod-p',
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
    run: () => cycleTab(1, true),
  },
  {
    id: 'app.previous-note',
    label: () => t('Previous note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Tab',
    mac: 'Ctrl-Shift-Tab',
    run: () => cycleTab(-1, true),
  },
  // Chrome's other pair for the same walk, which a hand that lives in a browser
  // reaches for as often as Ctrl+Tab.
  // On a Mac it is Safari's, Chrome's and VS Code's Cmd+Shift and a bracket.
  {
    id: 'app.next-note.alt',
    label: () => t('Next note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-PageDown',
    mac: 'Mod-Shift-]',
    alias: true,
    run: () => cycleTab(1),
  },
  {
    id: 'app.previous-note.alt',
    label: () => t('Previous note'),
    category: 'view',
    scope: 'app',
    key: 'Mod-PageUp',
    mac: 'Mod-Shift-[',
    alias: true,
    run: () => cycleTab(-1),
  },
  // The strip's own order, by key: Chrome's Ctrl+Shift+PageUp and PageDown, one
  // slot at a time, the same movement dragging the tab makes.
  {
    id: 'app.move-tab-left',
    label: () => t('Move tab left'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-PageUp',
    run: () => moveTab(-1),
  },
  {
    id: 'app.move-tab-right',
    label: () => t('Move tab right'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-PageDown',
    run: () => moveTab(1),
  },
  // Emil, 2026-09-30: *"add Ctrl + D as a shortcut. Effectively it just deselects the
  // currently selected tab."* The pane shows nothing and every tab stays open. It took
  // the key from Select word, which has none now (the VS Code keyboard gives it back),
  // and from the file list's Duplicate, which is a row of the row's menu: putting a tab
  // down is harmless where a copy writes files, and Explorer's own Ctrl+D deletes. A
  // page and a plane with something picked answer it first; see web_opens.rs and
  // canvas/actions.ts.
  {
    id: 'app.deselect-tab',
    label: () => t('Deselect tab'),
    category: 'view',
    scope: 'app',
    key: 'Mod-d',
    run: () => workspace.deselect(),
  },
  // Emil, 2026-10-03: the same in every pane, and the key again brings them all back.
  // On Ctrl+Shift+D under every keyboard: none of the four binds it - VS Code's Run and
  // Debug is a view nib has not got - and it is answered in a page and a terminal as
  // the window answers it; see web_opens.rs and terminal/keys.ts.
  {
    id: 'app.deselect-all',
    label: () => t('Deselect all tabs'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-d',
    run: () => workspace.deselectAll(),
  },
  // F2 on a tab, the file list's key, read by the strip itself.
  {
    id: 'tabs.rename',
    label: () => t('Rename'),
    category: 'view',
    scope: 'panel',
    key: 'F2',
    contextual: true,
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
  // VS Code's "move editor into next group" is Ctrl+Alt+Right, which is Split right
  // here; with Shift, the split takes the tab along rather than a copy.
  {
    id: 'pane.move-tab',
    label: () => t('Move to other pane'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-Shift-ArrowRight',
    run: () => void tabOps().then((ops) => ops.moveToOtherPane(workspace.activeTabId ?? '')),
  },
  {
    id: 'pane.focus-next',
    label: () => t('Other pane'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-o',
    run: () => workspace.panes.focusNext(),
  },
  // Shift twice, JetBrains' key and Emil's, and Ctrl+O. See tapped.ts.
  {
    id: 'app.palette',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: 'Shift Shift',
    run: (context) => context.palette(undefined, context.tapped),
  },
  // With no key of its own: Shift twice is the palette's, and Ctrl+P is Print. The
  // keyboards that have the palette on another key put it here; see presets.ts.
  {
    id: 'app.palette.alt',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: null,
    alias: true,
    run: (context) => context.palette(undefined, context.tapped),
  },
  // Ctrl+O as well, which is what a hand reaches for to open something, and what is
  // there to open is in a space: nib opens nothing from outside its spaces. Obsidian's
  // Ctrl+O is its quick switcher, which is this palette on the notes, so the key
  // lands where a vault app's hand expects it. It was Open file, which is gone.
  {
    id: 'app.palette.open',
    label: () => t('Command palette'),
    category: 'view',
    scope: 'app',
    key: 'Mod-o',
    alias: true,
    run: (context) => context.palette(undefined, context.tapped),
  },
  // Where every editor puts its commands, as Emil asked; Paragraph gave it up.
  {
    id: 'app.commands',
    label: () => t('Commands'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-p',
    run: (context) => context.palette('commands'),
  },
  // With no key of its own: the Obsidian keyboard's Ctrl+P. See presets.ts.
  {
    id: 'app.commands.alt',
    label: () => t('Commands'),
    category: 'view',
    scope: 'app',
    key: null,
    alias: true,
    run: (context) => context.palette('commands'),
  },
  {
    id: 'app.sidebar',
    label: () => t('Left sidebar'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-l',
    run: () => workspace.toggleSidebar(),
  },
  // The other side, on VS Code's own key for its secondary side bar.
  {
    id: 'app.right-sidebar',
    label: () => t('Right sidebar'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-b',
    run: () => workspace.toggleSidebar('right'),
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
  // No default chord, as in Obsidian and VS Code.
  {
    id: 'app.reveal',
    label: () => t('Show in the file list'),
    category: 'panel',
    scope: 'app',
    key: null,
    run: () => workspace.revealNote(),
  },
  {
    id: 'app.fold-list',
    label: () => t('Collapse the file list'),
    category: 'panel',
    scope: 'app',
    key: null,
    run: () => workspace.foldList(),
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
    run: (context) => searchFrom(context.view),
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
  {
    id: 'app.ask',
    label: () => t('Ask'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-a',
    // Pressed again in the panel's field, the thread list (docs/ai-sidebar.md 4.11);
    // pressed in the list, back to the note, as every panel's key goes.
    run: () => {
      if (!askAgain?.()) revealPanel('ask')
    },
  },
  // The selection into the AI panel's field as `@Note:12-14`, Claude Code's Alt+K: the
  // words as they are now, which go with the next message whatever is selected then.
  {
    id: 'app.ask-selection',
    label: () => t('Selection to the AI panel'),
    category: 'view',
    scope: 'app',
    key: 'Alt-k',
    run: () => {
      if (!__EVEN_PLUGIN__) void import('../ai/sidebar/quote').then((one) => one.quoteSelection())
    },
  },
  // A question on the side, Claude Code's /btw: a field in the middle of the window
  // with the note's selection, the note or the page in front going along, answered in
  // place and gone with Escape. Ctrl pressed twice on its own, Cmd twice on a Mac, the
  // shape Claude's own quick entry and JetBrains' Run Anything have: no chord a note,
  // a shell or a site is using, and heard over a web page by the page's own script and
  // inside a terminal by the window, so it is free everywhere. See ai/quick.svelte.ts.
  {
    id: 'app.quick-question',
    label: () => t('Quick question'),
    category: 'view',
    scope: 'app',
    key: 'Mod Mod',
    run: () => askQuickly(),
  },
  // The one note in no space; pressed again while it is in front, back to the tab
  // before it. Ctrl+Shift, which a terminal hands the app, and no browser's or any
  // other app's key nib keeps a keyboard of. See scratchpad/pad.ts.
  {
    id: 'app.scratchpad',
    label: () => t('Scratchpad'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-x',
    run: () => toggleScratchpad(),
  },
  // No key of its own, as Footnotes has none; a row to put one on.
  {
    id: 'app.properties',
    label: () => t('Properties'),
    category: 'view',
    scope: 'app',
    key: null,
    run: () => revealPanel('properties'),
  },
  {
    // The stop for every agent (docs/agent-native.md 9.5), from any app while one is
    // connected, so three modifiers nobody presses by accident; see lib/agents/ui.
    id: 'agents.stop',
    label: () => t('Stop agents'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Alt-Shift-k',
    mac: 'Mod-Ctrl-Alt-k',
    run: () => {
      if (!__EVEN_PLUGIN__) void import('../agents/ui/index').then(({ stopAgents }) => stopAgents())
    },
    desktop: true,
  },
  // Round the regions of the window: the sidebar's header, its panel tabs, the
  // search pill, the list, the strip of notes, the note, the bar under it.
  //
  // The one key Tab cannot be. Tab indents in a note - Obsidian and Notion both
  // spend it that way, and a markdown editor has to - so there has to be a key
  // that walks out of the note, and F6 is the one every hand already has: Windows
  // cycles a window's elements with it, VS Code moves between its parts with it,
  // and Discord moves between its sections with it. Shift+F6 goes back.
  // A Mac keeps it, as VS Code does there: Ctrl+F6 is the system's, and a laptop
  // has Fn+F6.
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
    // The switcher in the middle of the window, and away again: a digit for a space's
    // number, a name and Enter. On the space bar, because that is where the word is
    // written: Ctrl+Space (Emil, 2026-10-04), which no browser binds. Kept off Ctrl and
    // a digit, which are the tabs as in every browser (Arc spends them on its spaces),
    // and off Ctrl+K, which is a site's own palette. A page is offered it first (Sheets
    // selects a column with it, Colab and VS Code on the web complete), an input method
    // that toggles on it takes it before the window, and a terminal keeps it for the
    // shell, which reads it as NUL; Ctrl+Shift+Space below is the switcher there. A Mac
    // has Ctrl+Space for the input source and Cmd+Space for Spotlight, so there it is
    // Cmd+Shift+Space alone. See space-picker.svelte.ts and docs/keyboard.md.
    id: 'space.switcher',
    label: () => t('Spaces'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Space',
    mac: 'Mod-Shift-Space',
    run: toggleSpacePicker,
  },
  {
    // Its first key, kept: the one a terminal hands over, since a shell has no use for
    // the Shift. On a Mac it is the only key, above.
    id: 'space.switcher.alt',
    label: () => t('Spaces'),
    category: 'view',
    scope: 'app',
    key: 'Mod-Shift-Space',
    mac: null,
    alias: true,
    run: toggleSpacePicker,
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
    // F8 to F10 are media keys on a Mac and Obsidian has none, so there these
    // sit on Ctrl+Cmd beside Enter Full Screen, as Finder's Ctrl+Cmd+S does.
    mac: 'Mod-Ctrl-o',
    run: (context) => modes.toggleFocus(context.view),
  },
  {
    id: 'app.typewriter',
    label: () => t('Typewriter mode'),
    category: 'view',
    scope: 'app',
    key: 'F9',
    mac: 'Mod-Ctrl-t',
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
    // palette and the View menu are the way in there. Over a page it is `web.reload`.
    // On a Mac, Keynote's Play Slideshow.
    id: 'app.present',
    label: () => t('Present'),
    category: 'view',
    scope: 'app',
    key: 'F5',
    mac: 'Mod-Alt-p',
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
    mac: 'Mod-Ctrl-r',
    run: (context) => modes.toggleReadOnly(context.view),
  },
  {
    id: 'app.fullscreen',
    label: () => t('Fullscreen'),
    category: 'view',
    scope: 'app',
    key: 'F11',
    // F11 is Show Desktop on a Mac; Ctrl+Cmd+F is its Enter Full Screen.
    mac: 'Mod-Ctrl-f',
    run: (context) => context.fullscreen(),
  },
  // The tab alone in the window, which stays a window; see lib/tab-fill.
  {
    id: 'app.fill-tab',
    label: () => t('Full window'),
    category: 'view',
    scope: 'app',
    key: 'Shift-F11',
    mac: 'Mod-Ctrl-Shift-f',
    run: () => void import('../tab-fill/fill').then((one) => one.toggleFill()),
  },
  // The three keys every browser and every editor changes the size of the words
  // with. They are the note's own text size here - `--zoom`, never the webview's; see
  // text-size.ts - and they are these three keys because a reader who wants bigger
  // words does not read a shortcut list first. Heading up, heading down and Paragraph
  // used to hold them and are one modifier over now; see keymap.ts in the editor. Over a
  // web page they zoom the page, as in Chrome; see web-tab/bar-keys.ts.
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

/** The ninth digit, which is the last tab rather than the ninth. */
const LAST = 8

const noteAt = (index: number) => t('Note {number}', { number: index + 1 })

/** The notes of the pane being worked in, by number. Eight of them and then the
 *  last, which is Chrome's rule and Obsidian's: nobody counts nine along a strip,
 *  but everybody knows which tab is the last one.
 *
 *  Alt as well as Ctrl, because Ctrl and a digit is a heading level in the
 *  editor and has been since the first version. On a Mac the two trade places:
 *  Cmd and a digit is the tab in Obsidian and Safari. */
const NUMBERED: Shortcut[] = Array.from({ length: 9 }, (_unused, index) => ({
  id: `app.note-${index + 1}`,
  label: () => (index === LAST ? t('Last note') : noteAt(index)),
  category: 'view' as const,
  scope: 'app' as const,
  key: `Mod-Alt-${index + 1}`,
  mac: `Mod-${index + 1}`,
  run: () => showTab(index === LAST ? 'last' : index),
}))

/** Emil, 2026-09-30: *"alt + x opens the tab at position x and alt + 0 opens the last
 *  tab."* Second keys of the eight places and the last; the ninth place is its own. None
 *  on a Mac, where Option and a digit types a character and Cmd has the tabs. */
const ALT_NUMBERED: Shortcut[] = Array.from({ length: 10 }, (_unused, index): Shortcut => {
  // Along the top row: one to nine, then the nought.
  const digit = (index + 1) % 10
  const at = digit === 0 ? 'last' : index
  const ninth = at === LAST

  return {
    id: ninth ? 'app.note-ninth' : `app.note-${at === 'last' ? LAST + 1 : digit}.alt`,
    label: () => (at === 'last' ? t('Last note') : noteAt(at)),
    category: 'view',
    scope: 'app',
    key: `Alt-${digit}`,
    mac: null,
    ...(ninth ? {} : { alias: true }),
    run: () => showTab(at),
  }
})

/** The tab at a place along the focused pane's strip, counting from nought, or the
 *  last one. Pinned tabs count, as in Chrome, and a place past the end is nothing, as
 *  Chrome's Ctrl+1 to 8 are. Also Chrome's own Ctrl and a digit while a page is in
 *  front, where no heading is waiting for it; see WebBar.svelte. */
export function showTab(at: number | 'last') {
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const tab = at === 'last' ? tabs.at(-1) : tabs[at]
  if (tab) workspace.activate(tab.id)
}

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
  // Cmd+Backspace on a Mac, as in Finder and Obsidian; a bare one deletes nothing.
  {
    id: 'tree.delete',
    label: () => t('Delete the selected files'),
    category: 'panel',
    scope: 'panel',
    key: 'Delete',
    mac: 'Mod-Backspace',
    contextual: true,
  },
  {
    id: 'tree.delete.alt',
    label: () => t('Delete the selected files'),
    category: 'panel',
    scope: 'panel',
    key: 'Backspace',
    mac: 'Mod-Delete',
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
  // Finder renames on Return, which opens in every list here (roving.ts), so a
  // Mac has Cmd+Return.
  {
    id: 'tree.rename',
    label: () => t('Rename'),
    category: 'panel',
    scope: 'panel',
    key: 'F2',
    mac: 'Mod-Enter',
    contextual: true,
  },
  // The selection from the keyboard, the way Explorer and VS Code build one: Shift and
  // an arrow take the next row too, VS Code's Ctrl+Shift+Enter puts the row in or takes
  // it out (Explorer's Ctrl+Space is the space switcher, from a list too). The
  // clipboard, undo, redo and a new note are the app's own keys read in the list; see
  // `fileKey` in Tree.svelte.
  {
    id: 'tree.extend-down',
    label: () => t('Select down'),
    category: 'panel',
    scope: 'panel',
    key: 'Shift-ArrowDown',
    contextual: true,
  },
  {
    id: 'tree.extend-up',
    label: () => t('Select up'),
    category: 'panel',
    scope: 'panel',
    key: 'Shift-ArrowUp',
    contextual: true,
  },
  {
    id: 'tree.toggle',
    label: () => t('Select or deselect'),
    category: 'panel',
    scope: 'panel',
    key: 'Mod-Shift-Enter',
    contextual: true,
  },
  // No key: Ctrl+D puts the tab down, in the list as everywhere else. The row's menu
  // has Duplicate, and a reader who wants Finder's Cmd+D back can give it one.
  {
    id: 'tree.duplicate',
    label: () => t('Duplicate'),
    category: 'panel',
    scope: 'panel',
    key: null,
    contextual: true,
  },
  // Moving a row within the order somebody arranged, which is the one of the
  // list's seven orders a key can change: the other six are rules the notes
  // themselves decide. Alt and an arrow, because the plain arrows walk the list and
  // because it is the key every list that can be rearranged uses. Contextual, like
  // the walk itself, so sharing it with the editor's own move-a-line-up is not
  // reported as a clash: it only means anything while the focus is in the list, and
  // only in Manual. See `moveInOrder` in tree-lift.ts.
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
    // Figma's, Excalidraw's and tldraw's, and shared with Deselect tab: the plane
    // takes it only with something picked, so the press is spent or let go whole.
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

// Cmd+1 and Cmd+Shift and a bracket are the tabs' on a Mac, and the plane answers
// first, so these move there: beside Fit, and to Figma's Cmd+Opt and a bracket.
const MAC_CANVAS: Record<string, string> = {
  'canvas.frame': 'Mod-Alt-1',
  'canvas.front': 'Mod-Alt-]',
  'canvas.back': 'Mod-Alt-[',
}
for (const entry of CANVAS_ENTRIES) {
  const mac = MAC_CANVAS[entry.id]
  if (mac) entry.mac = mac
}

/** A web tab's other keys, Chrome's, read by the bar in the focused pane before the
 *  window is: F5 is Present over a note, and a pane showing a page has no note. See
 *  web-tab/bar-keys.ts. A Mac types a character with Alt+D. */
const WEB_ENTRIES: Shortcut[] = (
  [
    ['web.address.alt', () => t('Address'), 'Alt-d', null],
    ['web.reload', () => t('Reload'), 'F5', 'Mod-r'],
    ['web.reload.alt', () => t('Reload'), 'Mod-r', null],
    ['web.fresh', () => t('Hard reload'), 'Mod-Shift-r', undefined],
    ['web.fresh.alt', () => t('Hard reload'), 'Mod-F5', null],
    ['web.stop', () => t('Stop'), 'Escape', undefined],
  ] as const
).map(([id, label, key, mac]) => ({
  id,
  label,
  category: 'view' as const,
  scope: 'panel' as const,
  key,
  ...(mac === undefined ? {} : { mac }),
  contextual: true,
  ...(id.endsWith('.alt') ? { alias: true } : {}),
}))

/** The AI panel's field (docs/ai-sidebar.md 4.12). Read by the field itself, where the
 *  focus is, so each is contextual: Ctrl+N there is a new thread and a new note
 *  everywhere else, Ctrl+O unfolds the rows there and opens the palette elsewhere. */
const AI_ENTRIES: Shortcut[] = (
  [
    ['ai.mode', () => t('Next mode'), 'Shift-Tab'],
    ['ai.model', () => t('Model and effort'), 'Alt-p'],
    ['ai.effort', () => t('Next effort'), 'Alt-t'],
    ['ai.steer', () => t('Send into the running answer'), 'Mod-Enter'],
    ['ai.stop', () => t('Stop the answer'), 'Escape'],
    ['ai.unfold', () => t('Open every step'), 'Mod-o'],
    ['ai.new', () => t('New chat'), 'Mod-n'],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'view' as const,
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

/** The switcher in the middle of the window, up or away. Fetched with the dialog, which
 *  the launch's last turn has already done by the first press. */
function toggleSpacePicker() {
  void import('../space-picker.svelte').then(({ spacePicker }) => spacePicker.toggle())
}

// Both fetched as the launch ends; see `warmDoors`.
const tabOps = () => import('../tab-strip/ops')

/** Kept once fetched, so a step lands in the frame of its press and a held Ctrl is
 *  still held when it does. */
let cycling: typeof import('../tab-cycle.svelte') | null = null

function cycleTab(direction: number, mayUseOrder = false) {
  if (cycling) {
    cycling.cycleTab(direction, mayUseOrder)
    return
  }

  void import('../tab-cycle.svelte').then((one) => {
    cycling = one
    one.cycleTab(direction, mayUseOrder)
  })
}

function closeAroundActive(which: Around) {
  const id = workspace.activeTabId
  if (id) void workspace.closeAround(id, which)
}

/** The tab being read, one slot along its own strip: the same movement dragging
 *  it makes, for a hand that would rather not. It stops at either end rather than
 *  wrapping round, as Chrome's does: walking a strip is a loop, moving a tab is a
 *  rearrangement, and a key that carried the first tab of forty to the far end
 *  because it was pressed once too often would be a key nobody could trust. A
 *  pinned tab stays among the pinned; see `placeFor` in workspace/pinning.ts. */
function moveTab(direction: number) {
  const paneId = workspace.panes.focusedId
  const tabs = workspace.tabsIn(paneId)
  const at = tabs.findIndex((tab) => tab.id === workspace.activeTabId)
  const tab = tabs[at]
  const slot = at + direction
  if (!tab || slot < 0 || slot >= tabs.length) return

  workspace.moveTab(tab.id, paneId, slot)
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
  ...ALT_NUMBERED,
  ...EDITOR_SPECS.map(fromEditor),
  ...PANEL_ENTRIES,
  ...CANVAS_ENTRIES,
  ...PAGES_ENTRIES,
  ...WEB_ENTRIES,
  ...AI_ENTRIES,
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

/** Whether an id is one `runEntry` can press at all, here, which is what the
 *  settings offer and what a saved list is cleaned against. */
export function runnable(id: string): boolean {
  if (EDITOR_BY_ID.has(id)) return true

  const entry = BY_ID.get(id)
  return !!entry && entry.scope === 'app' && !!entry.run && (isDesktop || !entry.desktop)
}

/** Combinations the machine underneath usually swallows. Not a refusal - the
 *  app cannot know what a given system does with a given key - but a warning
 *  beside the binding, so nobody sets a key and wonders why nothing happens.
 *  The Globe key's chords are missing because it never reaches a page. */
export const SYSTEM_KEYS: Record<Platform, string[]> = {
  mac: [
    'Mod-q',
    'Mod-h',
    'Mod-Alt-h',
    'Mod-m',
    'Mod-Shift-q',
    'Mod-Alt-Escape',
    'Mod-Ctrl-q',
    'Mod-Tab',
    'Mod-Shift-Tab',
    'Mod-`',
    'Mod-Shift-`',
    'Mod-Space',
    'Mod-Alt-Space',
    'Ctrl-Space',
    'Mod-Ctrl-Space',
    'Mod-Shift-3',
    'Mod-Shift-4',
    'Mod-Shift-5',
    'Ctrl-ArrowUp',
    'Ctrl-ArrowDown',
    'Ctrl-ArrowLeft',
    'Ctrl-ArrowRight',
    'F11',
    'Mod-Alt-d',
    'Mod-Ctrl-d',
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
