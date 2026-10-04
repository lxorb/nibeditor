/** Every part of the app that is fetched the first time it is asked for rather than
 *  carried in front of the first paint.
 *
 *  A window opens on a note, and until batch 109 it opened on every other document
 *  kind as well: the canvas with its ink, its geometry and its hand tools, the PDF
 *  viewer, the pages engine, the graph with its layout and its painter, the webview
 *  tab. Together they are the larger half of the app's own code, and none of it is
 *  needed to put a note on screen - which is what "nib opens like Notepad" means.
 *
 *  One promise each, kept, so that a canvas is fetched once however many are opened
 *  and switching back to one is not a second wait. `{#await}` on a promise that has
 *  already resolved renders in the same pass, so only the first tab of a kind ever
 *  sees the empty frame.
 *
 *  Route-level and nothing finer: a surface is what a tab *is*, so the tab's kind is
 *  the honest boundary. Anything inside one of them that is heavy again - the diagram
 *  drawers, the exporters, the syntax parsers - is already behind a boundary of its
 *  own.
 *
 *  Two shapes of door, because there are two kinds of thing behind them:
 *
 *  - A **surface** is drawn while something else is true - a tab of that kind is in
 *    front, the find bar is up, the Search panel is the one showing - so the `{#if}`
 *    that was already there is the whole of the gate and the door is a plain call
 *    from inside it.
 *  - A **latched** overlay is one that has to stay mounted after it closes, or its
 *    own way out would have nothing to play; see App.svelte. Nothing else says when
 *    it is on the page, so the door itself remembers being asked, as a rune the
 *    markup can read. `ask()` is called from a command, a gesture or an effect -
 *    never from the markup, which would be a write during a render. */

import { loadFind, loadLineCommands, setBlocks } from '@nib/editor'
import { door } from '@nib/markdown/door'
import { warmCalls } from './api'
import { startup } from './startup.svelte'

/** One lazy component, held. The default export rather than the module, because that
 *  is what a template can name. */
export function held<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  return door(() => load().then((one) => one.default))
}

const never = new Promise<never>(() => undefined)

/** The same, and it remembers: `asked` is the fetch, null before it and after a failure,
 *  for the markup's `{#if}`. `ask` runs in effects, so it reads only plain fields; what
 *  it hands out never rejects, since reloading.svelte.ts answers a failure. */
export function latched<T>(load: () => Promise<{ default: T }>): {
  ask: () => Promise<T>
  readonly asked: Promise<T> | null
} {
  const fetch = held(load)
  let asking: Promise<T> | null = null
  let answer: Promise<T> = never
  let asked = $state<Promise<T> | null>(null)

  return {
    ask: () => {
      const fetching = fetch()
      if (fetching === asking) return answer

      asking = fetching
      answer = fetching.catch(() => never)
      asked = answer
      fetching.catch(() => {
        if (asking !== fetching) return
        asking = null
        asked = null
      })

      return answer
    },
    get asked() {
      return asked
    },
  }
}

/** A plane of cards, its ink and its tools. The largest of them by a good way, and
 *  never the glasses' plugin's, which opens no canvas (see openers.ts): a fetch that is
 *  only never called still puts its chunk in the package. */
export const canvasSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no canvas in the Even Realities plugin'))
    : import('./Canvas.svelte'),
)

/** The space as a picture: the layout, the painter and the controls over it. */
export const graphSurface = held(() => import('./Graph.svelte'))

/** A view of rows in a tab - Today, a project, a `.base` file's board - with the rows
 *  engine and every layout behind it. See docs/tasks.md 5.5. */
export const viewSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no views in the Even Realities plugin'))
    : import('./views/ViewTab.svelte'),
)

/** The Tasks panel: Inbox, Today, Upcoming, the saved views, projects and labels, each
 *  with its count. Fetched the first time its tab is chosen, and the rows with it. */
export const tasksPanel = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no Tasks panel in the Even Realities plugin'))
    : import('./views/TasksPanel.svelte'),
)

/** Pages of paper, for a note laid out rather than flowed. Never the plugin's, for
 *  the canvas's reason: it opens no page note either. */
