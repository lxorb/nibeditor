import {
  CODE_PALETTES,
  deleteLine,
  duplicateBlock,
  EditorView,
  expandSelection,
  foldHeadings,
  foldLess,
  foldMore,
  insertCallout,
  insertAiBlock,
  insertChart,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertPageBreak,
  insertSlideBreak,
  insertTableToEdit,
  insertLineAbove,
  insertToc,
  joinLines,
  lowerCase,
  moveBlockDown,
  moveBlockUp,
  reformatDocument,
  reverseLines,
  selectWord,
  setHeading,
  shiftHeading,
  shrinkSelection,
  type SlashBlock,
  sortLines,
  type StateCommand,
  titleCase,
  toggleBulletList,
  toggleFold,
  toggleOrderedList,
  toggleQuote,
  toggleTaskList,
  type Transaction,
  unfoldEverything,
  upperCase,
} from '@nib/editor'
import { deckOf, slideAt } from '@nib/markdown/slides'
import { present } from './slides/present.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { composerCommands } from './composer-commands'
import { key, t } from './i18n.svelte'
import { links } from './link-index.svelte'
import type { MenuItem } from './menu-item'
import type { Exportable } from './export/formats'
import { look, openTarget, renderOptions } from './export/context'
import { type ExportId, exportKindOf, isNoteFormat, labelOf, offeredBy } from './export/offer'
import type { RunOptions } from './export/run'
import { PANDOC_FORMATS } from './export-formats'
import { canPrint, printNote } from './export/print'
import { imagePath } from './images'
import { canDictate, dictating, toggleDictation } from './mobile/dictation'
import { canInsertPicture, canTakePhoto, insertPicture, takePhoto } from './insert-picture'
import {
  canRecord,
  canTakeMeetingNotes,
  meeting,
  meetingLabel,
  record,
  recordLabel,
} from './recorder/commands'
import { moveTargets } from './move-targets'
import { closeAfterLabel } from './workspace/closing-around'
import { prompt } from './prompt.svelte'
import { revealPanel, stepRegionFocus } from './focus'
import { newSpace, publishSpace, shareSpace, stepSpace } from './space-actions'
import { spacePicker } from './space-picker.svelte'
import { askQuickly } from './ai/quick-door'
import { isScratchpad, toggleScratchpad } from './scratchpad/is'
import { canPublish, canShare, canShareItem, shareThisFile } from './sharing.svelte'
import { archiveEntry, DIVIDER } from './menu.svelte'
import { updates } from './updates.svelte'
import { modes } from './modes.svelte'
import { PROPERTIES_MODES } from '@nib/markdown/properties'
import { PROPERTIES_WORDS } from './properties-words'
import { settings } from './settings.svelte'
import { touchedBy } from './agents/docs/touched'
import { agentMarks } from './agent-marks.svelte'
import { shortcuts } from './shortcuts.svelte'
import { toggleFill } from './tab-fill/fill'
import { closeWindow, invoke, isDesktop, isNative } from './tauri'
import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
import { theme } from './theme.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'
import { samePath } from './space-paths'
import { isUnsaved } from './workspace/drafts'
import { askPlace } from './save-place/door'
import { pages, type Step } from './web-tab/pages.svelte'
import { openRandomNote, randomChoices } from './random-note'

/** Opens `custom.css` in the editor itself - it is a text file like any other. */
async function openCustomCss() {
  if (!isNative) return

  const path = await invoke<string>('custom_css_path')
  await workspace.open(path)
}

/** Opens `snippets.json`, and reloads it once the file is saved. */
async function openSnippets() {
  if (!isNative) return

  const path = await invoke<string>('snippets_path')
  await workspace.open(path)
}

/** Export entries: what this document goes out as, in the fixed order its kind
 *  keeps, then the variants, then the paper.
 *
 *  Which rows those are is offer.ts, read here and nowhere else, so the File
 *  menu, the palette and a key on the keyboard cannot come to different answers
 *  about a canvas. The pandoc formats only appear when pandoc is installed and
 *  the document is a note, so the list never offers something that cannot work;
 *  everything above them works on every build with nothing installed. */
export function exportCommands(): Command[] {
  // Not in the plugin, which cannot save a file: a WebView on a phone has nowhere
  // to put one. Answered before anything else so the bundler takes the whole of
  // what is below with it - the renderers, the document libraries, and the URLs
  // and `new Function` calls the store's review found in them. See
  // vite.even.config.ts.
  if (__EVEN_PLUGIN__) return []

  const note = () => workspace.active
  // Flushed first: the editor's last few keystrokes are still a rope until
  // something asks for them as text, and an export is asking. Only ever from a
  // row's `run`, never while the rows are built; see `kind` below.
  const source = () => {
    workspace.flush()
    return note()?.doc ?? ''
  }
  const name = () => note()?.name ?? 'Untitled.md'
  const target = openTarget

  /** What is open, which is what decides the rows. Read once: the list is built
   *  fresh every time the menu or the palette opens, and a document does not
   *  become another kind while its own menu is on screen.
   *
   *  Read rather than flushed. The palette builds this list inside a derivation,
   *  where a write throws and the palette never opens; the flush belongs to the
   *  export, which `source` makes when a row is run. */
  const open = note()
  const kind = exportKindOf(
    open ? { kind: open.kind, path: open.path, text: open.note.latest } : null,
  )

  /** Everything an export needs beyond the note: paper, colours, where the
   *  pictures it names actually are, and where its links point. Shared with
   *  printing, which is the same page through the same renderer; see
   *  export/context.ts. */
  const options = (): Promise<RunOptions> => renderOptions(target())

  /** The note, one of the ten formats or a variant of one. */
  const noteOut = async (id: Exportable) => {
    const m = await import('./export/run')
    await m.runExport(id, target(), await options())
  }

  /** The deck: one file that turns its own pages, or one sheet of paper per
   *  slide. Both come out of the slides code, which builds them from one page. */
  const slidesOut = async (id: 'slides-html' | 'slides-pdf') => {
    const m = await import('./slides/file')
    const deck = { text: source(), path: note()?.path ?? null }
    const options = {
      resolveImage: (src: string) => imagePath(src, note()?.path, source()) ?? src,
      ...(await look()),
    }

    if (id === 'slides-html') await m.exportDeck(deck, name(), options)
    else await m.exportDeckPdf(deck, name(), options)
  }

  /** The plane, drawn. One SVG, and the PNG and the PDF made out of it; see
   *  canvas/picture.ts, which is where the context menu on the plane goes too. */
  const drawingOut = async (id: ExportId) => {
    const [picture, { drawingOf }] = await Promise.all([
      import('./canvas/picture'),
      import('./export/drawing'),
    ])

    const drawing = drawingOf({
      text: source(),
      name: name(),
      path: note()?.path ?? null,
      root: workspace.activeSpace?.root ?? null,
    })

    if (id === 'png') await picture.exportCanvasPng(drawing)
    else if (id === 'svg') await picture.exportCanvasSvg(drawing)
    else if (id === 'pdf') await picture.exportCanvasPdf(drawing)
  }

  /** The pages, out: one PDF of the whole note, or one file per page in a zip. The
   *  same three words a drawing offers and a page each rather than one picture;
   *  see pages/out.ts. */
  const pagesOut = async (id: ExportId) => {
    const out = await import('./pages/out')
    const about = out.pagesOutOf({
      text: source(),
      name: name(),
      path: note()?.path ?? null,
      root: workspace.activeSpace?.root ?? null,
    })

    if (id === 'pdf') await out.exportPagesPdf(about)
    else if (id === 'png') await out.exportPagesPng(about)
    else if (id === 'svg') await out.exportPagesSvg(about)
  }

  /** A paper or a picture the app is only showing, handed over as it stands. */
  const copyOut = async () => {
    const path = note()?.path
    if (path === null || path === undefined) return

    const m = await import('./export/copy')
    await m.saveCopy(path, name())
  }

  /** One export, behind the line at the top of the document: rendering a note
   *  and handing it to the system takes a moment with nothing on screen to show
   *  for it. See busy.svelte.ts.
   *
   *  Whose code answers is the kind's business. A drawing is drawn even when the
   *  row says PNG, which is the same word a note's picture goes out under: one
   *  row, one meaning, and the document decides what it is a picture of. */
  const run = (id: ExportId) => () =>
    busy.start(t('Exporting'), async () => {
      if (kind === 'canvas') await drawingOut(id)
      else if (kind === 'pages') await pagesOut(id)
      else if (id === 'slides-html' || id === 'slides-pdf') await slidesOut(id)
      else if (id === 'copy') await copyOut()
      else if (isNoteFormat(id)) await noteOut(id)
    })

  const offered = offeredBy(kind)
  // Nothing here goes out as anything: the graph of a space, or a pane with
  // nothing in it. The rows a note would have are shown greyed out rather than
  // taken away, so the Export menu keeps its shape and says no the way Rename
  // already does with no note open.
  const nothing = offered.length === 0
  /** Whether these are a note's rows, which is what the paper and pandoc are for.
   *  A drawing has no paper, and a copy is the bytes that are already there. */
  const asNote = kind === 'note' || kind === 'deck' || nothing

  const commands: Command[] = (nothing ? offeredBy('note') : offered).map((id) => ({
    id: `export-${id}`,
    label: labelOf(id),
    hint: shortcuts.hint(`export.${id}`),
    disabled: nothing,
    run: run(id),
  }))

  if (asNote) {
    commands.push({
      id: 'page-setup',
      label: t('Page setup for export'),
      run: () => settings.show('export'),
    })
  }

  if (!settings.pandoc) return commands

  // Pandoc converts markdown, so it has as little to say about a drawing as Word
  // has. A note's rows get pandoc's; the other kinds keep their own.
  if (!asNote) return commands

  for (const format of PANDOC_FORMATS) {
    commands.push({
      id: `export-${format.id}`,
      label: t('Export as {format}', { format: t(format.label) }),
      disabled: nothing,
      run: () =>
        busy.start(t('Exporting'), async () => {
          const m = await import('./export')
          await m.exportPandoc(source(), name(), format.id)
        }),
    })
  }

  return commands
}

