import {
  clearFormatting,
  type EditorView,
  foldHeadings,
  foldLess,
  foldMore,
  highlightSelection,
  insertComment,
  insertLink,
  openFind,
  openReplace,
  pasteHere,
  pastePlain,
  redoEdit,
  type StateCommand,
  toggleFold,
  toggleHighlight,
  toggleWrap,
  undoEdit,
  unfoldEverything,
} from '@nib/editor'
import { HIGHLIGHT_COLOURS } from '@nib/markdown/highlights'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { copySelection, cutSelection } from './clipboard'
import { blockCommands, exportCommands, importCommand } from './commands'
import { fullscreen } from './fullscreen.svelte'
import { EXPORT_FORMATS, EXPORT_VARIANTS } from './export/formats'
import { EXPORT_EXTRAS } from './export/offer'
import { canPrint, printNote } from './export/print'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuGroup, type MenuItem, type MenuRow } from './menu-item'
import { archiveEntry } from './menu.svelte'
import { modes } from './modes.svelte'
import { canSaveAs, saveAs } from './save-as'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'
import { present } from './slides/present.svelte'
import { newSpace } from './space-actions'
import { invoke, isDesktop, openExternal } from './tauri'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'
import { openFile } from './open-file'

/** Where the app is developed, which is the whole of "about" for an open
 *  source editor. */
export const SOURCE_URL = 'https://github.com/lxorb/nibeditor'

/** Where a bug goes, and where a new version says what changed. Both are pages
 *  of the same repository, so neither is a second address to keep in step. */
export const ISSUES_URL = `${SOURCE_URL}/issues`
export const RELEASES_URL = `${SOURCE_URL}/releases`

interface Context {
  view?: EditorView | undefined
  onpalette(): void
  onhistory(): void
}

/** The export rows, with a rule wherever the kind of row changes: the formats
 *  this document goes out as, then the variants of two of them, then the paper
 *  and whatever else the machine can do. The list itself is the command list, so
 *  the submenu, the palette and the shortcut settings show the same rows in the
 *  same order, and all three follow what is open; see export/offer.ts. */
function exportRows(): MenuRow[] {
  const formats = new Set<string>(
    [...EXPORT_FORMATS, ...EXPORT_EXTRAS].map((one) => `export-${one.id}`),
  )
  const variants = new Set<string>(EXPORT_VARIANTS.map((one) => `export-${one.id}`))

  const rows: MenuRow[] = []
  let last: string | null = null

  for (const command of exportCommands()) {
    const kind = formats.has(command.id) ? 'format' : variants.has(command.id) ? 'variant' : 'rest'
    if (last !== null && kind !== last) rows.push(DIVIDER)
    last = kind

    rows.push({
      label: command.label,
      hint: command.hint,
      disabled: !!command.disabled,
      run: command.run,
    })
  }

  return rows
}

/** Runs an editor command against whichever view is on screen. */
function run(view: EditorView | undefined, command: StateCommand) {
  if (!view) return

  // The view rather than a pair made out of it, so a command that can do more
  // with one does: folding moves the lines it hides before it hides them, which
  // needs something that can measure them. See fold-motion.ts in @nib/editor.
  command(view)
  view.focus()
}

/** Everything the app can do, arranged the way a menu bar arranges it.
 *
 *  Built fresh each time it opens so the ticks and the greying-out describe
 *  the moment rather than whenever the app started. Every row here calls the
 *  same code the keyboard and the command palette already call - the menu is
 *  another way in, not a second implementation. */