export const pagesSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no page notes in the Even Realities plugin'))
    : import('./Pages.svelte'),
)

/** A paper being read, beside the notes about it. Brings pdf.js with it, which is why
 *  the glasses' plugin has neither; see vite.even.config.ts. */
export const pdfSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no PDF viewer in the Even Realities plugin'))
    : import('./Pdf.svelte'),
)

/** A website in a tab. See docs/web-tabs.md. Never the glasses' plugin's, which opens
 *  no website in a tab (see `openWeb` in workspace.svelte.ts), and a fetch that is
 *  only never called still puts its chunk in the package. */
export const webSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no web tab in the Even Realities plugin'))
    : import('./web-tab/WebTab.svelte'),
)

/** A shell in a tab, with xterm.js behind it. Never the glasses' plugin's, which has no
 *  shell to run: the same reason as the space chooser's card below. See docs/terminal.md. */
export const terminalSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no terminal in the Even Realities plugin'))
    : import('./terminal/TerminalTab.svelte'),
)

/** A pane with nothing open, which is the kinds a new tab can be as buttons. Fetched
 *  like the surfaces above it and for the same reason: a window that opens on a note -
 *  which is nearly every window - should not carry the answer to a pane that has
 *  nothing in it. A pane that is empty has nothing else to draw while this arrives, and
 *  a fetch that has already happened renders in the same pass. See NewHere.svelte. */
export const emptySurface = held(() => import('./NewHere.svelte'))

/** The note through the renderer rather than in the editor, which is a face a tab
 *  wears and not a window the app opens in: a reader who never presses it never
 *  fetches the renderer's own side of the app. See Pane.svelte, where the tab's own
 *  `reading` is the gate. */
export const readingSurface = held(() => import('./Reading.svelte'))

/** The bar over a note being searched through, with everything a replacement needs in
 *  it. Three panes draw it - the editor's, the reading view's and a PDF's - and none
 *  of them has one until a key asks; see FindBar.svelte. */
export const findBar = held(() => import('./FindBar.svelte'))

/** The Search panel: the field that understands operators, the rows it found and the
 *  replacement over them. One of five panels the sidebar shows, and the only one that
 *  carries a ranking engine. */
export const searchPanel = held(() => import('./SearchPanel.svelte'))

/** The activity panel, whose tab is there only once an agent has spoken. Never the
 *  glasses' plugin's, which no agent reaches: an agent comes through the installed
 *  app's own program. */
export const agentsPanel = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agents in the Even Realities plugin'))
    : import('./agents/ui/ActivityPanel.svelte'),
)

/** The settings sheet: every pane it has, the theme store, the sync pane, the AI pane,
 *  the security pane. The app's largest single panel, and not on screen when the window
 *  opens. Mounted for good once it arrives rather than with the sheet, so that opening
 *  and closing it animates exactly as it did; see App.svelte. */
export const settingsSheet = latched(() => import('./SettingsPanel.svelte'))

/** Not a surface but the same bargain, and it belongs beside the one it is about: the
 *  outline panel's thumbnails of a page note, which are drawn with the canvas's own ink
 *  engine and so carry the larger half of the canvas with them. Fetched the first time
 *  a page note is in front. See Sidebar.svelte. */
export const pagesNavigator = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no page notes in the Even Realities plugin'))
    : import('./PagesNavigator.svelte'),
)

/** The right side's panels that are more than a list of rows: the links with their
 *  picture, the conversation with the providers behind it, and the front matter. The
 *  right side is shut when a window opens; the links are warmed with the doors. */
export const linksPanel = held(() => import('./Links.svelte'))
/** The AI panel, with the thread engine behind it: never the glasses' plugin's, which
 *  has no right side to ask in and whose package is at its ceiling. */
export const askPanel = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('desktop only'))
    : import('./ai/sidebar/ChatPanel.svelte'),
)
export const propertiesPanel = held(() => import('./PropertiesPanel.svelte'))

/** The archive at the foot of the file list, once the space has one. Never the glasses'
 *  plugin's: its package is at its ceiling, and it hides what is archived without them. */