/** Notes from another app, and documents of every other kind: one row, which
 *  opens the import sheet.
 *
 *  A row in File rather than in Export, because importing makes notes of its own
 *  and has nothing to do with what is open. It is the way a document that is not
 *  yet a note becomes one: nib opens nothing from outside its spaces, so a file
 *  from elsewhere comes in as a copy.
 *
 *  Always there, on every platform. What can be read is a question about the file
 *  the reader is holding, and the sheet answers it once the file is in; a row that
 *  appears only where pandoc happens to be installed answers it before they have
 *  even said what they have. */
function importCommand(): Command | null {
  // Not in the plugin, which has no file to be given and nowhere to pick one
  // from. Answered before anything else so the bundler takes the whole of the
  // import with it: the readers, the zip library and the HTML converter. See
  // vite.even.config.ts.
  if (__EVEN_PLUGIN__) return null

  return {
    id: 'import',
    label: t('Import'),
    run: () => {
      void import('./importing.svelte').then(({ importing }) => importing.show())
    },
  }
}

/** Shows the log file in the file manager, for when something has gone wrong. */
async function openLog() {
  if (!isDesktop) return

  const path = await invoke<string>('log_dir')
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path)
}

/** Reveals the folder a `.css` theme should be dropped into. */
async function openThemesFolder() {
  if (!isDesktop) return

  const dir = await invoke<string>('theme_dir')
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(dir)
  await theme.reload()
}

/** A row of the palette: a menu row with a name of its own, which is what a
 *  shortcut is bound to and what the toolbar remembers. Everything else about it -
 *  the label, the hint, the tick, the greying out - is what a row is anywhere; see
 *  menu-item.ts, which is why the app menu can pass one straight through. */
export interface Command extends MenuItem {
  id: string
  /** Whether only somebody at the keyboard may run it: the palette, a key, a menu
   *  row, the command line on this machine - and never a `nib://` link.
   *
   *  A link can be written by anybody and sent to anybody, and following one is a
   *  click. So what a link may ask for is what a person clicking about in the app
   *  could undo in a moment; see automation/verbs.ts, which is where the four
   *  actions a link may name are settled. This is the exception inside the one
   *  action that is a whole list: `nib://command?id=…` reaches the palette, and a
   *  handful of those rows turn on a microphone, open a camera or sign somebody
   *  out - none of which is a thing to hand a page on the web. */
  byHand?: boolean
  /** Whether only the window's own hands may run it: the palette, a key, a menu row -
   *  and never the command line or a link, whoever wrote either. A terminal is a shell
   *  on this machine, and a verb that opened one would be a way for another program to
   *  type into it; see docs/terminal.md and `runCommand` in automation/acts.ts. */
  ownWindow?: boolean
}

/** Move to space, fetched with the press; see tab-strip/to-space.ts. */
const toSpace = () => import('./tab-strip/to-space')

/** Fetched as the launch ends; see `warmDoors`. */
const tabOps = () => import('./tab-strip/ops')

/** Taking back what an agent wrote into the note in front: everything that agent did
 *  to it this session, as one step, mapped round whatever the reader wrote since. A
 *  row per agent with edits here, and none at all while no agent has written in it;
 *  see docs/agent-native.md 8.5. What does it is fetched on the press. */
function agentUndoRows(): Command[] {
  const path = workspace.active?.path
  if (__EVEN_PLUGIN__ || !path) return []

  return touchedBy(path).map((agent) => ({
    id: `agent-undo:${agent.id}`,
    label: t('Undo edits by {name}', { name: agent.name }),
    run: () => void import('./agents/docs').then((docs) => docs.undoAgentIn(agent, path)),
  }))
}

/** The agents' panel and the stop, from the first agent heard in this run: before
 *  that there is nothing to show and nobody to stop. The stop is the window's own - a
 *  link or another program is not the reader pressing it. See lib/agents/ui. */
function agentRows(): Command[] {
  if (__EVEN_PLUGIN__ || !agentMarks.heard) return []

  return [
    { id: 'agents-panel', label: t('Agents'), run: () => revealPanel('agents') },
    {
      id: 'agents-stop',
      label: t('Stop agents'),
      hint: shortcuts.hint('agents.stop'),
      ownWindow: true,
      run: () => void import('./agents/ui/index').then((ui) => ui.stopAgents()),
    },
  ]
}