export function appMenu(context: Context): MenuGroup[] {
  const { view } = context
  const hasNote = !!workspace.active
  const selected = !!view && !view.state.selection.main.empty
  /** Whether the editor takes an edit at all. Read-only mode says no, and every
   *  row that would write says so by greying out rather than by doing nothing
   *  when it is pressed. */
  const writable = !!view && !view.state.readOnly

  /** A row that edits the note, named by the shortcut it carries so the key and
   *  the row can never say different things. */
  const edit = (id: string, label: string, command: StateCommand): MenuItem => ({
    label,
    hint: shortcuts.hint(id),
    disabled: !writable,
    run: () => run(view, command),
  })

  /** A row that runs a command against the view itself rather than against its
   *  state: whether it did anything is its own answer and no business of a row's. */
  const onView = (command: (one: EditorView) => boolean) => () => {
    if (view) command(view)
  }

  /** Rows for the blocks named, in the order they are named, out of the one list
   *  the palette and the editor's `/` menu read too. A `Command` is a `MenuItem`
   *  with an id on it, so only the id comes off. */
  const written = blockCommands(view)
  const blocks = (...ids: string[]): MenuItem[] =>
    ids.flatMap((id) => {
      const found = written.find((one) => one.id === id)
      if (!found) return []

      return [
        {
          label: found.label,
          ...(found.hint === undefined ? {} : { hint: found.hint }),
          ...(found.disabled === undefined ? {} : { disabled: found.disabled }),
          run: found.run,
        },
      ]
    })

  /** Importing: notes out of another app, and any document pandoc reads. One
   *  row, which opens the sheet that works out what the file is. */
  const imported = importCommand()

  return [
    {
      id: 'file',
      label: t('File'),
      rows: [
        { label: t('New note'), hint: shortcuts.hint('app.new'), run: () => workspace.openBlank() },
        { label: t('New canvas'), run: () => void workspace.createCanvas() },
        { label: t('New page note'), run: () => void workspace.createPages() },
        { label: t('New web note'), run: () => void workspace.createWebsite() },
        { label: t('Open file'), hint: shortcuts.hint('app.open'), run: () => void openFile() },
        ...(imported ? [{ label: imported.label, run: imported.run }] : []),
        { label: t('New space'), run: () => void newSpace() },
        ...(isDesktop
          ? [
              {
                label: t('New window'),
                hint: shortcuts.hint('app.new-window'),
                run: () => void invoke('new_window'),
              },
            ]
          : []),
        DIVIDER,
        {
          label: t('Save'),
          hint: shortcuts.hint('app.save'),
          disabled: !hasNote,
          run: () => void workspace.save(),
        },
        { label: t('Save as'), disabled: !canSaveAs(), run: () => void saveAs() },
        {
          label: t('Rename'),
          disabled: !workspace.active?.path,
          run: () => {
            const path = workspace.active?.path
            if (path) workspace.startRenaming(path)
          },
        },
        DIVIDER,
        // Export is one word here and a dozen rows behind it. It used to be a
        // menu of its own beside File, which put the formats a note goes out as
        // in the same strip as File, Edit and View - and a person looking for
        // "export" looks under File, because that is where every other editor
        // keeps it. The rows are the export list itself, greyed where the thing
        // on screen does not go out that way.
        { label: t('Export'), rows: exportRows() },
        ...(canPrint
          ? [
              {
                label: t('Print'),
                hint: shortcuts.hint('app.print'),
                disabled: workspace.active?.kind !== 'note',
                run: () => busy.start(t('Printing'), () => printNote()),
              },
            ]
          : []),
        DIVIDER,
        { label: t('Version history'), disabled: !hasNote, run: () => context.onhistory() },
        { label: t('Settings'), hint: shortcuts.hint('app.settings'), run: () => settings.show() },
        DIVIDER,
        // Putting the open document away. This menu is the ⋮ on a phone and a tablet,
        // where there is no strip of tabs and so no tab menu to reach it from - so without
        // this row the only way to archive what is open on a handheld would be the file
        // list, and the reader is not in the file list. See archive.ts and docs/archive.md.
        ...archiveEntry(workspace.active?.path),
        {
          label: t('Close note'),
          hint: shortcuts.hint('app.close'),
          disabled: !hasNote,
          run: () => void workspace.closeActive(),
        },
        {
          label: t('Reopen closed tab'),
          hint: shortcuts.hint('app.reopen'),
          disabled: !workspace.closed.any,
          run: () => void workspace.reopenClosed(),
        },
      ],
    },

    {
      id: 'edit',
      label: t('Edit'),
      rows: [
        {
          label: t('Undo'),
          hint: shortcuts.hint('edit.undo'),
          disabled: !writable,
          run: () => view && undoEdit(view),
        },
        {
          label: t('Redo'),
          hint: shortcuts.hint('edit.redo'),
          disabled: !writable,
          run: () => view && redoEdit(view),
        },
        DIVIDER,
        {
          label: t('Cut'),
          hint: shortcuts.hint('fixed.cut'),
          disabled: !selected || !writable,
          run: cutSelection,
        },
        {
          label: t('Copy'),
          hint: shortcuts.hint('fixed.copy'),
          disabled: !selected,
          run: copySelection,
        },
        // Paste, which reads the clipboard rather than riding on a paste event -
        // a menu row has none. Rich by default and plain on the row below it, the
        // same two the keyboard offers.
        {
          label: t('Paste'),
          hint: shortcuts.hint('fixed.paste'),
          disabled: !writable,
          run: onView(pasteHere),
        },
        {
          label: t('Paste as plain text'),
          hint: shortcuts.hint('edit.paste-plain'),
          disabled: !writable,
          run: onView(pastePlain),
        },
        DIVIDER,
        {
          label: t('Select all'),
          hint: shortcuts.hint('edit.select-all'),
          disabled: !view,
          run: () => view?.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        },
        DIVIDER,
        {
          label: t('Find'),
          hint: shortcuts.hint('edit.find'),
          disabled: !view,
          run: onView(openFind),
        },
        {
          label: t('Replace'),
          hint: shortcuts.hint('edit.replace'),
          disabled: !writable,
          run: onView(openReplace),
        },
        {
          label: t('Search'),
          hint: shortcuts.hint('app.search'),
          run: () => workspace.showPanel('search'),
        },
      ],
    },

    {
      id: 'paragraph',
      label: t('Paragraph'),
      // Every row of it comes from `blockCommands`, which the palette and the
      // editor's `/` menu read as well: one list, three ways in. Only the rules
      // between the groups are the menu's own.
      rows: [
        ...blocks('paragraph.heading-1', 'paragraph.heading-2', 'paragraph.heading-3'),
        ...blocks('paragraph.heading-4', 'paragraph.heading-5', 'paragraph.heading-6'),
        ...blocks('paragraph.body', 'paragraph.heading-up', 'paragraph.heading-down'),
        DIVIDER,
        ...blocks(
          'paragraph.table',
          'paragraph.code-block',
          'paragraph.quote',
          'paragraph.math-block',
          'paragraph.callout',
        ),
        DIVIDER,
        ...blocks('paragraph.bullet-list', 'paragraph.ordered-list', 'paragraph.task-list'),
        DIVIDER,
        ...blocks(
          'picture',
          // The microphone, beside the picture: both put something of the reader's own
          // into the note. See recorder/commands.ts.
          'record',
          'meeting',
          'paragraph.footnote',
          'paragraph.toc',
          'paragraph.front-matter',
        ),
        DIVIDER,
        // A new slide is a rule with a blank line above it, which is what breaks
        // a deck into its next one; see packages/markdown/src/slides.ts.
        ...blocks('paragraph.rule', 'slide-break', 'page-break'),
      ],
    },

    {
      id: 'format',
      label: t('Format'),
      rows: [
        {
          label: t('Bold'),
          hint: shortcuts.hint('format.bold'),
          disabled: !writable,
          run: () => run(view, toggleWrap('**')),
        },
        {
          label: t('Italic'),
          hint: shortcuts.hint('format.italic'),
          disabled: !writable,
          run: () => run(view, toggleWrap('*')),
        },
        {
          label: t('Strikethrough'),
          hint: shortcuts.hint('format.strikethrough'),
          disabled: !writable,
          run: () => run(view, toggleWrap('~~')),
        },
        {
          label: t('Highlight'),
          hint: shortcuts.hint('format.highlight'),
          disabled: !writable,
          run: () => run(view, highlightSelection),
        },
        {
          // The colours, behind the one word that names them, because six rows in
          // front of the list would be six rows about one thing. Picking one
          // highlights the selection and sticks: the row above, the bar's own
          // button and the shortcut all write that colour from then on. Five
          // colours, which is what Obsidian encodes in the markdown, plus the
          // plain highlight; see highlights.ts in @nib/markdown.
          label: t('Highlight colour'),
          disabled: !writable,
          rows: HIGHLIGHT_COLOURS.map((colour) => ({
            label: t(colour.name),
            checked: colour.tone === modes.highlightTone,
            run: () => {
              modes.setHighlightTone(colour.tone)
              run(view, toggleHighlight(colour))
            },
          })),
        },
        DIVIDER,
        {
          label: t('Code'),
          hint: shortcuts.hint('format.code'),
          disabled: !writable,
          run: () => run(view, toggleWrap('`')),
        },
        { label: t('Inline math'), disabled: !writable, run: () => run(view, toggleWrap('$')) },
        { label: t('Superscript'), disabled: !writable, run: () => run(view, toggleWrap('^')) },
        { label: t('Subscript'), disabled: !writable, run: () => run(view, toggleWrap('~')) },
        DIVIDER,
        {
          label: t('Link'),
          hint: shortcuts.hint('format.link'),
          disabled: !writable,
          run: () => run(view, insertLink),
        },
        edit('format.comment', t('Comment'), insertComment),
        DIVIDER,
        {
          label: t('Clear formatting'),
          hint: shortcuts.hint('format.clear'),
          disabled: !writable,
          run: () => run(view, clearFormatting),
        },
      ],
    },

    {
      id: 'view',
      label: t('View'),
      rows: [
        {
          label: t('Command palette'),
          hint: shortcuts.hint('app.palette'),
          run: () => context.onpalette(),
        },
        DIVIDER,
        {
          label: t('Reading'),
          hint: shortcuts.hint('app.reading'),
          checked: !!workspace.active?.reading,
          disabled: workspace.active?.kind !== 'note',
          run: () => workspace.toggleReading(),
        },
        {
          label: t('Present'),
          hint: shortcuts.hint('app.present'),
          checked: present.on,
          disabled: !present.on && !present.available,
          run: () => present.toggle(),
        },
        {
          label: t('Read-only'),
          hint: shortcuts.hint('app.read-only'),
          checked: modes.readOnly,
          run: () => modes.toggleReadOnly(view),
        },
        {
          label: t('Source mode'),
          hint: shortcuts.hint('app.source'),
          checked: modes.source,
          run: () => modes.toggleSource(view),
        },
        {
          label: t('Typewriter mode'),
          hint: shortcuts.hint('app.typewriter'),
          checked: modes.typewriter,
          run: () => modes.toggleTypewriter(view),
        },
        {
          label: t('Focus mode'),
          hint: shortcuts.hint('app.focus'),
          checked: modes.focus,
          run: () => modes.toggleFocus(view),
        },
        // The document and nothing else: the file list and both bars
        // leave. The same command the key is bound to; see fullscreen.svelte.ts.
        {
          label: t('Fullscreen'),
          hint: shortcuts.hint('app.fullscreen'),
          checked: fullscreen.on,
          run: () => void fullscreen.toggle(workspace.activeTabId),
        },
        // A window that stays over everything else, for writing beside whatever is
        // being written about. Only a desktop has a window of its own to raise.
        ...(isDesktop
          ? [
              {
                label: t('Always on top'),
                checked: modes.alwaysOnTop,
                run: () => modes.toggleAlwaysOnTop(),
              },
            ]
          : []),
        DIVIDER,
        // The panes. Left out on a phone, which shows one note at a time.
        ...(viewport.touch
          ? []
          : [
              {
                label: t('Split right'),
                hint: shortcuts.hint('pane.split-right'),
                disabled: !workspace.canSplit('row'),
                run: () => workspace.split('row'),
              },
              {
                label: t('Split down'),
                hint: shortcuts.hint('pane.split-down'),
                disabled: !workspace.canSplit('column'),
                run: () => workspace.split('column'),
              },
              {
                label: t('Other pane'),
                hint: shortcuts.hint('pane.focus-next'),
                disabled: workspace.panes.count < 2,
                run: () => workspace.panes.focusNext(),
              },
              DIVIDER,
            ]),
        {
          label: t('Show sidebar'),
          hint: shortcuts.hint('app.sidebar'),
          checked: !!workspace.panel,
          run: () => workspace.toggleSidebar(),
        },
        {
          label: t('Files'),
          hint: shortcuts.hint('app.files'),
          run: () => workspace.showPanel('tree'),
        },
        { label: t('Outline'), run: () => workspace.showPanel('outline') },
        DIVIDER,
        // Folding is a view operation, so these rows stand whether the note can
        // be written in or not.
        { label: t('Fold'), hint: shortcuts.hint('view.fold'), run: () => run(view, toggleFold) },
        {
          label: t('Fold everything'),
          hint: shortcuts.hint('view.fold-all'),
          run: () => run(view, foldHeadings),
        },
        {
          label: t('Fold more'),
          hint: shortcuts.hint('view.fold-more'),
          run: () => run(view, foldMore),
        },
        {
          label: t('Fold less'),
          hint: shortcuts.hint('view.fold-less'),
          run: () => run(view, foldLess),
        },
        {
          label: t('Unfold everything'),
          hint: shortcuts.hint('view.unfold-all'),
          run: () => run(view, unfoldEverything),
        },
        DIVIDER,
        { label: t('Zoom in'), hint: shortcuts.hint('app.zoom-in'), run: () => modes.stepZoom(1) },
        {
          label: t('Zoom out'),
          hint: shortcuts.hint('app.zoom-out'),
          run: () => modes.stepZoom(-1),
        },
        {
          label: t('Actual size'),
          hint: shortcuts.hint('app.zoom-reset'),
          run: () => modes.resetZoom(),
        },
      ],
    },

    {
      id: 'help',
      label: t('Help'),
      rows: [
        {
          label: account.user ? t('Sign out') : t('Sign in'),
          run: () => (account.user ? void account.signOut() : (account.open = true)),
        },
        DIVIDER,
        // Through the store, so what it finds is offered rather than downloaded
        // in silence; see updates.svelte.ts.
        ...(isDesktop ? [{ label: t('Check for updates'), run: () => void updates.check() }] : []),
        { label: t('What is new'), run: () => void openExternal(RELEASES_URL) },
        { label: t('Report an issue'), run: () => void openExternal(ISSUES_URL) },
        { label: t('Source code'), run: () => void openExternal(SOURCE_URL) },
      ],
    },
  ]
}