export const archiveSection = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no archive list in the Even Realities plugin'))
    : import('./Archive.svelte'),
)

/** The strip over an archived note opened anyway; not the plugin's either. */
export const archivedStrip = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no archive strip in the Even Realities plugin'))
    : import('./ArchivedStrip.svelte'),
)

/** The overlays App.svelte holds: the sheets, the pickers and the deck.
 *
 *  None of them is on screen when the window opens, and between them they were the
 *  larger half of what was left in the shell chunk after batch 109 - so each is
 *  fetched the first time something opens it, and kept mounted afterwards for the
 *  same reason the settings sheet is: a component unmounted the moment it closed
 *  would have no way out to play. */

/** Every version of the note in front, the device's and the account's. */
export const historySheet = latched(() => import('./History.svelte'))

/** Who else may read this space, or this one file of it. */
export const shareSheet = latched(() => import('./ShareSheet.svelte'))

/** A space as a site: the address, the theme, the pages that go. Asked for by the
 *  store behind it, which is fetched with it: `publish.show` is what opens this sheet
 *  from anywhere, and nothing else in the app carries either half. */
export const publishSheet = latched(() => import('./PublishSheet.svelte'))

/** Somebody else's notes on their way in, whichever app wrote them. Asked for the same
 *  way the publish sheet is, by `importing.show`. */
export const importSheet = latched(() => import('./ImportSheet.svelte'))

/** The one picker everything that wears an icon asks for one. */
export const iconPicker = latched(() => import('./IconPicker.svelte'))

/** The four rewrites, and the diff a reader keeps or throws away. Asked for by the
 *  store behind it, which is fetched with it: `rewriting.show` is what opens this sheet
 *  from anywhere, and everything either half knows about talking to a model - the
 *  providers, the keys, the streaming - is behind this one import. See
 *  ai/rewriting.svelte.ts. */
export const rewriteSheet = latched(() => import('./RewriteSheet.svelte'))

/** A question on the side, answered in place: asked for by the store behind it, which
 *  is fetched with it by the key, the palette row or a web page's double Ctrl. Never the
 *  glasses' plugin's, whose package is at its ceiling (even/bundle.test.ts). See
 *  ai/quick.svelte.ts. */
export const quickSheet = latched(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no quick question in the Even Realities plugin'))
    : import('./QuickQuestion.svelte'),
)

/** The red dot, the clock and the stop, which is the whole of what the window says
 *  about an open microphone. Latched rather than drawn while a recording runs, because
 *  the pill is what stays up while what was recorded is still being written down; the
 *  recorder asks for it as it starts. See StatusBar.svelte and recorder/recording.svelte.ts. */
export const recordingPill = latched(() => import('./RecordingPill.svelte'))

/** What the app menu's rows are built out of: every command in the app, named, asked
 *  whether it may run, with the export list and the shortcut hints beside them. Not a
 *  component but the same bargain - nothing of it is worth a byte before somebody
 *  presses the bars; see AppMenu.svelte. */
export const appMenuRows = held(async () => ({ default: (await import('./app-menu')).appMenu }))

/** And the menu those rows are shown in: the popover, its groups and submenus and the
 *  keys that walk them. The three bars are on screen from the first frame; what they
 *  open is not. Latched like the sheets and asked for at the same last turn, so the
 *  first press finds it mounted and plays its way in; see AppMenu.svelte. */
export const appMenuPanel = latched(() => import('./AppMenuPanel.svelte'))

/** The Undo after a delete or a move; see undo-toast.svelte.ts. */
export const undoToastNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no undo toast in the Even Realities plugin')
  return import('./UndoToast.svelte')
})

/** A space's row saying its tabs out of sight are playing, asked for by the spaces' own
 *  sets once a window has fetched them; see SpaceSound.svelte. */
export const spaceSound = latched(() => import('./SpaceSound.svelte'))

/** Chrome's speaker on a tab playing sound, fetched with the first sound. */
export const soundMark = held(() => import('./SoundMark.svelte'))

/** What a terminal's tab wears - the program in front, else its shell - fetched with the
 *  first terminal in the strip; see terminal/TerminalMark.svelte. */
