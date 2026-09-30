import {
  clearFormatting,
  type EditorView,
  foldHeadings,
  foldLess,
  findNext,
  findPrevious,
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
import { blockCommands, exportCommands } from './commands'
import { fullscreen } from './fullscreen.svelte'
import { EXPORT_FORMATS, EXPORT_VARIANTS } from './export/formats'
import { EXPORT_EXTRAS } from './export/offer'
import { canPrint, printNote } from './export/print'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuGroup, type MenuItem, type MenuRow } from './menu-item'
import { modes } from './modes.svelte'
import { shortcuts } from './shortcuts.svelte'
import { present } from './slides/present.svelte'
import { isDesktop, openExternal } from './tauri'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

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
      asks: true,
      // The export's own id is `export-pdf`; the registry's for the same row is
      // `export.pdf`, which is the one a key is bound to.
      command: command.id.replace(/^export-/, 'export.'),
      disabled: !!command.disabled,
      run: command.run,
    })
  }

  return rows
}

/** A row's key, both ways it is read: written for a reader as the hint, and as
 *  the registry id the Mac's menu bar makes a key equivalent of. One call, so the
 *  two can never name different commands; see `command` in menu-item.ts. */
function keyed(id: string): Pick<MenuItem, 'hint' | 'command'> {
  return { hint: shortcuts.hint(id), command: id }
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
    ...keyed(id),
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
          // The one block that asks for something first: which picture.
          ...(found.id === 'picture' ? { asks: true } : {}),
          command: found.id,
          ...(found.disabled === undefined ? {} : { disabled: found.disabled }),
          run: found.run,
        },
      ]
    })

  return [
    {
      id: 'file',
      label: t('File'),
      // What a document goes out as and what it was, and nothing more. Making,
      // opening and closing are on the keys every editor has them on, the
      // strip's plus, a tab's own menu and the palette, and Settings is the gear in
      // the panel's foot; a row for each here was a second list to read past. Emil,
      // 2026-09-30: *"I would like to remove some options here: everything till
      // (exclusive) export. and also close note, close window, reopen closed tab"*,
      // *"and settings"*. A Mac's menu bar keeps its File rows, because there a key
      // reaches a web tab only as a row; see `fileRows` in native-menu-bar.svelte.ts.
      rows: [
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
                ...keyed('app.print'),
                asks: true,
                disabled: workspace.active?.kind !== 'note',
                run: () => busy.start(t('Printing'), () => printNote()),
              },
            ]
          : []),
        DIVIDER,
        {
          label: t('Version history'),
          asks: true,
          disabled: !hasNote,
          run: () => context.onhistory(),
        },
      ],
    },

    {
      id: 'edit',
      label: t('Edit'),
      rows: [
        {
          label: t('Undo'),
          ...keyed('edit.undo'),
          disabled: !writable,
          run: () => view && undoEdit(view),
        },
        {
          label: t('Redo'),
          ...keyed('edit.redo'),
          disabled: !writable,
          run: () => view && redoEdit(view),
        },
        DIVIDER,
        {
          label: t('Cut'),
          ...keyed('fixed.cut'),
          disabled: !selected || !writable,
          run: cutSelection,
        },
        {
          label: t('Copy'),
          ...keyed('fixed.copy'),
          disabled: !selected,
          run: copySelection,
        },
        // Paste, which reads the clipboard rather than riding on a paste event -
        // a menu row has none. Rich by default and plain on the row below it, the
        // same two the keyboard offers.
        {
          label: t('Paste'),
          ...keyed('fixed.paste'),
          disabled: !writable,
          run: onView(pasteHere),
        },
        {
          label: t('Paste as plain text'),
          ...keyed('edit.paste-plain'),
          disabled: !writable,
          run: onView(pastePlain),
        },
        DIVIDER,
        {
          label: t('Select all'),
          ...keyed('edit.select-all'),
          disabled: !view,
          run: () => view?.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        },
        DIVIDER,
        {
          label: t('Find'),
          ...keyed('edit.find'),
          asks: true,
          disabled: !view,
          run: onView(openFind),
        },
        {
          label: t('Replace'),
          ...keyed('edit.replace'),
          asks: true,
          disabled: !writable,
          run: onView(openReplace),
        },
        // The keys every editor walks its matches with, as rows where there is a
        // keyboard to learn them from. A Mac's menu bar puts the four in a submenu.
        ...(viewport.touch
          ? []
          : [
              {
                label: t('Find next'),
                ...keyed('edit.find-next'),
                disabled: !view,
                run: onView(findNext),
              },
              {
                label: t('Find previous'),
                ...keyed('edit.find-previous'),
                disabled: !view,
                run: onView(findPrevious),
              },
            ]),
        {
          label: t('Search'),
          ...keyed('app.search'),
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
          ...keyed('format.bold'),
          disabled: !writable,
          run: () => run(view, toggleWrap('**')),
        },
        {
          label: t('Italic'),
          ...keyed('format.italic'),
          disabled: !writable,
          run: () => run(view, toggleWrap('*')),
        },
        {
          label: t('Strikethrough'),
          ...keyed('format.strikethrough'),
          disabled: !writable,
          run: () => run(view, toggleWrap('~~')),
        },
        {
          label: t('Highlight'),
          ...keyed('format.highlight'),
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
          ...keyed('format.code'),
          disabled: !writable,
          run: () => run(view, toggleWrap('`')),
        },
        { label: t('Inline math'), disabled: !writable, run: () => run(view, toggleWrap('$')) },
        { label: t('Superscript'), disabled: !writable, run: () => run(view, toggleWrap('^')) },
        { label: t('Subscript'), disabled: !writable, run: () => run(view, toggleWrap('~')) },
        DIVIDER,
        {
          label: t('Link'),
          ...keyed('format.link'),
          disabled: !writable,
          run: () => run(view, insertLink),
        },
        edit('format.comment', t('Comment'), insertComment),
        DIVIDER,
        {
          label: t('Clear formatting'),
          ...keyed('format.clear'),
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
          ...keyed('app.palette'),
          asks: true,
          run: () => context.onpalette(),
        },
        DIVIDER,
        {
          label: t('Reading'),
          ...keyed('app.reading'),
          checked: !!workspace.active?.reading,
          disabled: workspace.active?.kind !== 'note',
          run: () => workspace.toggleReading(),
        },
        {
          label: t('Present'),
          ...keyed('app.present'),
          checked: present.on,
          disabled: !present.on && !present.available,
          run: () => present.toggle(),
        },
        {
          label: t('Read-only'),
          ...keyed('app.read-only'),
          checked: modes.readOnly,
          run: () => modes.toggleReadOnly(view),
        },
        {
          label: t('Source mode'),
          ...keyed('app.source'),
          checked: modes.source,
          run: () => modes.toggleSource(view),
        },
        {
          label: t('Typewriter mode'),
          ...keyed('app.typewriter'),
          checked: modes.typewriter,
          run: () => modes.toggleTypewriter(view),
        },
        {
          label: t('Focus mode'),
          ...keyed('app.focus'),
          checked: modes.focus,
          run: () => modes.toggleFocus(view),
        },
        // The document and nothing else: the file list and both bars
        // leave. The same command the key is bound to; see fullscreen.svelte.ts.
        {
          label: t('Fullscreen'),
          ...keyed('app.fullscreen'),
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
                ...keyed('pane.split-right'),
                disabled: !workspace.canSplit('row'),
                run: () => workspace.split('row'),
              },
              {
                label: t('Split down'),
                ...keyed('pane.split-down'),
                disabled: !workspace.canSplit('column'),
                run: () => workspace.split('column'),
              },
              {
                label: t('Other pane'),
                ...keyed('pane.focus-next'),
                disabled: workspace.panes.count < 2,
                run: () => workspace.panes.focusNext(),
              },
              DIVIDER,
            ]),
        {
          label: t('Show sidebar'),
          ...keyed('app.sidebar'),
          checked: !!workspace.panel,
          run: () => workspace.toggleSidebar(),
        },
        {
          label: t('Right sidebar'),
          ...keyed('app.right-sidebar'),
          checked: !!workspace.rightPanel,
          disabled: !workspace.right.length,
          run: () => workspace.toggleSidebar('right'),
        },
        {
          label: t('Files'),
          ...keyed('app.files'),
          run: () => workspace.showPanel('tree'),
        },
        { label: t('Outline'), run: () => workspace.showPanel('outline') },
        { label: t('Ask'), ...keyed('app.ask'), run: () => workspace.showPanel('ask') },
        DIVIDER,
        // Folding is a view operation, so these rows stand whether the note can
        // be written in or not.
        { label: t('Fold'), ...keyed('view.fold'), run: () => run(view, toggleFold) },
        {
          label: t('Fold everything'),
          ...keyed('view.fold-all'),
          run: () => run(view, foldHeadings),
        },
        {
          label: t('Fold more'),
          ...keyed('view.fold-more'),
          run: () => run(view, foldMore),
        },
        {
          label: t('Fold less'),
          ...keyed('view.fold-less'),
          run: () => run(view, foldLess),
        },
        {
          label: t('Unfold everything'),
          ...keyed('view.unfold-all'),
          run: () => run(view, unfoldEverything),
        },
        DIVIDER,
        { label: t('Zoom in'), ...keyed('app.zoom-in'), run: () => modes.stepZoom(1) },
        {
          label: t('Zoom out'),
          ...keyed('app.zoom-out'),
          run: () => modes.stepZoom(-1),
        },
        {
          label: t('Actual size'),
          ...keyed('app.zoom-reset'),
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
          asks: !account.user,
          run: () => (account.user ? void account.signOut() : (account.open = true)),
        },
        DIVIDER,
        // Through the store, so what it finds is offered rather than downloaded
        // in silence; see updates.svelte.ts.
        ...(isDesktop
          ? [{ label: t('Check for updates'), asks: true, run: () => void updates.check() }]
          : []),
        { label: t('What is new'), run: () => void openExternal(RELEASES_URL) },
        { label: t('Report an issue'), run: () => void openExternal(ISSUES_URL) },
        { label: t('Source code'), run: () => void openExternal(SOURCE_URL) },
      ],
    },
  ]
}