/** Putting away what is open, or taking it back: one row saying which, the words
 *  the menus use. No default key, for the reason Footnotes has none: a gesture made
 *  now and then, in a keyboard full of ones made constantly. See archiving.ts. */
function archiveCommand(): Command[] {
  return archiveEntry(workspace.active?.path).flatMap((entry) =>
    entry === DIVIDER ? [] : [{ id: 'archive', label: entry.label, run: entry.run }],
  )
}

/** A tab's own menu, about the tab being read; see tab-strip/menu.ts. */
function tabCommands(): Command[] {
  const id = workspace.activeTabId ?? ''
  const tab = workspace.active

  return [
    {
      id: 'close-right',
      label: closeAfterLabel(),
      hint: shortcuts.hint('app.close-right'),
      disabled: workspace.closesAround(id, 'right') === 0,
      run: () => void workspace.closeAround(id, 'right'),
    },
    {
      id: 'close-all',
      label: t('Close all tabs'),
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(id, 'all') === 0,
      run: () => void workspace.closeAround(id, 'all'),
    },
    {
      id: 'deselect-tab',
      label: t('Deselect tab'),
      hint: shortcuts.hint('app.deselect-tab'),
      disabled: !tab,
      run: () => workspace.deselect(),
    },
    {
      id: 'deselect-all',
      label: t('Deselect all tabs'),
      hint: shortcuts.hint('app.deselect-all'),
      disabled: !workspace.tabs.some((one) => workspace.panes.at(one.paneId)),
      run: () => workspace.deselectAll(),
    },
    {
      id: 'duplicate-tab',
      label: t('Duplicate tab'),
      hint: shortcuts.hint('app.duplicate-tab'),
      disabled: !tab || !workspace.canDuplicateTab(tab),
      run: () => void tabOps().then((ops) => ops.duplicateTab(id)),
    },
    {
      id: 'rename',
      label: t('Rename'),
      hint: shortcuts.hint('tabs.rename'),
      disabled: !tab || !workspace.canRenameFromTab(tab),
      run: () => void tabOps().then((ops) => ops.renameFromTab(id)),
    },
    // Left out with one space, but for the scratchpad, which becomes a note in the one
    // there is; see tab-strip/to-space.ts, fetched with the press.
    ...(tab && (workspace.spaces.length > 1 || isScratchpad(tab.path))
      ? [
          {
            id: 'move-to-space',
            label: t('Move to space'),
            run: () => void toSpace().then((one) => one.askSpace([id])),
          },
        ]
      : []),
  ]
}

/** A browser's rows about the page in front: reload, and Stop only while one is
 *  coming; find, Mute site and the developer tools. None in the plugin, whose phone
 *  has no web tab: left out of its package, which is at its ceiling; see
 *  even/bundle.test.ts. */
function webCommands(): Command[] {
  if (__EVEN_PLUGIN__) return []

  const tab = workspace.active
  if (!isDesktop || tab?.kind !== 'web') return []

  const page = pages.of(tab.id)
  const rows: [Step, string, string][] = [
    ['reload', t('Reload'), 'web.reload'],
    ['fresh', t('Hard reload'), 'web.fresh'],
  ]
  if (page.loading) rows.push(['stop', t('Stop'), 'web.stop'])
  return [
    ...rows.map(([step, label, key]) => ({
      id: `web-${step}`,
      label,
      hint: shortcuts.hint(key),
      run: () => void pages.step(tab.id, step),
    })),
    {
      id: 'web-find',
      label: t('Find'),
      hint: shortcuts.hint('edit.find'),
      run: () => (page.find.open = true),
    },
    {
      id: 'web-mute',
      label: page.muted ? t('Unmute site') : t('Mute site'),
      hint: shortcuts.hint('web.mute'),
      run: () => void import('./web-tab/mute').then((one) => one.muteSite(tab.id, !page.muted)),
    },
    {
      id: 'web-clear-data',
      label: t('Delete browsing data'),
      hint: shortcuts.hint('web.clear-data'),
      run: () =>
        void import('./web-tab/clearing-asked.svelte').then((one) => one.clearingAsked.ask(tab.id)),
    },
    {
      id: 'web-devtools',
      label: t('Developer tools'),
      hint: shortcuts.hint('web.devtools'),
      run: () => void invoke('web_devtools', { tab: tab.id }).catch(() => undefined),
    },
  ]
}

/** Splitting, moving between panes, and closing one. Left out entirely on a
 *  phone, which shows one note at a time and has no panes to talk about. */
function paneCommands(): Command[] {
  if (viewport.touch) return []

  return [
    {
      id: 'split-right',
      label: t('Split right'),
      hint: shortcuts.hint('pane.split-right'),
      disabled: !workspace.canSplit('row'),
      run: () => workspace.split('row'),
    },
    {
      id: 'split-down',
      label: t('Split down'),
      hint: shortcuts.hint('pane.split-down'),
      disabled: !workspace.canSplit('column'),
      run: () => workspace.split('column'),
    },
    {
      id: 'move-tab-pane',
      label: t('Move to other pane'),
      hint: shortcuts.hint('pane.move-tab'),
      disabled: !workspace.canMoveToOtherPane(workspace.activeTabId ?? ''),
      run: () => void tabOps().then((ops) => ops.moveToOtherPane(workspace.activeTabId ?? '')),
    },
    {
      id: 'focus-pane',
      label: t('Other pane'),
      hint: shortcuts.hint('pane.focus-next'),
      disabled: workspace.panes.count < 2,
      run: () => workspace.panes.focusNext(),
    },
    // Stacking the focused pane's notes as columns side by side. A pane's own answer,
    // so the row acts on the focused one - the same pane every other row here acts on -
    // and says which way it goes. Greyed where there is nothing to stack: one note in
    // the pane, or a machine that holds one document. See `canStack` in
    // workspace.svelte.ts, which the pane's own menu reads too.
    {
      id: 'stack-tabs',
      label: workspace.stacked() ? t('Unstack tabs') : t('Stack tabs'),
      checked: workspace.stacked(),
      disabled: !workspace.canStack(),
      run: () => workspace.toggleStacked(),
    },
    {
      id: 'close-pane',
      label: t('Close this pane'),
      disabled: workspace.panes.count < 2,
      run: () => void workspace.closePane(),
    },
  ]
}

/** Arrangements: keeping this one under a name, going back to one, and letting
 *  one go. A saved layout reads as what it will do - "Layout: reading" - so the
 *  palette needs no heading to say what the row is. */
function layoutCommands(): Command[] {
  if (viewport.touch) return []

  const saved = workspace.layouts.all

  return [
    {
      id: 'save-layout',
      label: t('Save layout'),
      run: () => void askForLayoutName(),
    },
    ...saved.map((one) => ({
      id: `layout:${one.name}`,
      label: t('Layout: {name}', { name: one.name }),
      run: () => void workspace.useLayout(one.name),
    })),
    {
      id: 'delete-layout',
      label: t('Delete a layout'),
      disabled: !saved.length,
      run: () => void askWhichLayoutToDelete(),
    },
  ]
}

async function askForLayoutName() {
  const name = await prompt.ask({
    title: t('Name this layout'),
    placeholder: t('Reading'),
    confirmLabel: key('Save'),
  })

  if (name) workspace.saveLayout(name)
}