export const terminalMark = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no terminal in the Even Realities plugin'))
    : import('./terminal/TerminalMark.svelte'),
)

/** A tab's name typed where it is written, fetched with the first rename. */
export const tabNameField = held(() => import('./tab-strip/TabNameField.svelte'))

/** A held note's mark; see sync2/asking.svelte.ts. */
export const heldMark = latched(() =>
  __EVEN_PLUGIN__ ? Promise.reject(new Error('v1 only')) : import('./sync2/HeldMark.svelte'),
)

/** The dialog Ctrl+T opens in the middle of the window: the kinds a new tab can be,
 *  as cards, on the website. Latched like the sheets, and asked for at the launch's
 *  last turn rather than behind the first press, because that press is a hand holding
 *  Ctrl and a dialog that arrived a frame late would be the one hitch in the gesture.
 *  See NewKindSheet.svelte and new-kind-sheet.svelte.ts. */
export const newKindDialog = latched(() => import('./NewKindSheet.svelte'))

/** The switcher in the middle of the window, Ctrl+Space: every space, a digit
 *  away. Latched and asked for at the launch's last turn, as the dialog above is, since
 *  the press it answers is a hand that expects the rows under it at once. See
 *  SpacePicker.svelte and space-picker.svelte.ts. */
export const spacePickerDialog = latched(() => import('./SpacePicker.svelte'))

/** Remote's hosts in the middle of the window, fetched with the first press; see
 *  remote/HostPicker.svelte. */
export const hostPickerDialog = latched(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no remote in the Even Realities plugin'))
    : import('./remote/HostPicker.svelte'),
)

/** And the list a press on a space's mark drops, which is the same rows; warmed with
 *  the dialog, so the press finds it here. See SpaceMenu.svelte. */
export const spacesMenu = held(() => import('./SpaceMenu.svelte'))

/** The one question the app asks in a sheet: a name for a new note, a folder to move one
 *  to, one of many answers to pick. Latched and asked for at the same last turn, so the
 *  first question is already mounted; one asked in front of that is fetched and opens as
 *  it lands. See prompt.svelte.ts and App.svelte. */
export const promptSheet = latched(() => import('./PromptSheet.svelte'))

/** Ctrl+P: the notes, the commands, and the headings and lines of the note in front,
 *  with everything that ranks them and makes a note out of a name nothing answered.
 *  Latched like the dialog above and asked for at the same last turn, for the same
 *  reason: the press is a hand that expects the box under it at once. A press in
 *  front of that fetches it and opens it as it lands; see App.svelte. */
export const paletteDoor = latched(() => import('./Palette.svelte'))

/** The menu a right click or a long press opens, over whatever it was pressed on.
 *  Nothing of it is on screen when the window opens, and the rows it shows are each
 *  surface's own and already behind their own doors; see menu.svelte.ts. Latched and
 *  asked for at the launch's last turn with the rows, so the first right click finds
 *  it mounted and plays its way in; a press in front of that opens it as it lands. */
export const contextMenu = latched(() => import('./ContextMenu.svelte'))

/** The bar over a selection, and on a phone the strip over the keys. Nothing selects
 *  anything before the first paint, so it is asked for at the launch's last turn, by
 *  the first selection, or by a phone's keyboard coming up, whichever is first; see
 *  App.svelte. */
export const formatBar = latched(() => import('./FormatBar.svelte'))

/** The sign-in sheet, which a window opens on only when somebody presses for it. */
export const signInSheet = latched(() => import('./SignIn.svelte'))

/** The one word a link owes whoever followed it, when it owes one; see joining.svelte.ts. */
export const joinSheet = latched(() => import('./JoinSheet.svelte'))

/** Quick add, the first time its key, the palette's row or a view's button asks for it;
 *  see quick-add/asked.svelte.ts. */
export const quickAddSheet = latched(() =>
  // Not in the glasses' plugin, which adds a task by voice (docs/tasks.md 5.18) and has
  // no room in its package for a field it cannot show.
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./quick-add/QuickAddSheet.svelte'),
)

