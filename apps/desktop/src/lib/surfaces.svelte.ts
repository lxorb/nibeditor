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

import { loadFind } from '@nib/editor'
import { startup } from './startup.svelte'

/** One lazy component, held. The default export rather than the module, because that
 *  is what a template can name. */
function held<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  let asked: Promise<T> | null = null
  return () => (asked ??= load().then((one) => one.default))
}

/** The same, and it remembers: `asked` is the fetch once something has asked for it
 *  and null until then, so the markup has something to put its `{#if}` on. Only ever
 *  set - nothing here is ever un-asked. */
function latched<T>(load: () => Promise<{ default: T }>): {
  ask: () => Promise<T>
  readonly asked: Promise<T> | null
} {
  let asked = $state<Promise<T> | null>(null)

  return {
    ask: () => (asked ??= load().then((one) => one.default)),
    get asked() {
      return asked
    },
  }
}

/** A plane of cards, its ink and its tools. The largest of them by a good way. */
export const canvasSurface = held(() => import('./Canvas.svelte'))

/** The space as a picture: the layout, the painter and the controls over it. */
export const graphSurface = held(() => import('./Graph.svelte'))

/** Pages of paper, for a note laid out rather than flowed. */
export const pagesSurface = held(() => import('./Pages.svelte'))

/** A paper being read, beside the notes about it. Brings pdf.js with it. */
export const pdfSurface = held(() => import('./Pdf.svelte'))

/** A website in a tab. See docs/web-tabs.md. */
export const webSurface = held(() => import('./web-tab/WebTab.svelte'))

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

/** The settings sheet: every pane it has, the theme store, the sync pane, the AI pane,
 *  the security pane. The app's largest single panel, and not on screen when the window
 *  opens. Mounted for good once it arrives rather than with the sheet, so that opening
 *  and closing it animates exactly as it did; see App.svelte. */
export const settingsSheet = latched(() => import('./SettingsPanel.svelte'))

/** Not a surface but the same bargain, and it belongs beside the one it is about: the
 *  outline panel's thumbnails of a page note, which are drawn with the canvas's own ink
 *  engine and so carry the larger half of the canvas with them. Fetched the first time
 *  a page note is in front. See Sidebar.svelte. */
export const pagesNavigator = held(() => import('./PagesNavigator.svelte'))

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

/** The held form of the new-tab chord: the state a hand is in between pressing Ctrl+T
 *  and letting go of Ctrl, which is Alt+Tab's shape applied to the chooser that was
 *  already there. See new-kind-chord.ts.
 *
 *  A door of a sort, but not one anything can wait at: a keystroke is answered in the
 *  frame it arrives in, so what is here is the function once it has landed and a way
 *  for the window's handler to ask whether this press is the chord's. Warmed below with
 *  the rest, because the press it has to answer is the first one; until it lands, the
 *  key is the plain command in the registry, which opens the same chooser on the same
 *  row and has no modifier to wait for. Fetched rather than carried because it is a
 *  state machine for a gesture, and a window that opens on a note should not read one
 *  before it draws; see App.svelte and test/weight.test.ts. */
let heldChooser: ((event: KeyboardEvent) => boolean) | null = null

export function newKindChord(event: KeyboardEvent): boolean {
  return heldChooser?.(event) ?? false
}

/** A note as a deck, over the whole window. The one overlay that is not latched:
 *  it takes the tab it is presenting as a prop, so there is nothing for it to be
 *  while nothing is being presented, and it is left to the `{#if}` it always had. */
export const slidesStage = held(() => import('./Slides.svelte'))

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
    appMenuRows(),
    readingSurface(),
    loadFind(),
    // The held chooser, which is here rather than behind its own first press because
    // the first press is the one it exists to answer; see above.
    import('./new-kind-chord').then((one) => (heldChooser = one.newKindChord)),
    // The AI providers, which are not a door but the same bargain: two rows ask whether
    // anything of the reader's own can turn sound into words, and they are asked the
    // moment a menu opens. Restoring them costs fifteen kilobytes nobody waits for here
    // and answers that question right from the first menu; see ai/hears.ts.
    import('./ai/store.svelte'),
  ])
}