async function askWhichLayoutToDelete() {
  const chosen = await prompt.find({
    title: t('Delete a layout'),
    options: workspace.layouts.all.map((one) => ({ id: one.name, label: one.name })),
  })

  if (chosen) workspace.layouts.remove(chosen)
}

/** Presenting a deck, and the three things a deck needs while it is written.
 *
 *  A note becomes a deck by having a rule in it, so New slide is the way in and
 *  is offered for any note; the rest only make sense once there are slides. */
function slideCommands(view?: EditorView): Command[] {
  return [
    {
      id: 'present',
      label: present.on ? t('Leave presenting') : t('Present'),
      hint: shortcuts.hint('app.present'),
      disabled: !present.on && !present.available,
      run: () => present.toggle(),
    },
    {
      id: 'new-slide',
      label: t('New slide'),
      disabled: !view || view.state.readOnly,
      run: () => {
        if (!view) return
        insertSlideBreak({ state: view.state, dispatch: (one) => view.dispatch(one) })
        view.focus()
      },
    },
    {
      id: 'next-slide',
      label: t('Next slide'),
      disabled: !view || !present.available,
      run: () => view && stepSlide(view, 1),
    },
    {
      id: 'previous-slide',
      label: t('Previous slide'),
      disabled: !view || !present.available,
      run: () => view && stepSlide(view, -1),
    },
  ]
}

/** Fold, one level more, one level less, fold everything, unfold everything -
 *  the whole of folding, as five rows. What each of them does and why there are
 *  five is in fold.ts.
 *
 *  The two level rows are here and on no chord, which is where Obsidian leaves
 *  them too: they are the press somebody makes while reading rather than while
 *  writing, and a reader who wants a key for one can put it there in Settings. */
function foldingCommands(view?: EditorView): Command[] {
  const fold = (id: string, label: string, command: StateCommand): Command => ({
    id,
    label,
    hint: shortcuts.hint(id),
    disabled: !view,
    run: () => {
      if (!view) return
      // The view itself, not a state and a dispatch made out of it: a fold moves
      // the lines it hides out of sight before it lands, and only something
      // holding the view can move anything. See fold-motion.ts in @nib/editor.
      command(view)
      view.focus()
    },
  })

  return [
    fold('view.fold', t('Fold'), toggleFold),
    fold('view.fold-all', t('Fold everything'), foldHeadings),
    fold('view.fold-more', t('Fold more'), foldMore),
    fold('view.fold-less', t('Fold less'), foldLess),
    fold('view.unfold-all', t('Unfold everything'), unfoldEverything),
  ]
}

/** The lines and the letters: the rows for what a code editor does to lines, to
 *  case, and to the selection a step at a time. Here as well as on their keys -
 *  most of them have none - because the palette is where somebody looks for a
 *  thing they know from another editor. The grip's Duplicate and Move rows are here
 *  too, for the block the caret is in. See lines.ts, case.ts, grow.ts and
 *  block/commands.ts in the editor package.
 *
 *  The selection rows only move the selection, so a note nobody may write in still
 *  offers them; the rest write, and are greyed out there. */
function lineCommands(view?: EditorView): Command[] {
  const row = (
    id: string,
    label: string,
    command: (view: EditorView) => boolean,
    writes = true,
  ): Command => ({
    id,
    label,
    hint: shortcuts.hint(id),
    disabled: !view || (writes && view.state.readOnly),
    run: () => {
      if (!view) return
      command(view)
      view.focus()
    },
  })

  return [
    row('edit.expand-selection', t('Expand the selection'), expandSelection, false),
    row('edit.shrink-selection', t('Shrink the selection'), shrinkSelection, false),
    // Typora's Ctrl+D, which has no key now that Ctrl+D puts the tab down.
    row('edit.select-word', t('Select the word, then the next'), selectWord, false),
    row('edit.insert-line-above', t('Insert a line above'), insertLineAbove),
    row('edit.delete-line', t('Delete the line'), deleteLine),
    row('edit.join-lines', t('Join the lines'), joinLines),
    row('edit.sort-lines', t('Sort the lines'), sortLines),
    row('edit.reverse-lines', t('Reverse the lines'), reverseLines),
    row('edit.upper-case', t('Upper case'), upperCase),
    row('edit.lower-case', t('Lower case'), lowerCase),
    row('edit.title-case', t('Title case'), titleCase),
    row('edit.duplicate-block', t('Duplicate the block'), duplicateBlock),
    row('edit.move-block-up', t('Move the block up'), moveBlockUp),
    row('edit.move-block-down', t('Move the block down'), moveBlockDown),
  ]
}

/** One block a note can be written out of.
 *
 *  `apply` takes the view rather than closing over one, because the same block
 *  is offered in three places and one of them - the editor's `/` menu - runs it
 *  against whichever pane it opened in, which is not always the pane the row was
 *  built for. `label` is a thunk for the same reason it is in the shortcut
 *  registry: the words follow the language without the list being rebuilt.
 *
 *  The view may be absent, and each row says for itself what that means. Almost all
 *  of them write into a note and do nothing without one, which is the state `ready`
 *  greys them out in anyway. A couple act on the window instead: recording opens a
 *  microphone and makes its own note if it has to, and that is what lets a row be run
 *  by its id from somewhere with no editor at all - the Android quick settings tile. */
interface Block {
  id: string
  label: () => string
  apply: (view?: EditorView) => void
  /** Whether a view can take it. A block writes, so the default is a view that
   *  is not read-only. */
  ready?: (view: EditorView | undefined) => boolean
  /** Whether a link may never ask for it; see `Command.byHand`. Every row here
   *  writes in the note and needs none - except the three that reach for a
   *  microphone or a camera. */
  byHand?: boolean
}

/** A state command as something to do to a view. */
function on(command: StateCommand) {
  return (view?: EditorView) => {
    if (!view) return

    command({ state: view.state, dispatch: (one: Transaction) => view.dispatch(one) })
    view.focus()
  }
}

function block(id: string, label: () => string, command: StateCommand): Block {
  return { id, label, apply: on(command) }
}

/** Every block and mark a note is written out of, as one list.
 *
 *  Three ways in read from this and nothing else: the Paragraph menu, the
 *  command palette, and the `/` menu in the editor. A row in one of them and not
 *  the others is a thing you can only reach if you already know where it is, and
 *  a second list is how that happens. The ids are the shortcut ids, so a row's
 *  key and its words can never say different things.
 *
 *  In the order the Paragraph menu shows them, which is the order the `/` menu
 *  offers them in before anything is typed. */