/** Opens quick add, knowing what a view's add button knows (its note, its tag, its day).
 *  The whole of it is fetched by the first ask, so the first paint carries this line. */
export function showQuickAdd(prefill: import('./quick-add/entry').Prefill = {}): void {
  if (!__EVEN_PLUGIN__) {
    void quickAddSheet.ask()
    void import('./quick-add/asked.svelte').then(({ quickAdd }) => quickAdd.show(prefill))
  }
}

/** The held form of the new-tab chord: the state a hand is in between pressing Ctrl+T
 *  and letting go of Ctrl, which is Alt+Tab's shape applied to the dialog above. See
 *  new-kind-chord.ts.
 *
 *  A door of a sort, but not one anything can wait at: a keystroke is answered in the
 *  frame it arrives in, so what is here is the function once it has landed and a way
 *  for the window's handler to ask whether this press is the chord's. Warmed below with
 *  the rest, because the press it has to answer is the first one; until it lands, the
 *  key is the plain command in the registry, which opens the same dialog on the same
 *  card and has no modifier to wait for. Fetched rather than carried because it is a
 *  state machine for a gesture, and a window that opens on a note should not read one
 *  before it draws; see App.svelte and test/weight.test.ts. */
let heldChooser: ((event: KeyboardEvent) => boolean) | null = null

export function newKindChord(event: KeyboardEvent): boolean {
  return heldChooser?.(event) ?? false
}

/** What a window a tab fills keeps of its chrome, and full screen's way out: neither is
 *  on screen as a window opens, since neither is remembered. See lib/tab-fill. */
export const fillBar = held(() => import('./tab-fill/FillBar.svelte'))
export const fullscreenWayOut = held(() => import('./FullscreenLeave.svelte'))

/** A note as a deck, over the whole window. The one overlay that is not latched:
 *  it takes the tab it is presenting as a prop, so there is nothing for it to be
 *  while nothing is being presented, and it is left to the `{#if}` it always had. */
export const slidesStage = held(() => import('./Slides.svelte'))

/** The Mac's menu bar, fetched once the launch is done; see native-menu-bar.svelte.ts.
 *  Never the plugin's, which is never a Mac: the same reason as the card below. */
export const menuBarDoor = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no menu bar in the Even Realities plugin'))
    : import('./native-menu-bar.svelte')

/** The card a fresh install opens on; see space-chooser.svelte.ts. The plugin never
 *  shows it (see space-choice.ts), and a fetch that is only never called still puts
 *  its chunk in the package, so that build is not given one to call. */
export const spaceChooserCard = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no space chooser in the Even Realities plugin'))
    : import('./SpaceChooser.svelte'),
)

/** The doors a key can reach at any moment, opened once the launch has nothing left to
 *  do.
 *
 *  Fetching late is about the first paint and about nothing else: what a reader can ask
 *  for with one keystroke has to be there when they ask. So the find bar, the Search
 *  panel, the app menu's rows, the reading view and the editor's own search engine are
 *  fetched at the last turn of the launch order - after the file list, the link index,
 *  the search index, the icon sets and the rooms - where the fetch costs the reader
 *  nothing and saves them a frame later. See startup.svelte.ts for the order.
 *
 *  The engine is in that list rather than behind the first Control+F because one thing
 *  it carries happens without anybody asking: the faint marks under the other
 *  occurrences of whatever is selected. A double-click is not a request for a search
 *  engine, so it is here before any hand could have double-clicked. The keys are bound
 *  from the first frame either way, and a Control+F in front of this opens the bar and
 *  is looked for as the engine lands; see find.ts in @nib/editor.
 *
 *  The five surfaces above are not here, and deliberately: a canvas, a PDF, a deck of
 *  pages, the graph and a website are each hundreds of kilobytes and each is a kind of
 *  document a reader either keeps or does not, so each waits to be opened. Nor are the
 *  sheets: every one of them opens behind a scrim with its own way in to play, which is
 *  the frame its fetch happens in. */
export async function warmDoors(): Promise<void> {
  await startup.turn('doors')
  await Promise.all([
    findBar(),
    searchPanel(),
    linksPanel(),
    appMenuRows(),
    appMenuPanel.ask(),
    readingSurface(),
    loadFind(),
    // The line, case and grow-the-selection commands, so that the first Ctrl+J or
    // Shift+Alt+Right is answered in the frame it is pressed; see line-door.ts in
    // @nib/editor.
    loadLineCommands(),
    // The blocks the editor's `/` menu offers, which are the app's rows rather than a
    // list the editor keeps: handed over as a function so the words follow the
    // language without anything having to hand them over again. Here rather than in
    // the launch, because they are rows of the command list, and the command list
    // reaches half the app - exports, printing, the recorder, dictation - for a `/`
    // nobody has typed yet. Until it lands a `/` offers nothing; see slash.ts in
    // @nib/editor.
    import('./commands').then(({ blockRows }) => setBlocks(blockRows)),
    // The held chooser and the dialog it holds up, which are here rather than behind
    // their own first press because the first press is the one they exist to answer;
    // see above.
    import('./new-kind-chord').then((one) => (heldChooser = one.newKindChord)),
    newKindDialog.ask(),
    spacePickerDialog.ask(),
    spacesMenu(),
    paletteDoor.ask(),
    promptSheet.ask(),
    // The menu a right click opens and the bar a selection brings up, which are the
    // two things a pointer can ask for at any moment; and the sign-in and join
    // sheets, which a single press or a followed link can. Mounted here so that each
    // plays its way in the first time rather than arriving already open.
    contextMenu.ask(),
    formatBar.ask(),
    signInSheet.ask(),
    joinSheet.ask(),
    // The Undo toast, and the menu of a text field so the first right click in one
    // does not wait for it. Neither in the glasses' plugin, which is a phone's and
    // has no room left in its package; see even/bundle.test.ts.
    __EVEN_PLUGIN__ ? undefined : undoToastNotice.ask(),
    __EVEN_PLUGIN__ ? undefined : import('./field-menu'),
    // The AI providers, which are not a door but the same bargain: two rows ask whether
    // anything of the reader's own can turn sound into words, and they are asked the
    // moment a menu opens. Restoring them costs fifteen kilobytes nobody waits for here
    // and answers that question right from the first menu; see ai/hears.ts.
    import('./ai/store.svelte'),
    // A tab's own menu, a row's, the editor's, and Ctrl+Tab in order of use, asked for
    // at any moment.
    import('./tab-strip/menu'),
    import('./tab-strip/strip-menu'),
    import('./row-menu'),
    import('./editor-menu'),
    import('./tab-cycle.svelte'),
    // The tabs' numbers while Alt is held.
    __EVEN_PLUGIN__ ? undefined : import('./tab-strip/numbers.svelte'),
    // The bar a tab filling the window keeps, so the first Shift+F11 is one layout and
    // not two; the command itself comes with a tab's menu above.
    __EVEN_PLUGIN__ ? undefined : fillBar(),
    // The editor in the card a pointer resting on a link opens, which a hand can ask
    // for at any moment; see `previewCard` in Editor.svelte.
    import('./preview-card'),
    // And what a cover row in a note's menu writes, so the file chooser it opens is
    // opened in the press that asked; see `coverEntries` in menu.svelte.ts.
    import('./note-cover'),
    // The table of the service's calls, so the first sign-in, share or pass of sync
    // is a request and not a fetch and then a request; see api.ts.
    warmCalls(),
    // What keeps the note in front for the next launch to draw before its editor is
    // up; see first-screen.svelte.ts.
    __EVEN_PLUGIN__
      ? undefined
      : import('./first-screen/keep.svelte').then((one) => one.keepFirstScreens()),
    // Before a deploy can take it away; see reloading.svelte.ts.
    import('./reload-when'),
    // Where the keyboard was, put back as the window or a layer gives it back.
    import('./keyboard-home'),
    // Two fingers sideways, or one from a pane's side, for back and forward; see
    // back-swipe/swipes.ts. Not in the glasses' plugin, which is a phone's.
    __EVEN_PLUGIN__ ? undefined : import('./back-swipe/swipes').then((one) => one.listen()),
  ])
}