const BLOCKS: Block[] = [
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    block(`paragraph.heading-${level}`, () => t('Heading {level}', { level }), setHeading(level)),
  ),
  block('paragraph.body', () => t('Paragraph'), setHeading(0)),
  block('paragraph.heading-up', () => t('One heading level up'), shiftHeading(1)),
  block('paragraph.heading-down', () => t('One heading level down'), shiftHeading(-1)),
  // Not through `on`: a new table takes the focus into its first cell, and
  // focusing the editor afterwards would take it straight back out.
  {
    id: 'paragraph.table',
    label: () => t('Table'),
    apply: (view) => {
      if (view) insertTableToEdit(view)
    },
  },
  block('paragraph.code-block', () => t('Code block'), insertCodeFence),
  block('paragraph.quote', () => t('Quote'), toggleQuote),
  block('paragraph.math-block', () => t('Math block'), insertMathBlock),
  block('paragraph.chart', () => t('Chart'), insertChart),
  // A question for a model, as a block of the note. No key of its own: the answer
  // is asked for with the glyph on the fence, and a key that only wrote an empty
  // fence would be a key for half the gesture. See ai/block.ts in the editor
  // package for what the block and its answer look like in the file.
  block('ai-block', () => t('AI block'), insertAiBlock),
  block('paragraph.callout', () => t('Callout'), insertCallout),
  block('paragraph.bullet-list', () => t('Bulleted list'), toggleBulletList),
  block('paragraph.ordered-list', () => t('Numbered list'), toggleOrderedList),
  block('paragraph.task-list', () => t('Task list'), toggleTaskList),
  // The picker is the app's, not the editor's, and it has its own reason to be
  // greyed out: a note it can write beside. No key either, since the one that
  // looks like it writes empty picture markup rather than choosing a file.
  {
    id: 'picture',
    label: () => t('Picture'),
    apply: (view) => {
      if (view) void insertPicture(view)
    },
    ready: (view) => canInsertPicture(view),
  },
  // The same picture from the other end: the camera rather than the files. Only
  // where there is a camera behind the glass, which is what `canTakePhoto` asks,
  // so a desktop is not offered a row that would open the file chooser twice.
  {
    id: 'photo',
    label: () => t('Photo'),
    apply: (view) => {
      if (view) void takePhoto(view)
    },
    ready: (view) => canTakePhoto(view),
    byHand: true,
  },
  // Saying it instead of typing it. One row for both states, because there is one
  // thing to press and the line across the top is what says which; see
  // mobile/dictation.ts.
  {
    id: 'dictate',
    label: () => (dictating() ? t('Stop') : t('Dictate')),
    apply: (view) => {
      if (view) void toggleDictation(view)
    },
    ready: (view) => canDictate(view),
    byHand: true,
  },
  // And the microphone kept as sound, as two rows beside the picture: the same kind
  // of thing, which is something of the reader's own put into the note rather than
  // markup written into it. Both read as what they will do next, because one press
  // starts and the next stops; neither needs a note open, because either will make
  // one. See recorder/commands.ts, which is what the quick settings tile on Android
  // calls by these very ids.
  { id: 'record', label: recordLabel, apply: () => void record(), ready: canRecord, byHand: true },
  {
    id: 'meeting',
    label: meetingLabel,
    apply: () => void meeting(),
    ready: canTakeMeetingNotes,
    byHand: true,
  },
  block('format.link', () => t('Link'), insertLink),
  block('paragraph.footnote', () => t('Footnote'), insertFootnote),
  block('paragraph.toc', () => t('Table of contents'), insertToc),
  block('paragraph.front-matter', () => t('Front matter'), insertFrontMatter),
  block('format.comment', () => t('Comment'), insertComment),
  block('paragraph.rule', () => t('Horizontal rule'), insertHorizontalRule),
  // A new slide is a rule with a blank line above it, which is what breaks a
  // deck into its next one; see packages/markdown/src/slides.ts.
  block('slide-break', () => t('New slide'), insertSlideBreak),
  block('page-break', () => t('Page break'), insertPageBreak),
]

export function blockCommands(view?: EditorView): Command[] {
  return BLOCKS.map((one) => {
    const hint = shortcuts.hint(one.id)
    const ready = one.ready ? one.ready(view) : !!view && !view.state.readOnly

    return {
      id: one.id,
      label: one.label(),
      ...(hint === undefined ? {} : { hint }),
      ...(one.byHand === true ? { byHand: true } : {}),
      disabled: !ready,
      // The view as it was, absent and all: a row that needs one does nothing
      // without it and says so by being greyed out, and a row that acts on the
      // window - recording - runs from anywhere its id is looked up. See `Block`.
      run: () => one.apply(view),
    }
  })
}

/** The same blocks as the editor's `/` menu takes them: words and something to
 *  do to the view the menu opened in. */
export function blockRows(): SlashBlock[] {
  return BLOCKS.map((one) => ({ label: one.label(), run: one.apply }))
}

/** Puts the caret on the slide before or after the one it is in. Writing a deck
 *  is writing a note, so this moves through the note rather than opening
 *  anything: there is one editor, and the slides are places in it. */
function stepSlide(view: EditorView, direction: number) {
  const slides = deckOf(view.state.doc.toString())
  if (slides.length < 2) return

  const here = slideAt(slides, view.state.selection.main.head)
  const wanted = slides[Math.max(0, Math.min(here + direction, slides.length - 1))]
  if (!wanted) return

  view.dispatch({
    selection: { anchor: wanted.from },
    effects: EditorView.scrollIntoView(wanted.from, { y: 'start', yMargin: 72 }),
  })
  view.focus()
}

/** Everything the palette can do. Labels read as the action, not the setting. */
/** What can be done to the space that is open: handing it to somebody, and
 *  putting it on the web. Both need a space on the account and this account to
 *  own it, and both are the sheet the space's own menu opens. A list rather than
 *  a disabled row, because a command that cannot run is not a command; see
 *  `exportCommands`. */
/** Putting the note that is open somewhere else: inside another note of this
 *  space, or into another space.
 *
 *  A note used to be carried onto a square in the column of spaces, and with the
 *  column gone a pointer had no way left to move one between spaces at all - the
 *  file list drags within a space and the row's own Move is a thumb's, where
 *  there is no drag to make. So it is a command, which is also the first way the
 *  keyboard has ever had to do it. The same call the drop made, so it is the same
 *  move and the same undo. */
function moveCommand(): Command | null {
  const note = workspace.active
  const path = note?.path
  if (!path) return null

  const targets = moveTargets({
    moving: path,
    tree: workspace.tree,
    spaces: workspace.spaces,
    here: workspace.activeSpace?.root ?? null,
  })
  if (!targets.length) return null

  // Into another space the tab goes with the note, as Move to space takes it; see
  // workspace/space-move.ts.
  const moved = (into: string) => {
    const space = workspace.spaces.find((one) => samePath(one.root, into))
    if (space && space.id !== workspace.activeSpaceId) {
      return toSpace().then((one) => one.toSpace([note.id], space.id))
    }
    return workspace.moveMany([path], into)
  }

  return {
    id: 'move-note',
    label: t('Move this note'),
    run: () =>
      void prompt
        .find({ title: t('Move to'), options: [...targets] })
        .then((into) => (into ? moved(into) : undefined)),
  }
}

function spaceCommands(): Command[] {
  const space = workspace.activeSpace
  if (!space) return []

  const moving = moveCommand()

  return [
    ...(moving ? [moving] : []),
    // Which space is open. The switcher at the top of the list panel is the
    // pointer's way in; this is the keyboard's, and the only one there is while
    // the panel is shut. A row each, with the one you are in ticked, which is
    // how the palette offers every other set of things to pick from.
    ...(workspace.spaces.length > 1
      ? workspace.spaces.map((one) => ({
          id: `space:${one.id}`,
          label: t('Space: {name}', { name: one.name }),
          checked: one.id === space.id,
          run: () => void workspace.showSpace(one.id),
        }))
      : []),
    { id: 'new-space', label: t('New space'), run: () => void newSpace() },
    ...(canShare(space)
      ? [{ id: 'share', label: t('Share this space'), run: () => void shareSpace(space) }]
      : []),
    // And the one document in front of the reader, which is the other size of the
    // same act. Offered only where there is one and it can be shared; see
    // sharing.svelte.ts.
    ...(canShareItem(workspace.active?.path)
      ? [
          {
            id: 'share-note',
            label: t('Share this note'),
            run: () => void shareThisFile(workspace.active?.path ?? ''),
          },
        ]
      : []),
    ...(canPublish(space)
      ? [
          {
            id: 'publish',
            label: t('Publish this space as a blog'),
            run: () => publishSpace(space),
          },
        ]
      : []),
  ]
}

export function appCommands(view?: EditorView): Command[] {
  const imported = importCommand()

  const unsaved = workspace.active && isUnsaved(workspace.active.note) ? workspace.active : null

  return [
    // Only for a tab with no file, which is the one thing Save still means: where it
    // goes and under what name. A web tab kept as a web note is the same row. See
    // save-place/ask.ts.
    ...(unsaved
      ? [
          {
            id: 'save',
            label: t('Save'),
            hint: shortcuts.saveHint,
            run: () => askPlace(unsaved.id),
          },
        ]
      : []),
    {
      id: 'new',
      label: t('New note'),
      hint: shortcuts.hint('app.new'),
      run: () => workspace.openBlank(),
    },
    {
      id: 'new-unique',
      label: t('New unique note'),
      run: () => void workspace.createUniqueNote(settings.noteIdFormat),
    },
    { id: 'new-canvas', label: t('New canvas'), run: () => void workspace.createCanvas() },
    { id: 'new-pages', label: t('New page note'), run: () => void workspace.createPages() },
    ...(viewport.device === 'phone'
      ? []
      : [
          {
            // A row in the file list, named before it has an address: the name is the
            // title, and the bar asks where it points next. The file is a shortcut -
            // `Svelte docs.url` - which is what Explorer and every browser write; see
            // web-tab/shortcut.ts and docs/web-tabs.md.
            id: 'new-web-note',
            label: t('New web note'),
            run: () => void workspace.createWebsite(),
          },
          {
            // The other way round: a tab with an address field and nothing in it yet,
            // for somebody who has the address and no name in mind. Nothing is
            // written while it is only browsed; the row below keeps it. A phone has no
            // web tab at all - there the system browser is the answer.
            id: 'new-website',
            label: t('Open a website'),
            run: () => workspace.openWebsite(),
          },
        ]),
    // A shell in a tab, in the one Settings chose; the plus and Ctrl+T offer the others.
    // A desktop's alone, and never the glasses' plugin's. See docs/terminal.md.
    ...(!__EVEN_PLUGIN__ && isDesktop
      ? [
          {
            id: 'new-terminal',
            label: t('New terminal'),
            ownWindow: true,
            run: () => void import('./terminal/open').then(({ openTerminal }) => openTerminal()),
          },
          // Another machine's, from the host picker; see remote/picker.svelte.ts.
          {
            id: 'new-remote',
            label: t('Remote'),
            ownWindow: true,
            run: () =>
              void import('./remote/picker.svelte').then(({ hostPicker }) => hostPicker.toggle()),
          },
        ]
      : []),
    // Only where there is something to convert, which is a space that was written in
    // an older nib: a row that did nothing would be a row that read as broken. See
    // workspace.convertWebsites.
    ...(links.websiteNotes
      ? [
          {
            id: 'convert-website-notes',
            label: t('Convert website notes'),
            run: () => void workspace.convertWebsites(),
          },
        ]
      : []),
    // Greyed where there is nothing else to open: a space of one note, or of notes
    // that are all left out. See random-note.ts.
    {
      id: 'random-note',
      label: t('Random note'),
      hint: shortcuts.hint('app.random-note'),
      disabled: !randomChoices().length,
      run: () => openRandomNote(),
    },
    ...(imported ? [imported] : []),
    {
      id: 'convert-syntax',
      label: t('Convert syntax'),
      run: () => void import('./convert-syntax').then((m) => m.convertSyntax()),
    },
    ...(canPrint
      ? [
          {
            id: 'print',
            label: t('Print'),
            hint: shortcuts.hint('app.print'),
            disabled: workspace.active?.kind !== 'note',
            run: () => busy.start(t('Printing'), () => printNote()),
          },
        ]
      : []),
    {
      id: 'close',
      label: t('Close note'),
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeActive(),
    },
    ...archiveCommand(),
    ...tabCommands(),
    {
      id: 'back',
      label: t('Back'),
      hint: shortcuts.hint('app.back'),
      disabled: !workspace.active?.canGoBack,
      run: () => workspace.goBack(),
    },
    {
      id: 'forward',
      label: t('Forward'),
      hint: shortcuts.hint('app.forward'),
      disabled: !workspace.active?.canGoForward,
      run: () => workspace.goForward(),
    },
    {
      id: 'pin',
      label: workspace.active?.pinned === true ? t('Unpin') : t('Pin'),
      hint: shortcuts.hint('app.pin'),
      disabled: !workspace.active,
      run: () => {
        const id = workspace.activeTabId
        if (id) workspace.togglePin(id)
      },
    },
    {
      id: 'reopen',
      label: t('Reopen closed tab'),
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => void workspace.reopenClosed(),
    },
    { id: 'space', label: t('New space'), run: () => void newSpace() },
    ...webCommands(),
    ...paneCommands(),
    ...layoutCommands(),
    {
      id: 'new-window',
      label: t('New window'),
      hint: shortcuts.hint('app.new-window'),
      disabled: !isDesktop,
      run: () => void invoke('new_window').catch(() => undefined),
    },
    // A desktop's alone, where a web tab is a page of nib's; see web-tab/private.ts.
    {
      id: 'new-private',
      label: t('New private tab'),
      hint: shortcuts.hint('app.new-private'),
      disabled: !isDesktop || viewport.device === 'phone',
      run: () => void import('./web-tab/private').then(({ openPrivate }) => openPrivate()),
    },
    // Chrome's History, from anywhere: a tab of its own in the space on screen. Named
    // for what it is, since a note's own history is Version history.
    {
      id: 'web-history',
      label: t('Browsing history'),
      hint: shortcuts.hint('web.history'),
      disabled: viewport.device === 'phone',
      run: () => void import('./web-tab/history-open').then((one) => one.openHistory()),
    },
    {
      id: 'close-window',
      label: t('Close window'),
      hint: shortcuts.hint('app.close-window'),
      disabled: !isDesktop,
      run: () => void closeWindow(),
    },
    {
      id: 'undo-file',
      label: workspace.undoLabel ?? t('Undo the last file change'),
      disabled: !workspace.undoLabel,
      run: () => void workspace.undoFileAction(),
    },
    {
      id: 'redo-file',
      label: t('Redo the last file change'),
      disabled: !workspace.canRedo,
      run: () => void workspace.redoFileAction(),
    },
    {
      id: 'settings',
      label: t('Settings'),
      hint: shortcuts.hint('app.settings'),
      run: () => settings.show(),
    },
    {
      id: 'shortcuts',
      label: t('Shortcuts'),
      hint: shortcuts.hint('app.keys'),
      run: () => settings.show('shortcuts'),
    },
    {
      id: 'history',
      label: t('Version history'),
      disabled: !workspace.active?.path,
      run: () => (settings.historyOpen = true),
    },
    ...agentUndoRows(),
    ...agentRows(),
    // A `nib://` link to what is open, for a task manager, a shortcut or another
    // note somewhere else. Also the whole of how anybody finds out the scheme
    // exists. Not in the plugin, which cannot be reached by a link and whose
    // bundle the automation code deliberately stays out of; see
    // automation/verbs.ts and docs/automation.md.
    ...(__EVEN_PLUGIN__
      ? []
      : [
          {
            id: 'copy-uri',
            label: t('Copy link to this note'),
            disabled: !workspace.active?.path,
            run: () => void import('./automation/link').then((m) => m.copyNoteLink()),
          },
        ]),

    ...exportCommands(),
    ...spaceCommands(),
    { id: 'llm', label: t('Connect an LLM to your notes'), run: () => settings.show('llm') },

    account.user
      ? {
          id: 'signout',
          label: `${t('Sign out')} ${account.user.email}`.trim(),
          // Who this machine is signed in as is not a link's business.
          byHand: true,
          run: () => void account.signOut(),
        }
      : { id: 'signin', label: t('Sign in'), run: () => (account.open = true) },

    {
      id: 'reformat',
      label: t('Tidy up this note'),
      // Rewriting the whole note is an edit, whatever it is called.
      disabled: !view || view.state.readOnly,
      run: () =>
        view &&
        reformatDocument({
          state: view.state,
          dispatch: (transaction: Transaction) => view.dispatch(transaction),
        }),
    },

    ...blockCommands(view),
    ...slideCommands(view),
    // Folding changes what is on screen and never the note, so these three are
    // not among the writing rows above and are not greyed out on a note nobody
    // may write in. See fold.ts in the editor package.
    ...foldingCommands(view),
    ...lineCommands(view),
    {
      id: 'reading',
      label: workspace.active?.reading ? t('Leave reading') : t('Reading'),
      hint: shortcuts.hint('app.reading'),
      disabled: workspace.active?.kind !== 'note',
      run: () => workspace.toggleReading(),
    },
    {
      id: 'read-only',
      label: modes.readOnly ? t('Leave read-only') : t('Read-only'),
      hint: shortcuts.hint('app.read-only'),
      run: () => modes.toggleReadOnly(view),
    },
    {
      id: 'source',
      label: modes.source ? t('Leave source mode') : t('Source mode'),
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
    {
      id: 'focus',
      label: modes.focus ? t('Leave focus mode') : t('Focus mode'),
      hint: shortcuts.hint('app.focus'),
      run: () => modes.toggleFocus(view),
    },
    {
      id: 'typewriter',
      label: modes.typewriter ? t('Leave typewriter mode') : t('Typewriter mode'),
      hint: shortcuts.hint('app.typewriter'),
      run: () => modes.toggleTypewriter(view),
    },
    // The tab alone in nib's window, which stays a window; see lib/tab-fill. Not on a
    // phone or a tablet, which show one document and nothing beside it already.
    ...(viewport.touch
      ? []
      : [
          {
            id: 'full-window',
            label: workspace.panes.fills === null ? t('Full window') : t('Leave full window'),
            hint: shortcuts.hint('app.fill-tab'),
            disabled: workspace.panes.fills === null && !workspace.activeTabId,
            run: () => void toggleFill(),
          },
        ]),

    {
      id: 'punctuation',
      label: modes.punctuation ? t('Use straight quotes') : t('Use curly quotes'),
      run: () => modes.togglePunctuation(view),
    },
    {
      id: 'numbers',
      label: modes.numbers ? t('Stop numbering headings') : t('Number headings'),
      run: () => modes.toggleNumbers(view),
    },

    {
      id: 'line-numbers',
      label: modes.lineNumbers ? t('Hide code line numbers') : t('Show code line numbers'),
      run: () => modes.toggleLineNumbers(view),
    },
    {
      id: 'rtl',
      label: modes.rtl ? t('Write left to right') : t('Write right to left'),
      run: () => modes.toggleRightToLeft(view),
    },
    {
      id: 'strict',
      label: modes.strict ? t('Allow extended markdown') : t('Strict CommonMark only'),
      run: () => modes.toggleStrict(view),
    },
    {
      id: 'equation-numbers',
      label: modes.equationNumbers ? t('Stop numbering equations') : t('Number equations'),
      run: () => modes.toggleEquationNumbers(view),
    },
    { id: 'wider', label: t('Wider writing area'), run: () => modes.stepWidth(1, view) },
    { id: 'narrower', label: t('Narrower writing area'), run: () => modes.stepWidth(-1, view) },
    { id: 'looser', label: t('Looser line spacing'), run: () => modes.stepLineHeight(1, view) },
    { id: 'tighter', label: t('Tighter line spacing'), run: () => modes.stepLineHeight(-1, view) },

    {
      id: 'zoom-in',
      label: t('Zoom in'),
      hint: shortcuts.hint('app.zoom-in'),
      run: () => modes.stepZoom(1),
    },
    {
      id: 'zoom-out',
      label: t('Zoom out'),
      hint: shortcuts.hint('app.zoom-out'),
      run: () => modes.stepZoom(-1),
    },
    {
      id: 'zoom-reset',
      label: t('Actual size'),
      hint: shortcuts.hint('app.zoom-reset'),
      run: () => modes.resetZoom(),
    },

    // The window's own frame, which only a desktop has a window for. It says what it
    // would do rather than what is on, the way every other toggle in this list does:
    // a row somebody reads before they press it. The pane in Settings shows it as a
    // pair of choices; see preferences.ts and appearance.rs. What the window stands on
    // is the glass theme's, one of the rows below.
    ...(isDesktop
      ? [
          {
            id: 'window-frame',
            label: t('Window frame'),
            run: () => modes.setFrame(modes.frame === 'system' ? 'nib' : 'system'),
          },
        ]
      : []),

    // Every theme at once, each tried on the whole app while it is pointed at: the
    // picker a right click on the light and dark switch opens. The rows under it
    // choose one by name. See theme-picker/picking.svelte.ts.
    {
      id: 'themes',
      label: t('Switch theme'),
      run: () => void import('./theme-picker/picking.svelte').then((one) => one.pickTheme()),
    },
    // A theme, an accent and a code theme carry a name rather than a word, so
    // the row reads "Design: Sepia" in German and not "Theme: Sepia". The one in
    // force is ticked, which is the mark the menu rows already use: a word in the
    // key's place would be a word to read where a shape says it.
    ...theme.all.map((item) => ({
      id: `theme:${item.id}`,
      label: t('Theme: {name}', { name: t(item.name) }),
      checked: item.id === theme.id,
      run: () => theme.select(item.id),
    })),
    // Whether the app is dark, light, or whatever the system is asking for. A
    // row each rather than one that flips, so the keyboard reaches the same
    // three the pane offers, and off where the theme in force cannot show it.
    ...SCHEME_CHOICES.map((choice) => ({
      id: `scheme:${choice}`,
      label: t('Mode: {name}', { name: t(SCHEME_NAMES[choice]) }),
      checked: choice === theme.shown,
      disabled: !theme.offers(choice),
      run: () => theme.setScheme(choice),
    })),
    // Only where the accent is the reader's to choose. A theme that states one of
    // its own is showing that colour on purpose, and nine rows in the palette that
    // change nothing are nine rows in the way of the one somebody meant.
    ...(theme.accentIsTheme
      ? []
      : theme.accents.map((swatch) => ({
          id: `accent:${swatch.id}`,
          label: t('Accent: {name}', { name: t(swatch.name) }),
          checked: swatch.id === theme.accent,
          run: () => theme.setAccent(swatch.id),
        }))),
    // What a note's front matter is drawn as. A row each, for the same reason the
    // scheme has one each: the keyboard reaches the same three words the pane
    // offers, and the one in force is ticked.
    ...PROPERTIES_MODES.map((mode) => ({
      id: `properties:${mode}`,
      label: t('Front matter: {name}', { name: t(PROPERTIES_WORDS[mode]) }),
      checked: mode === modes.properties,
      run: () => modes.setProperties(mode, view),
    })),
    ...CODE_PALETTES.map((palette) => ({
      id: `code-theme:${palette.id}`,
      label: t('Code theme: {name}', { name: palette.name }),
      checked: palette.id === modes.codeTheme,
      run: () => modes.setCodeTheme(palette.id, view),
    })),
    // Four rows about files on a disk, and the web build has no disk: a themes
    // folder to reveal, a `custom.css` and a `snippets.json` to open, a log to
    // find. Each of the four already refused on the web and refused silently,
    // which is the worst of the three answers - the row was there, it was not
    // greyed, and pressing it did nothing at all. Left out instead, the way every
    // other row the build cannot answer is; see `exportCommands` above. The
    // refusals inside the four stay, because a command reached any other way must
    // still not try.
    ...(isDesktop
      ? [
          {
            id: 'themes-folder',
            label: t('Open themes folder'),
            run: () => void openThemesFolder(),
          },
        ]
      : []),
    ...(isNative
      ? [
          { id: 'custom-css', label: t('Edit custom CSS'), run: () => void openCustomCss() },
          { id: 'snippets', label: t('Edit snippets'), run: () => void openSnippets() },
        ]
      : []),
    ...(isDesktop
      ? [{ id: 'logs', label: t('Open the log file'), run: () => void openLog() }]
      : []),
    {
      id: 'update',
      label: t('Check for updates'),
      disabled: !isDesktop,
      // Through the store rather than straight to the updater, so somebody who
      // asked is told: a look that downloads a version and says nothing is a
      // command that appears to do nothing at all.
      run: () => void updates.check(),
    },
    {
      id: 'sidebar',
      label: workspace.panel ? t('Hide left sidebar') : t('Show left sidebar'),
      hint: shortcuts.hint('app.sidebar'),
      run: () => workspace.toggleSidebar(),
    },
    // The four panels. Each opens and takes the keyboard, which is what its key
    // does, so choosing one here and pressing its chord land in the same place;
    // see focus.ts.
    {
      id: 'files',
      label: t('Files'),
      hint: shortcuts.hint('app.files'),
      run: () => revealPanel('tree'),
    },
    {
      id: 'reveal',
      label: t('Show in the file list'),
      hint: shortcuts.hint('app.reveal'),
      disabled: !workspace.active?.path,
      run: () => workspace.revealNote(),
    },
    {
      id: 'fold-list',
      label: t('Collapse the file list'),
      hint: shortcuts.hint('app.fold-list'),
      disabled: !workspace.unfolded,
      run: () => workspace.foldList(),
    },
    {
      id: 'outline-panel',
      label: t('Outline'),
      hint: shortcuts.hint('app.outline'),
      run: () => revealPanel('outline'),
    },
    {
      id: 'search-space',
      label: t('Search this space'),
      hint: shortcuts.hint('app.search'),
      run: () => revealPanel('search'),
    },
    {
      id: 'links-panel',
      label: t('Links'),
      hint: shortcuts.hint('app.links'),
      run: () => revealPanel('links'),
    },
    // The fifth panel. No key of its own: the four that have one are the four that
    // had one, and a fifth combination nobody asked for is a key taken away from
    // whatever the reader might have wanted it for. The palette is how it is reached
    // without pointing, and the tab strip is how it is reached with.
    {
      id: 'footnotes-panel',
      label: t('Footnotes'),
      run: () => revealPanel('footnotes'),
    },
    {
      id: 'properties-panel',
      label: t('Properties'),
      hint: shortcuts.hint('app.properties'),
      run: () => revealPanel('properties'),
    },
    {
      id: 'ask-panel',
      label: t('Ask'),
      hint: shortcuts.hint('app.ask'),
      run: () => revealPanel('ask'),
    },
    {
      id: 'quick-question',
      label: t('Quick question'),
      hint: shortcuts.hint('app.quick-question'),
      run: () => askQuickly(),
    },
    {
      id: 'scratchpad',
      label: t('Scratchpad'),
      hint: shortcuts.hint('app.scratchpad'),
      run: () => toggleScratchpad(),
    },
    {
      id: 'right-sidebar',
      label: workspace.rightPanel ? t('Hide right sidebar') : t('Show right sidebar'),
      hint: shortcuts.hint('app.right-sidebar'),
      disabled: !workspace.right.length,
      run: () => workspace.toggleSidebar('right'),
    },
    // Holding a panel on one note while another is written beside it. One row that
    // says which way it goes, the way every other two-state row in the palette does,
    // and greyed out where there is nothing to hold: no panel open that is about a
    // note, or a handheld, which holds one document. The rule is the workspace's, so
    // this and the button in the panel cannot come to different answers; see
    // `holdable` there.
    {
      id: 'hold-panel',
      label: workspace.held ? t('Follow the open note') : t('Stay on this note'),
      checked: workspace.held,
      disabled: workspace.holdablePanel === null,
      run: () => workspace.holdPanel(workspace.held ? null : (workspace.panelTab?.id ?? null)),
    },
    {
      id: 'graph',
      label: t('Graph'),
      hint: shortcuts.hint('app.graph'),
      run: () => workspace.openGraph(),
    },
    // Round the regions of the window, and round the spaces. Here as well as on a
    // key, because the palette is where somebody looks for a thing they have not
    // learned the key for yet - and because a browser may take F6 before the app
    // sees it.
    {
      id: 'region-next',
      label: t('Next section'),
      hint: shortcuts.hint('app.region-next'),
      run: () => void stepRegionFocus(1),
    },
    {
      id: 'region-previous',
      label: t('Previous section'),
      hint: shortcuts.hint('app.region-previous'),
      run: () => void stepRegionFocus(-1),
    },
    {
      id: 'spaces',
      label: t('Spaces'),
      hint: shortcuts.hint('space.switcher'),
      run: () => spacePicker.toggle(),
    },
    {
      id: 'space-next',
      label: t('Next space'),
      hint: shortcuts.hint('space.next'),
      disabled: workspace.spaces.length < 2,
      run: () => stepSpace(1),
    },
    {
      id: 'space-previous',
      label: t('Previous space'),
      hint: shortcuts.hint('space.previous'),
      disabled: workspace.spaces.length < 2,
      run: () => stepSpace(-1),
    },
    {
      id: 'keys',
      label: t('Keyboard shortcuts'),
      hint: shortcuts.hint('app.keys'),
      run: () => settings.show('shortcuts'),
    },

    ...composerCommands(view),
  ]
}
