import { type FoldLines, type NoteJump, sameFolds, type SpaceTag } from '@nib/editor'
import { account } from './account.svelte'
import { arriving } from './arriving.svelte'
import {
  blockIds,
  isCanvasTarget,
  isPagesTarget,
  isPdfTarget,
  isTabFile,
  isWebTarget,
} from '@nib/markdown/links'
import { freePath } from '@nib/markdown/paths'
import { openerFor } from './openers'
import { paperGone, paperMoved } from './pdf/papers'
import { links } from './link-index.svelte'
import { noteId } from './note-id'
import { insideOnly } from './automation/inside'
import { folderOf, insideSpace, isMarkdownPath, nameOf, noteName, relativeTo } from './space-paths'
import { key, t } from './i18n.svelte'
import { copyName, nameFromContent, nameFromTitle, shownName } from './note-name'
import type { TreeRow } from './tree-keys'
import { isPlugin } from './plugin'
import { scanFootnotes } from './footnotes'
import { lineOfHeading, scanHeadings } from './outline'
import type { Change } from './search/apply'
import { warm } from './search/warm.svelte'
import { within } from './sync/mirror'
import { startup } from './startup.svelte'
import { nextTask } from './breathe'
import { mark, markPainted } from './trace'
import { afterQuiet } from './timing'
import { isRecord, keep, stored } from './stored'
import { WELCOME_PATH } from './welcome'
import {
  type Draft,
  frameDraft,
  frameOf,
  type Layout,
  panesOf,
  readSession,
  type Session,
  writeSession,
} from './workspace/session'
import { Bookmarks } from './workspace/bookmarks.svelte'
import { FolderIcons } from './workspace/folder-icons.svelte'
import { Excluded } from './workspace/excluded.svelte'
import { SpaceGraphSettings } from './workspace/graph-settings.svelte'
import { ClosedTabs } from './workspace/closed.svelte'
import { DeviceView } from './workspace/device.svelte'
import {
  type DocumentStart,
  holdsWords,
  NoteDoc,
  Tab,
  UNTITLED,
} from './workspace/documents.svelte'
import { Layouts } from './workspace/layouts.svelte'
import { OpenDocuments } from './workspace/open'
import { type Along, type Frame, panesIn, withoutPane } from './workspace/pane-tree'
import { type Landing, Panes } from './workspace/panes.svelte'
import { byPin, pinnedRun, placeFor } from './workspace/pinning'
import { alongOf, madeFirst, type Side } from './workspace/zones'
import { Positions } from './workspace/positions'
import * as composing from './workspace/composing'
import * as panels from './workspace/panels'
import type { Sides } from './workspace/panels'
import * as spaces from './workspace/spaces'
import * as text from './workspace/note-text'
import { Saving } from './workspace/saving.svelte'
import { undoLastFileAction } from './workspace/undoing'
import { FileActions } from './workspace/undo.svelte'
import { outermost, Selection } from './workspace/selection.svelte'
import { readTint } from './icons'
import { folderFor, folderNote, folderNotePath, noteToNest, unnesting } from './folder-notes'
import { flatRows } from './tree-flat'
import { entryAt, withComing, withEntry, withMove, withoutEntry } from './tree-edits'
import { orderedTree, type SortMode } from './tree-order'
import { Arranged } from './workspace/arranged.svelte'
import { invoke, isDesktop, isNative, joinPath, openExternal } from './tauri'
import { viewport } from './viewport.svelte'
import { plainOrigin } from './web-tab/address'
import { asShortcut, convertWebsites } from './web-tab/convert'
import { readWebFile, writeShortcut } from './web-tab/shortcut'
import { pages } from './web-tab/pages.svelte'

export interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

/** What the listing itself is asked for. One field, because the order the rows are
 *  drawn in is no longer a question for whoever reads the disk: it is decided once,
 *  in tree-order.ts, over the listing that came back. Which files exist at all still
 *  is a question for the read. */
export interface TreeOptions {
  showHidden: boolean
}

/** A space is a folder today and a synced collection once accounts land. */
export interface Space {
  id: string
  name: string
  root: string
}

/** A document is the words and a tab is one pane's view of them; both live in
 *  workspace/documents.svelte.ts, and are named here because half the app asks
 *  the workspace for a tab. */
export type { NoteDoc, Tab, TabKind } from './workspace/documents.svelte'

export type Panel = 'tree' | 'outline' | 'search' | 'links' | 'footnotes'

/** Which side of the window a panel sits on. Left is where every one of them has
 *  always been and where every one of them starts; see `right` below. Its own
 *  name because `Side` is already a pane's drop zone, which has four of them; see
 *  workspace/zones.ts. */
export type PanelSide = 'left' | 'right'

/** The four things the file list makes, each of which arrives as a row waiting
 *  for a name; see `startNaming`.
 *
 *  No folder among them. A note that holds notes is how a space is organised, so
 *  the folders on disk are made by nesting and by nothing else; see
 *  folder-notes.ts and docs/tree.md. */
export type NewKind = 'note' | 'canvas' | 'pages' | 'web'

/** A row of the file list waiting for a name, or a space's own name in the header
 *  being typed. One at a time, whichever it is; see `startNaming`. */
export interface Naming {
  path: string
  appending: boolean
  making: NewKind | null
}

/** What a row of each kind is called while it has no name: never shown, since
 *  the field it arrives in is empty, but the row is in the tree and the tree is
 *  keyed and sorted by paths. It is also the name the thing is made under where
 *  there is no list to type in at all. */
const PLACEHOLDER: Record<NewKind, string> = {
  note: 'Untitled.md',
  canvas: 'Untitled.canvas',
  pages: 'Untitled.pages',
  web: 'Untitled.url',
}

export type { Heading } from './outline'

const STORAGE_KEY = 'nib:workspace'
const TREE_KEY = 'nib:tree'
// Short enough that a crash costs a moment's typing, long enough that the strip
// is not serialised on every keystroke.
const SESSION_DELAY = 400
/** How far back one tab remembers. Longer than anybody follows a link in one
 *  sitting, short enough that a trail is never what a session is made of. */
const TRAIL = 30

/** Which line of a note a followed link lands on: the heading it names, or the
 *  line the block name sits on. Null when the note holds neither, which leaves
 *  the note opened where it was left rather than somewhere arbitrary.
 *
 *  A heading is matched by its own words and by the anchor it becomes, so
 *  `[[Note#Some Heading]]` and `[x](Note.md#some-heading)` reach the same one. */
function lineOfTarget(doc: string, jump: NoteJump): number | null {
  if (jump.block !== null) {
    return blockIds(doc).find((one) => one.id === jump.block)?.line ?? null
  }
  if (jump.heading === null) return null

  return lineOfHeading(scanHeadings(doc), jump.heading)
}

function readTreeOptions(): TreeOptions {
  const saved = stored(TREE_KEY)
  // A build older than this one wrote a sort key and a direction here as well, for
  // the whole app rather than per space. They are ignored: the order is now the
  // space's own and is kept beside where each space was left scrolled to; see
  // `listOrder` in workspace/device.svelte.ts.
  if (!isRecord(saved)) return { showHidden: false }

  return { showHidden: saved.showHidden === true }
}

/** A map read within one call and thrown away. Not one of Svelte's: nothing
 *  renders from these, and a reactive map would only cost the app the wrappers. */
function emptyMap<T>(): Map<string, T> {
  return new Map<string, T>()
}

/** Whether a tab is worth remembering once it has been closed. A blank untitled
 *  note is not: it is the empty page a window starts with, and reopening it
 *  would put back something nobody ever wrote. */
function worthReopening(tab: Tab): boolean {
  return tab.kind !== 'note' || tab.path !== null || tab.doc.trim().length > 0
}

class Workspace {
  spaces = $state<Space[]>([])
  activeSpaceId = $state<string | null>(null)
  tree = $state<Entry | null>(null)
  /** Every tab in the window, whichever pane it sits in. One flat list, because
   *  half of what the app asks is "is this note open" rather than "where": a tab
   *  says which pane it is in, and a pane's strip is the tabs that name it. */
  tabs = $state<Tab[]>([])
  /** How the panes are arranged and which one has the focus; see
   *  workspace/panes.svelte.ts. */
  readonly panes = new Panes(() => this.scheduleSession())
  /** Arrangements someone has named; see workspace/layouts.svelte.ts. */
  readonly layouts = new Layouts()
  // Hidden until asked for, the way Typora starts.
  panel = $state<Panel | null>(null)
  /** Whether somebody has chosen a sidebar since this window opened.
   *
   *  A launch paints the frame and reads the session behind it, on purpose, so the
   *  window is up and taking keys while the notes are still being read. The session
   *  landing a moment later used to write its own sidebar over the one the reader
   *  had just asked for: pressing the search key in the first second left the file
   *  list on screen. So a session opens the sidebar it remembers only while nobody
   *  has said otherwise; see `restore` and `applyLayout`.
   *
   *  Read while the session is arriving and cleared by the arrangement that lands,
   *  because that is the moment the question is settled: what happens afterwards is
   *  a sitting, and a sitting's sidebar is whatever it was last told.
   *
   *  Not `$state`: nothing on screen reads it, and the session's own writes would
   *  otherwise be a dependency of everything that draws a panel. */
  private panelChosen = false
  /** Which panels this window keeps on the right, in the order they were moved
   *  there, and which of them is open.
   *
   *  Empty, always, until somebody moves one over: the left side is where all
   *  four have always been, so a window nobody has arranged has no right side -
   *  not an empty one. Nothing is drawn for it, which is what keeps the left
   *  side, the foot row and the tab strip exactly where they were.
   *
   *  Per window rather than per account: which side a panel sits on is a fact
   *  about this screen, the way the sidebar's width is. */
  right = $state<Panel[]>([])
  rightPanel = $state<Panel | null>(null)
  /** The one tab holding a note that is only being looked at. */
  previewTabId = $state<string | null>(null)
  /** The row a name is being typed on, in place: a row that exists and is being
   *  renamed, or a fresh one that nothing on disk answers to yet, waiting for the
   *  name that will make it. `making` says which, and what to make.
   *
   *  Held by the path the row is drawn under, which is what the list keys its rows
   *  by, so a listing arriving from sync mid-word leaves the field alone; see
   *  `keepNaming`. `appending` says the name it starts with is something to add to
   *  rather than to replace: a note that was just made with a name of its own - a
   *  unique note's timestamp - is waiting for a title after it, not instead of it.
   *
   *  The space's name in the header takes the same field, held under the space's
   *  root, because it is the same gesture on the same kind of name. */
  naming = $state<Naming | null>(null)
  treeOptions = $state<TreeOptions>(readTreeOptions())
  /** The last handful of file operations; see workspace/undo. */
  readonly undone = new FileActions()
  /** The tabs this window has closed, newest last; see workspace/closed. */
  readonly closed = new ClosedTabs()
  tags = $state<SpaceTag[]>([])
  /** What this machine remembers about the list: which folders are open, what
   *  was opened lately, the icon each space wears. See workspace/device. */
  readonly device = new DeviceView()
  /** The notes, folders, headings and searches kept above the file list. Per
   *  space, and on the account when there is one; see workspace/bookmarks. */
  readonly bookmarks = new Bookmarks(() => this.activeSpace?.root ?? null)
  /** The icon each folder of the space wears. Per space and on the account for
   *  the same reasons the bookmarks are, and here rather than in the file itself
   *  because a folder has no file; see workspace/folder-icons. */
  readonly folderIcons = new FolderIcons(() => this.activeSpace?.root ?? null)
  /** The order somebody arranged each folder's rows into, where they arranged one.
   *  Beside the folder icons because it is the same kind of thing and kept in the
   *  same way, for the same reason: a folder has no file to keep it in, and the order
   *  is a fact about the space's notes rather than about this machine. See
   *  workspace/arranged. */
  readonly arranged = new Arranged(() => this.activeSpace?.root ?? null)
  /** How the picture of this space is drawn. Beside the folder icons because it is
   *  the same kind of thing: one space's own settings, kept on the account so
   *  every machine draws it the same way. */
  readonly graphSettings = new SpaceGraphSettings(() => this.activeSpace?.root ?? null)
  /** The notes and folders this space leaves out of its search, its graph and its
   *  unlinked mentions. Beside the other two because it is the same kind of thing:
   *  one space's own settings, kept on the account so every machine agrees. */
  readonly excluded = new Excluded(() => this.activeSpace?.root ?? null)
  /** Rows picked in the tree with Ctrl or Shift; see workspace/selection. */
  private readonly picked = new Selection()
  /** Writing what is open down, and the dot beside a name that says so; see
   *  workspace/saving. */
  private readonly saving = new Saving(this)
  /** The strip of tabs, written after a pause in the typing; see timing.ts. */
  private readonly session = afterQuiet(() => this.persist(), SESSION_DELAY)

  /** One document per file, and the one place a document is made; see
   *  workspace/open.ts. Everything that opens a file goes through it, because two
   *  documents over one file are two notes wearing one name. */
  private readonly opened = new OpenDocuments(
    () => this.tabs,
    (start) =>
      new NoteDoc(
        start,
        (note) => this.saving.edited(note),
        (path) => this.keepsItself(path),
      ),
  )

  /** Where each note was last being read; see workspace/positions.ts. */
  positions = new Positions()

  readonly activeSpace = $derived(
    this.spaces.find((space) => space.id === this.activeSpaceId) ?? null,
  )
  /** The tab showing in the pane that has the focus. Every key and every
   *  palette command means this one. */
  readonly active = $derived(this.tabs.find((tab) => tab.id === this.activeTabId) ?? null)

  /** Which tab that is. Setting it shows a tab and moves the focus to the pane
   *  it is in, which is what every caller means by it. */
  get activeTabId(): string | null {
    return this.panes.focused.activeTabId
  }

  set activeTabId(id: string | null) {
    const tab = id === null ? null : (this.tabs.find((one) => one.id === id) ?? null)
    if (id !== null && !tab) return

    const paneId = tab?.paneId ?? this.panes.focusedId
    this.panes.focus(paneId)
    this.panes.activate(paneId, tab?.id ?? null)
  }

  /** One pane's strip, in the order the tabs were opened. */
  tabsIn(paneId: string): Tab[] {
    return this.tabs.filter((tab) => tab.paneId === paneId)
  }

  /** Every open document, once each however many panes are showing it.
   *
   *  The five members below this comment are the store's own rather than the app's:
   *  nothing outside lib/workspace reads them, and the modules beside this one -
   *  workspace/undoing.ts and its neighbours - are what they are not private for. */
  get documents(): NoteDoc[] {
    return this.opened.all
  }

  /** The document a file is open as, or null when nothing is showing it.
   *
   *  The lookup every path-addressed thing goes through: words arriving for a file,
   *  a rename, a replacement run across the space, an undone one. There is one
   *  answer because there is one document per file; see workspace/open.ts. */
  documentAt(path: string): NoteDoc | null {
    return this.opened.at(path)
  }

  /** Every open file that has words of its own and a path behind it, once each
   *  however many panes show it. What the rooms store follows, so that a file being
   *  worked in on two devices joins the room the moment it is open on either; see
   *  rooms.svelte.ts.
   *
   *  Notes and canvases. The graph is drawn from the notes rather than written in,
   *  and a PDF is read; neither has anything for a room to hold. */
  get openNotes(): { key: string; path: string; note: NoteDoc }[] {
    return this.documents
      .filter((note) => holdsWords(note.kind) && (note.path !== null || note.shared !== null))
      .map((note) => ({ key: note.key, path: note.path ?? '', note }))
  }

  /** What the dot beside a name is saying, if anything. */
  savingOf(tab: Tab): 'saving' | 'saved' | undefined {
    return this.saving.of(tab)
  }

  /** The note being read, named the way a link names it: relative to the space.
   *  Falls back to the last note that was read, so a tab holding no note - the
   *  graph of the space - still knows which note it was opened from and can mark
   *  it. Null when there is no space, or nothing has been read in it. */
  readonly relativeNote = $derived.by((): string | null => {
    const root = this.activeSpace?.root
    const path = this.active?.path ?? this.recent[0] ?? null
    if (root === undefined || path === null) return null

    return path.startsWith(root) ? relativeTo(root, path) : null
  })

  /** The tab a side panel is held on, or null while the panels follow whichever
   *  pane has the keyboard.
   *
   *  A tab and not a note: the outline of the tab you are reading in, so that a
   *  tab which moves on to another note takes its outline with it. It lives for
   *  the sitting and is not written down - a panel held on a note you cannot
   *  remember holding it on is worse than one that simply follows. */
  heldTabId = $state<string | null>(null)

  /** The tab the outline and the links are about: the one they were held on,
   *  while it is still open, and otherwise the one being worked in. */
  readonly panelTab = $derived(this.tabs.find((tab) => tab.id === this.heldTabId) ?? this.active)

  /** That tab's note, named the way a link names it. What the links panel and a
   *  bookmarked heading are about; the graph of the whole space keeps following
   *  the pane, since it is a picture of everything rather than of one note. */
  readonly panelNote = $derived.by((): string | null => {
    const root = this.activeSpace?.root
    const path = this.panelTab?.path ?? null
    if (root === undefined || path === null) return null

    return path.startsWith(root) ? relativeTo(root, path) : null
  })

  /** Holds the panels on a tab, or lets them follow again. */
  holdPanel(tabId: string | null) {
    this.heldTabId = tabId
  }

  /** Whether the panels are held on a tab rather than following the pane. */
  readonly held = $derived(!!this.heldTabId && this.panelTab?.id === this.heldTabId)

  /** Whether a panel is one that can be held: the three that are about one note. The
   *  files are the space's and a search is the space's, so neither has a note to be held
   *  on.
   *
   *  Not on a handheld, which holds one document at a time: there is nothing to hold a
   *  panel against, and opening another note closes the tab the panel would have been
   *  held on. What decides a handheld is the machine - a finger and a mobile user agent -
   *  rather than the width of the window, so a narrow window on a desktop still offers it
   *  and still means something. See `deviceFor` in viewport.svelte.ts and docs/mobile.md.
   *
   *  Here rather than in the panel that draws the button, because the palette asks the
   *  same question and two copies of one rule is one of them going stale. */
  holdable(panel: Panel | null): boolean {
    return !viewport.touch && (panel === 'outline' || panel === 'links' || panel === 'footnotes')
  }

  /** The panel a hold would be about: whichever side has one that can be held, the left
   *  first. Null where neither has, which is what the palette's row reads to know there
   *  is nothing to hold. */
  readonly holdablePanel = $derived.by((): Panel | null => {
    for (const panel of [this.panel, this.rightPanel]) {
      if (this.holdable(panel)) return panel
    }

    return null
  })

  /** Reading it walks the whole note, so it deliberately follows `tab.doc` and
   *  not the editor: that one only catches up when the typing pauses, which is
   *  as often as an outline needs to move. Lazy as every derived is, so a
   *  closed outline panel costs nothing at all. */
  readonly headings = $derived.by(() => scanHeadings(this.panelTab?.doc ?? ''))

  /** The note's footnotes, under its headings in the outline panel: both are the
   *  shape of the note being read rather than anything about the space around it,
   *  and both jump within it. Lazy for the same reason the headings are, and it
   *  gives up on the first pass over a note with no `[^` in it at all. */
  readonly footnotes = $derived.by(() => scanFootnotes(this.panelTab?.doc ?? ''))

  /** Every file in the space, flattened: the notes, and the PDFs and canvases
   *  beside them, which are the three things a tab can hold. What quick open
   *  lists. */
  readonly files = $derived.by((): Entry[] => {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (child.is_dir) walk(child)
        else out.push(child)
      }
    }
    if (this.tree) walk(this.tree)
    return out
  })

  /** The notes among them. What everything that means words asks for: which note
   *  to merge into, which note a space is published as, which names a search
   *  completes. A PDF is a file to read and a canvas is a plane to arrange notes
   *  on; neither is a note to write in. */
  readonly notes = $derived(this.files.filter((one) => !isTabFile(one.name)))

  /** The tree as the file list draws it: what is on disk, plus a row for every
   *  note the account has named and the pass has not fetched yet.
   *
   *  Two values rather than one, because the difference matters everywhere else.
   *  `tree` is the disk, and it is what a push reads, what a search walks, what a
   *  rename edits and what says whether a space is empty: a row for a file that is
   *  not there yet would be a lie to every one of them. This one is only ever
   *  drawn. See `withComing` in tree-edits.ts and arriving.svelte.ts.
   *
   *  And it is the one place the chosen order is applied. The listing arrives in
   *  whatever order the disk was read in; this puts every folder of it into the order
   *  the space is being read in, so the rows the panel draws, the rows the keyboard
   *  walks and the rows a Shift-click ranges over cannot disagree about which row is
   *  row forty. Derived, so a tree that has not changed is sorted once however many
   *  times it is read; see tree-order.ts. */
  readonly shownTree = $derived.by((): Entry | null => {
    const coming =
      this.tree && arriving.coming.size ? withComing(this.tree, [...arriving.coming]) : this.tree
    if (!coming) return null

    return orderedTree(coming, this.sortMode, (folder) => this.arranged.listOf(folder))
  })

  /** Which order this space's file list is read in. By name until somebody chooses
   *  otherwise, per space, on this machine; see `listOrder` in
   *  workspace/device.svelte.ts. */
  readonly sortMode = $derived<SortMode>(
    this.activeSpace ? this.device.orderOf(this.activeSpace.root) : 'name',
  )

  /** Whether an account's first pass is running and there is still nothing of
   *  theirs on screen: no space, no listing, no tree.
   *
   *  The one moment that is worth taking the whole surface for, and the test for
   *  it is here because this is what knows. Any one of the three is a file list,
   *  and a file list means the pass belongs in the panel's foot as a count rather
   *  than over everything. See FirstSync.svelte and arriving.svelte.ts. */
  readonly nothingToShow = $derived(
    arriving.showing && !this.spaces.length && !this.tree && !arriving.coming.size,
  )

  async restore() {
    // The browser build starts empty, so give a first visit something to read.
    //
    // Never in the plugin. Its page is served from a local port picked afresh
    // every launch, so its storage is empty every launch and every launch reads
    // as a first visit: the seed was written again, and syncing offered it to the
    // account again, putting it back each time Emil deleted it. A signed-in plugin
    // brings the account's notes and a signed-out one shows the sign-in; neither
    // wants a welcome note. See welcome.ts.
    if (!isNative && !isPlugin()) {
      const { seed } = await import('./web/commands')
      await seed()
    }

    const state = readSession(stored(STORAGE_KEY))
    this.layouts.restore()

    if (!state) {
      await this.loadSpaces()
      if (this.activeSpaceId) await this.loadTree()

      // The list is on screen before a body is read; see startup.svelte.ts.
      await startup.shown()
      markPainted('tree painted')

      // A first visit opens what it was given rather than a blank page - unless
      // something is open already. The list goes out above this line and the window
      // takes keys from then on, so a note somebody opened in that second is theirs
      // and this is not the moment to put another one in front of it.
      if (!this.tabs.length) {
        const first = this.files[0]
        if (first) await this.openEntry(first.path)
      }

      // Nothing to open, and nothing is made up: a pane with no tab shows the kinds
      // a new one could be, which is a choice rather than a note nobody asked for.
      // See NewHere.svelte.
      return
    }

    this.spaces = state.spaces
    this.positions = new Positions(state.positions ?? {})
    this.closed.restore(state.closed ?? [])
    // The sidebar comes back the way it was left, on both sides - unless somebody
    // has already asked for one in the second the window has been up; see
    // `panelChosen`.
    if (!this.panelChosen) this.panel = state.panel
    this.right = state.right ?? []
    this.rightPanel = state.rightPanel ?? null
    this.activeSpaceId = state.activeSpace ?? this.spaces[0]?.id ?? null

    // The folder wins over what was remembered, so the two cannot drift apart.
    await this.loadSpaces()

    if (this.activeSpaceId) await this.loadTree()

    // The one line in the launch that matters most. Everything above is a folder
    // listing and a string of settings; everything below reads a note - the open
    // one, and on a slow disk several of them - and awaiting it in the same run of
    // microtasks is what used to keep the file list off the screen until the last
    // of them came back. The frame goes out here instead, with the tree in it, and
    // the notes are read into a window somebody can already see and scroll. See
    // startup.svelte.ts, which also starts the queue behind this.
    await startup.shown()
    markPainted('tree painted')

    // Nobody asked for this one: it is the sitting that was, arriving.
    if (state.layout) await this.applyLayout(state.layout, false)
    else if (state.tabs?.length) await this.restoreStrip(state.tabs, state.active ?? 0)
    else {
      for (const path of state.openPaths ?? []) {
        await this.openEntry(path, { activate: path === state.activePath })
      }
    }

    // A note always opens for writing. Which face was up belongs to the sitting
    // that was, not to the note; a named layout is the one thing that says
    // otherwise, and that is chosen rather than restored. See `applyLayout`.
    for (const tab of this.tabs) tab.reading = false

    // A phone and a tablet show one document at a time, so a session written on
    // a desktop arrives as the one that had the focus; see `oneDocument`.
    this.oneDocument()

    // And whatever the sitting left in the pane, on screen: the last of the three paints
    // a launch is made of, after the shell and the file list. Which is a note, or the
    // empty pane of somebody who closed everything before they quit - either way it is
    // the frame the launch ends on.
    markPainted('active tab painted')
  }

  /** Drafts as tabs. A file that was clean is re-read from disk, so an edit made
   *  elsewhere shows up; one that was not is restored from its draft and stays
   *  dirty. Replacing someone's unsaved work with what happens to be on disk is
   *  the one thing this must never do.
   *
   *  A canvas is read back exactly as a note is, because its words are a file's
   *  words too. The session writes no copy of words that are on disk, so a kind
   *  left out of the re-read comes back with nothing in it: a plane with every
   *  stroke still in the file and none of them on screen.
   *
   *  Which document each draft comes back as is `already` below and the open
   *  documents themselves; nothing is carried between the panes here, because one
   *  document per file is the workspace's own answer now rather than a map this
   *  method passes along. See workspace/open.ts. */
  private async tabsFrom(drafts: Draft[], paneId: string): Promise<Tab[]> {
    return this.opened.arranging(async () => {
      const made: Tab[] = []

      for (const draft of drafts) {
        const already = this.already(draft)
        if (already) {
          made.push(this.viewOf(already, paneId, draft))
          continue
        }

        // A file that was clean is read again, so an edit made elsewhere shows up,
        // and the read is the round trip a second open of the same file waits out.
        const note =
          holdsWords(draft.kind) && draft.path && !draft.dirty
            ? await this.opened.opening(draft.path, () => this.drafted(draft))
            : this.opened.make({
                kind: draft.kind,
                path: draft.path,
                name: draft.name,
                text: draft.doc,
                dirty: draft.dirty,
              })

        // Deleted or moved while Nib was away, and nothing unsaved to keep.
        if (!note) continue
        made.push(this.viewOf(note, paneId, draft))
      }

      return made
    })
  }

  /** The document a draft is a view of, if it is open already: the one it shares a
   *  document with, or the one at its path.
   *
   *  The key has to agree with the path as well. It names a document rather than a
   *  note, and the one tab that previews a note moves its document on to another
   *  all day - so a key that once meant this note can now mean whatever that tab is
   *  showing, and a tab built on it would wear this draft's name over that note's
   *  words. */
  private already(draft: Draft): NoteDoc | null {
    const shared = draft.share ? this.opened.withKey(draft.share) : null
    if (shared?.path === draft.path) return shared

    return draft.path ? this.opened.at(draft.path) : null
  }

  /** One draft's document, read from its file. Null for a file that has gone. */
  private async drafted(draft: Draft): Promise<NoteDoc | null> {
    const path = draft.path
    if (path === null) return null

    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text === null) return null

    return this.opened.make({
      kind: draft.kind,
      path,
      name: draft.name,
      text,
      dirty: false,
    })
  }

  private viewOf(note: NoteDoc, paneId: string, draft: Draft): Tab {
    const tab = new Tab(note, paneId)
    tab.cursor = draft.cursor
    tab.scroll = draft.scroll
    tab.anchor = draft.anchor
    tab.folds = draft.folds
    tab.reading = draft.reading === true
    tab.pinned = draft.pinned === true
    tab.page = draft.page
    tab.zoom = draft.zoom
    tab.address = draft.address
    return tab
  }

  /** One flat strip of tabs, which is how a session written before there were
   *  panes reads. All of it goes into the one pane there is. */
  private async restoreStrip(drafts: Draft[], active: number) {
    const paneId = this.panes.focusedId
    const restored = await this.tabsFrom(drafts, paneId)

    // Which tab was showing is read off the strip as it was written down, and the
    // kept tabs are brought to the head afterwards: the index in the session counts
    // along the order that session was written in. See workspace/pinning.ts.
    this.panes.activate(paneId, (restored[active] ?? restored[0])?.id ?? null)
    this.tabs = byPin(restored)
  }

  /** Puts an arrangement in place: the panes, the notes in each of them, which
   *  one has the focus, and the sidebar. The session on the way in, and a named
   *  layout whenever one is chosen.
   *
   *  A note with unsaved words that the arrangement says nothing about is not
   *  thrown away: it lands in the pane that ends up with the focus. Arranging
   *  what is open is never a reason to lose what somebody wrote.
   *
   *  Nor is it a reason to undo what somebody asked for. Reading the notes takes a
   *  file each, and the window is up and taking keys while that happens. `asked`
   *  is which of the two callers this is: an arrangement somebody chose brings its
   *  own sidebar, and the session, which arrives by itself, opens the sidebar it
   *  remembers only while nobody has chosen one. See `panelChosen`. */
  async applyLayout(layout: Layout, asked = true) {
    // Every document this makes is held open until the arrangement is in the
    // window, and not only for the pane that made it: a second pane showing the
    // same note wants the same document, and a note clicked while this is still
    // reading has to find the one it already read rather than open a second.
    await this.opened.arranging(() => this.arrange(layout, asked))
  }

  private async arrange(layout: Layout, asked: boolean) {
    const showing = emptyMap<string | null>()
    const made: Tab[] = []

    for (const draft of panesOf(layout.frame)) {
      const tabs = await this.tabsFrom(draft.tabs, draft.id)
      // Which tab was showing first, since that index counts along the strip as the
      // arrangement wrote it down; then the kept tabs to the head of it, which is
      // where a run of them belongs however the entry was written. See pinning.ts.
      showing.set(draft.id, (tabs[draft.active] ?? tabs[0])?.id ?? null)
      made.push(...byPin(tabs))
    }

    let frame: Frame = frameOf(layout.frame, (draft) => showing.get(draft.id) ?? null)

    // A pane whose notes have all gone takes no room.
    for (const empty of panesIn(frame)) {
      if (!made.some((tab) => tab.paneId === empty.id)) frame = withoutPane(frame, empty.id)
    }

    // What is open, read here rather than at the top: every line above this reads a
    // note, and the window has been up and taking keys the whole time.
    //
    // A layout somebody chose is what they want on screen, so it replaces what is
    // open and only unsaved words are carried over. The session is not chosen - it
    // arrives a second into a sitting that has already begun - so everything open is
    // kept and whatever is in front stays in front. A note opened in that second
    // used to be closed again a moment later, and a drive had to hold still for a
    // second and a half to work around it; a note closed in it stays closed, which
    // is why this is read now and not before.
    const rescued = asked ? this.tabs.filter((tab) => tab.dirty) : [...this.tabs]
    const inFront = asked ? null : this.active

    this.tabs = made
    this.panes.restore(frame, layout.focused)
    if (asked || !this.panelChosen) this.panel = layout.panel
    this.panelChosen = false

    for (const tab of rescued) {
      if (made.some((one) => one.note === tab.note)) continue

      tab.paneId = this.panes.focusedId
      // At the end of the strip, and at the end of the pinned run if it was one of
      // those: a tab carried over still belongs where its own kind of tab belongs.
      this.tabs = this.placed(tab, this.panes.focusedId, null)
    }

    // The document that was in front when the session arrived, put back in front -
    // by its own tab, or by the arrangement's if that opened the same note.
    const still =
      inFront &&
      (this.tabs.includes(inFront) ? inFront : this.tabs.find((one) => one.note === inFront.note))

    // Only where the arrangement left the focused pane showing nothing: a pane
    // writes down the tab it was showing as an index into its own strip, that index
    // is the only record of it - ids are handed out fresh every run - and it has
    // already been honoured a few lines above. Reaching for the first tab here
    // whatever the pane said is how every launch came back on the first note in the
    // strip however long somebody had been reading the third, and how choosing a
    // saved arrangement landed on its first note rather than the one it names. Emil
    // met it as pictures that had gone: the note was there and another note was in
    // front of it.
    if (still) this.activeTabId = still.id
    else if (!this.activeTabId && this.tabs.length) {
      this.activeTabId = this.tabsIn(this.panes.focusedId)[0]?.id ?? null
    }

    // A phone and a tablet show one document at a time.
    this.oneDocument()

    // The tabs were replaced rather than closed one by one, so any page behind one
    // that has gone is a webview with nothing left to place it; see pages.svelte.ts.
    pages.keepOnly(this.tabs.map((tab) => tab.id))
    this.persist()
  }

  /** The arrangement as it is written down. What the session holds, and what
   *  "Save layout" keeps a copy of under a name. */
  layout(): Layout {
    this.flush()

    return {
      frame: frameDraft(this.panes.frame, (pane) => {
        const tabs = this.tabsIn(pane.id)
        return {
          tabs: tabs.map((tab) => this.draftOf(tab)),
          active: Math.max(
            0,
            tabs.findIndex((tab) => tab.id === pane.activeTabId),
          ),
        }
      }),
      focused: this.panes.focusedId,
      panel: this.panel,
    }
  }

  private draftOf(tab: Tab): Draft {
    return {
      kind: tab.kind,
      path: tab.path,
      name: tab.name,
      // Only unsaved words are worth writing down: a note that is on disk is
      // re-read from there on the way back in (see `tabsFrom`), so its copy here
      // would never be looked at, and copying a large one every time the typing
      // pauses is not free.
      //
      // A document with no file is the exception whether or not it has been typed in:
      // this is the only place its words exist, so an untouched new plane that is
      // clean still has a blank plane's worth of JSON to come back as. A browser
      // restores the tabs it had, and so does this.
      doc: tab.dirty || tab.path === null ? tab.doc : '',
      dirty: tab.dirty,
      cursor: tab.cursor ?? 0,
      scroll: tab.scroll ?? 0,
      anchor: tab.anchor,
      ...(tab.folds?.length ? { folds: tab.folds } : {}),
      // Which document this is a view of, so two panes on one note come back as
      // one note rather than as two copies of it.
      share: tab.note.key,
      ...(tab.reading ? { reading: true } : {}),
      ...(tab.pinned ? { pinned: true } : {}),
      ...(tab.page === undefined ? {} : { page: tab.page }),
      ...(tab.zoom === undefined ? {} : { zoom: tab.zoom }),
      ...(tab.address === undefined ? {} : { address: tab.address }),
    }
  }

  persist() {
    this.session.cancel()

    const state: Session = {
      spaces: this.spaces,
      activeSpace: this.activeSpaceId,
      layout: this.layout(),
      panel: this.panel,
      ...(this.right.length ? { right: [...this.right] } : {}),
      ...(this.rightPanel ? { rightPanel: this.rightPanel } : {}),
      positions: this.positions.all,
      closed: this.closed.stack,
    }

    writeSession(STORAGE_KEY, state)
  }

  /** Writes the session soon rather than now, so a burst of typing costs one
   *  write instead of one per keystroke. */
  scheduleSession() {
    this.session()
  }

  /** Where the caret and the scroll are. Recorded as they move, because after
   *  a crash there is no chance to write them down on the way out. */
  noteView(
    id: string,
    cursor: number,
    scroll: number,
    anchor?: number,
    line?: number,
    folds?: readonly FoldLines[],
  ) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (tab.line !== line) tab.line = line
    // Folding moves neither the caret nor the scroll, so it has to be part of
    // what makes this worth writing down or it would be swallowed here.
    if (
      tab.cursor === cursor &&
      tab.scroll === scroll &&
      tab.anchor === anchor &&
      sameFolds(tab.folds, folds)
    ) {
      return
    }

    tab.cursor = cursor
    tab.scroll = scroll
    tab.anchor = anchor
    tab.folds = folds?.length ? folds : undefined
    if (tab.path) this.positions.remember(tab.path, cursor, scroll, anchor, folds)
    this.scheduleSession()
  }

  /** Which page of a PDF is being read, and how far it is zoomed. What a note
   *  keeps in `noteView`, a PDF keeps here: it is where the tab reopens, and which
   *  page a link copied out of the document names. */
  notePdf(id: string, page: number, zoom: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || (tab.page === page && tab.zoom === zoom)) return

    tab.page = page
    tab.zoom = zoom
    this.scheduleSession()
  }

  /** Where a pane that is only reading has got to. The caret is not the reading
   *  view's to move, so the tab keeps the one it had; the place is what changes,
   *  and it is the same place the editor puts back when the note is written in
   *  again - which is what makes the switch read as one page changing its skin. */
  notePlace(id: string, scroll: number, anchor: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    this.noteView(id, tab.cursor ?? 0, scroll, anchor, tab.line)
  }

  /** Turns a note tab between writing and reading. The focused tab unless one is
   *  named, since that is what every key and every menu row means by "this note".
   *  The graph is not a note and has no other face. */
  toggleReading(tabId: string = this.activeTabId ?? '') {
    const tab = this.tabs.find((one) => one.id === tabId)
    if (tab?.kind !== 'note') return

    tab.reading = !tab.reading
    // Reading a note is not writing in it, so a preview tab that is being read
    // is still only being previewed; nothing else about the tab changes.
    this.scheduleSession()
  }

  openBlank(name = UNTITLED, doc = '') {
    const note = this.document({ kind: 'note', path: null, name, text: doc, dirty: !!doc })
    this.add(new Tab(note, this.panes.focusedId))
  }

  /** A new plane, and a new stack of paper: a tab, and nothing else.
   *
   *  No file in the space and no row in the list until somebody saves it, which is what
   *  a new note has always been and what Emil asked for the other three to be: *"if you
   *  create a new webnote by clicking the plus for a new tab, then it should open it as
   *  a tab and not create it in the sidebar. Same for canvas and page notes. And like
   *  normal notes, then can then of course be saved as well, but they should be able to
   *  exist in an "unsaved" state. Just as a tab, like a browser tab normally would."*
   *
   *  Clean rather than dirty, like the blank page a window used to start with: an
   *  untouched plane has nothing in it to lose, so it wears no dot and closes without a
   *  question, and the first stroke drawn on it is what makes both true. The words are
   *  what a blank one says, so the surface has something to read and the session has
   *  something to keep; see `draftOf` and NewHere.svelte.
   *
   *  The two makers beside these - `createCanvas` and `createPages` - are the file
   *  list's own gesture and still write a named file where they are asked to. */
  async newCanvas() {
    // What an empty plane says, fetched with the first one asked for; see createCanvas.
    const { blankCanvas } = await import('./canvas/format')
    this.openUnsaved('canvas', blankCanvas())
  }

  async newPages() {
    const { blankPages } = await import('@nib/markdown/pages')
    // The paper the reader chose, which the workspace has no opinion about.
    const { modes } = await import('./modes.svelte')
    this.openUnsaved('pages', blankPages(modes.pagesPaper))
  }

  /** One document with no file, in a tab of its own. The blank note goes if there is
   *  one, which is what opening anything real does; see `dropScaffolding`. */
  private openUnsaved(kind: 'canvas' | 'pages', text: string) {
    const file = this.document({ kind, path: null, name: UNTITLED, text, dirty: false })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    this.showNote()
    this.dropScaffolding(tab)
    this.persist()
  }

  /** A file somebody shared on its own, in a tab of its own.
   *
   *  No path, because there is no file here and there is not going to be one: it
   *  is one note out of somebody else's space, and writing a copy of it into a
   *  folder of ours is what sharing exists in order not to do. The words come
   *  down once to fill the tab and travel through the file's room from then on,
   *  which is also what writes them into the owner's space; see rooms.svelte.ts
   *  and docs/sharing.md.
   *
   *  One tab per shared file, the way a canvas and the graph are one: asking for
   *  one that is already open brings it forward. */
  openShared(item: { id: string; name: string; canvas: boolean }, text: string) {
    const existing = this.documents.find((one) => one.shared === item.id)
    const open = existing ? this.tabs.find((tab) => tab.note.key === existing.key) : undefined

    if (open) {
      this.panes.activate(open.paneId, open.id)
      this.showNote()
      return
    }

    const note = this.document({
      kind: item.canvas ? 'canvas' : 'note',
      path: null,
      name: item.name,
      text,
      dirty: false,
      shared: item.id,
    })

    const tab = new Tab(note, this.panes.focusedId)
    this.add(tab)
    this.dropScaffolding(tab)
    this.showNote()
  }

  /** Whether a file somebody shared is open right now, so the switcher's row can
   *  say which one is being read. */
  showingShared(id: string): boolean {
    return this.documents.some((one) => one.shared === id)
  }

  /** A shared file that is no longer shared: every tab of it goes.
   *
   *  The calm answer a revoked space already gives, said about one file. Nothing
   *  is asked and nothing is kept: the words were never this machine's, and a tab
   *  left open on a room that will not have it back is a tab that quietly stops
   *  being a document. */
  closeShared(id: string) {
    for (const tab of this.tabs.filter((one) => one.note.shared === id)) this.close(tab.id)
  }

  /** A document, made once per file however many things ask for it at once and
   *  wired so that every change to it - a keystroke in any pane, an undo, a picture
   *  dropped in - reaches the app exactly once. See workspace/open.ts, which is
   *  where the wiring above this lives and which this hands straight through to. */
  private document(start: DocumentStart): NoteDoc {
    return this.opened.make(start)
  }

  /** Whether the note at a path keeps itself, which is to say whether saving it
   *  is anybody's job. A note in a space is Nib's to look after: it is written as
   *  soon as the typing pauses, an account carries it away when there is one, and
   *  a room carries every keystroke while another device is in it. Nobody has to
   *  save such a note, so nothing asks them to - no mark, no question on the way
   *  out, and no auto-save to turn on, because it is always on.
   *
   *  A file opened from the computer is the other case, and the only one: it lives
   *  outside every space, nothing here is looking after it, and writing over
   *  somebody's own file is not something to do behind their back. Saving is
   *  theirs to ask for, and it wears the mark until they do.
   *
   *  Whether an account is signed in does not come into it. A space is a space:
   *  what the reader sees must not change under them when a sync stops. */
  keepsItself(path: string | null): boolean {
    return path !== null && this.spaces.some((one) => within(one.root, path) !== null)
  }

  /** Puts a tab in its pane and shows it. On a phone and a tablet the tab that
   *  was there goes as this one arrives; see `onlyOne`. */
  private add(tab: Tab, activate = true): Tab {
    this.tabs = [...this.tabs, tab]
    if (activate) {
      this.panes.activate(tab.paneId, tab.id)
      this.onlyOne(tab)
    }

    return tab
  }

  /** One document open at a time, which is what a phone and a tablet get: a
   *  strip of tabs on a screen that narrow is more than it can say, and the
   *  thing being read is the only thing there is room for. So opening a note, a
   *  canvas or a paper puts away the one that was there rather than standing it
   *  beside it.
   *
   *  Nothing is lost. What was open goes on the closed stack with its words, so
   *  back brings it straight back, and a note in a space was written down before
   *  it was closed - the account has it whatever this window shows.
   *
   *  A desktop keeps every tab and every pane it has always had. */
  private onlyOne(kept: Tab) {
    if (!viewport.touch) return

    for (const other of this.tabs) {
      if (other.id !== kept.id) this.close(other.id)
    }
  }

  /** One pane, one document: what a phone and a tablet come down to, wherever an
   *  arrangement arrives from - a session, a saved layout, or a window that has
   *  just become one of those devices. The pane that had the focus is the one
   *  kept, with the document that was showing in it. */
  oneDocument() {
    if (!viewport.touch) return

    this.collapsePanes()
    const kept = this.active ?? this.tabs[0]
    if (kept) this.onlyOne(kept)
  }

  /** The graph of the whole space, as a tab of its own. One at a time: a second
   *  picture of the same space says the same thing, so asking again brings the
   *  one already there forward. */
  openGraph() {
    const paneId = this.panes.focusedId
    const existing = this.tabs.find((tab) => tab.kind === 'graph' && tab.paneId === paneId)

    if (existing) this.panes.activate(paneId, existing.id)
    else {
      const note = this.document({
        kind: 'graph',
        path: null,
        name: t('Graph'),
        text: '',
        dirty: false,
      })
      this.add(new Tab(note, paneId))
    }

    this.persist()
  }

  /** A PDF in the space, in a tab of its own. One tab per PDF per pane, the way
   *  the graph is one: asking for a paper that is already open brings it forward
   *  and, when a link named a page, turns to it.
   *
   *  `page` counts from one, and null means wherever the tab was left. */
  openPdf(path: string, page: number | null = null) {
    const paneId = this.panes.focusedId
    const existing = this.tabs.find((tab) => tab.kind === 'pdf' && tab.path === path)

    if (existing) {
      this.activeTabId = existing.id
      if (page !== null) this.gotoPage = { path, page }
    } else {
      const file = this.document({
        kind: 'pdf',
        path,
        name: nameOf(path),
        text: '',
        dirty: false,
      })
      const tab = new Tab(file, paneId)
      if (page !== null) tab.page = page
      this.add(tab)
      this.dropScaffolding(tab)
    }

    this.showNote()
    this.remember(path)
    this.persist()
  }

  /** A canvas in the space, in a tab of its own. One tab per canvas, the way the
   *  graph is one: asking for a plane that is already open brings it forward.
   *
   *  Its words are the JSON in the file, so the tab holds a document exactly as a
   *  note's tab does: whether it keeps itself, the mark, Ctrl+S and the closing
   *  question all work here without knowing what a canvas is. What differs is the
   *  surface drawn on top of those words. */
  async openCanvas(path: string) {
    this.showTab(await this.opened.opening(path, () => this.openPlane(path)))
  }

  /** Brings the pane showing a document forward, and answers the tab it is in.
   *  What every opener ends with, whether this call did the opening or found the
   *  file already open. Null for a file that could not be opened at all. */
  private showTab(note: NoteDoc | null): Tab | null {
    const tab = note && this.tabs.find((one) => one.note === note)
    if (!tab) return null

    this.activeTabId = tab.id
    this.showNote()
    return tab
  }

  /** The document one open of a canvas comes to. Only `openCanvas` calls it, and
   *  only through the one open. */
  private async openPlane(path: string): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    // Gone, or unreadable. A canvas that cannot be read is not a blank plane to
    // draw on: saving one over it would take the file with it.
    if (text === null) return null

    // The plane read here and the thread handed over before the tab is built, so
    // the parse and the surface's mount are two tasks rather than one. A canvas of
    // ten thousand strokes is 2.8 MB of JSON, thirty milliseconds of parse, and it
    // used to land in the same task as the mount. Fetched rather than imported: the
    // canvas format is not in the graph a window that opens on a note evaluates,
    // and it is not going in it - see test/weight.test.ts. `parseAhead` says why
    // this is not a worker.
    const { parseAhead } = await import('./canvas/format')
    parseAhead(text)
    await nextTask()

    const file = this.document({
      kind: 'canvas',
      path,
      name: nameOf(path),
      text,
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    this.add(tab)
    this.dropScaffolding(tab)

    // The notes a canvas holds are links out of it, which is what the Links
    // panel shows while the canvas is the tab being looked at.
    links.canvasRead(path, text)

    this.remember(path)
    this.persist()
    return file
  }

  /** A website in the space, in a tab of its own: a shortcut file, drawn as the page
   *  it points at rather than as the three lines in the file. One tab per file, the
   *  way a canvas is one.
   *
   *  A phone opens the system browser instead, and that is the answer rather than a
   *  gap. A phone app's webview is the app's own: no extensions, no ad blocking, none
   *  of the reader's logins, and no way to hand a page on to anything else. Their
   *  browser has all four, and the file is still theirs in the space - so a website is
   *  a bookmark there, which is what a website on a phone is worth being. Tauri has
   *  no child webviews on a phone either; see docs/web-tabs.md. */
  async openWeb(path: string) {
    // Not in front of a pair of glasses, for the reason a canvas is not: there is no
    // page on seven lines of a heads-up display, and the viewer is not in that build
    // at all. See vite.even.config.ts.
    if (isPlugin()) return

    // Already open, before anything is written: the conversion below makes a file.
    const held = this.opened.at(path)
    if (held) {
      this.showTab(held)
      return
    }

    // A website written when a website was a note becomes a shortcut the first time
    // it is opened, and it is the shortcut that opens. A note that turns out not to
    // be one - somebody took the line out - opens as the note it is.
    const opening = isWebTarget(path) ? path : await asShortcut(this, path)
    if (opening === null) {
      await this.open(path)
      return
    }

    this.showTab(await this.opened.opening(opening, () => this.openSite(opening)))
  }

  /** The document one open of a website comes to. Only `openWeb` calls it, and only
   *  through the one open. */
  private async openSite(opening: string): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path: opening }).catch(() => null)
    const said = readWebFile(opening, text)

    if (viewport.device === 'phone') {
      // A shortcut nobody has given an address yet has nothing to open there, and a
      // phone has no bar to type one into.
      if (said) await openExternal(said.url)
      this.remember(opening)
      return null
    }

    const file = this.document({
      kind: 'web',
      path: opening,
      name: nameOf(opening),
      text: text ?? '',
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    if (said) tab.address = said.url

    // What the file says, so the bar reads as the page before the page has answered:
    // the address it points at, and the title it was written with - which is the
    // file's own name where the file does not say.
    const page = pages.of(tab.id)
    page.url = said?.url ?? null
    page.title = said?.title ?? shownName(nameOf(opening))

    this.add(tab)
    this.dropScaffolding(tab)

    this.remember(opening)
    this.persist()
    return file
  }

  /** Every website still written as a note, converted where it stands; see
   *  web-tab/convert. Answers how many there were, for the palette. */
  async convertWebsites(): Promise<number> {
    return convertWebsites(this)
  }

  /** A web tab with nowhere to go yet: what "Open a website" makes. The address
   *  field takes the keyboard, and the file is written as soon as the page says what
   *  it is called; see `keepWeb`.
   *
   *  No file first, because this is the gesture that starts with an address rather
   *  than with a name: a folder of `Untitled` shortcuts is what asking for a name
   *  first would leave behind. The file list's own gesture asks for the name, because
   *  there the row is the thing being made; see `createWebsite`. */
  openWebsite() {
    if (viewport.device === 'phone') return

    const file = this.document({
      kind: 'web',
      path: null,
      name: t('Website'),
      text: '',
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    this.add(tab)
    this.dropScaffolding(tab)
    this.showNote()
    this.persist()
  }

  /** A page somebody pressed a link to, as a tab in this window.
   *
   *  The address is already known, which is what makes this the other half of
   *  `openWebsite`: there is nothing to type, so the tab arrives on the page. Whether
   *  it arrives in front of the reader or only in the strip is the browser's own rule
   *  about which modifier was held, decided in open-link.ts and not here.
   *
   *  Nothing is written down. A tab with no file is a browser tab until Ctrl+S makes a
   *  shortcut of it, which is exactly what a link followed and closed again deserves:
   *  a folder full of `.url` files nobody asked for is what writing here would leave
   *  behind. See `keepWeb`.
   *
   *  `pane` is for a page asking for one of its own - `target="_blank"` - so the tab
   *  it asks for lands beside it rather than wherever the interface last had focus. */
  openPage(url: string, behind = false, pane?: string) {
    if (viewport.device === 'phone') return

    // A phone and a tablet hold one document, so there is no behind for a tab to be
    // in: one put there would be one the reader has no strip to find it in. See
    // `onlyOne`.
    const back = behind && !viewport.touch

    const file = this.document({
      kind: 'web',
      path: null,
      name: plainOrigin(url),
      text: '',
      dirty: false,
    })
    const tab = new Tab(file, pane ?? this.panes.focusedId)
    tab.address = url

    // The site, so the strip and the bar read as the page before the page has
    // answered - the same three lines `openSite` writes for a website with a file.
    const page = pages.of(tab.id)
    page.url = url
    page.title = plainOrigin(url)

    this.add(tab, !back)
    if (!back) {
      this.showNote()
      // Only for a tab in front: a page arriving behind the reader is not a reason to
      // close the blank note they are looking at.
      this.dropScaffolding(tab)
    }

    this.persist()
  }

  /** A website in a folder, named before it has an address.
   *
   *  The file list's gesture, and the mirror of a note's: a row goes into the tree
   *  waiting to be named, the name it is given is the title, and the shortcut is
   *  written the moment there is one - with no address in it yet, because the address
   *  is what the bar asks for next. The row is in the list from that moment, which is
   *  the whole point of naming a thing before making it.
   *
   *  Where there is no list to type in, the same stepped `Untitled` every other kind
   *  falls back to.
   *
   *  What arrives from the list is a file name, ending and all - the field puts the
   *  row's own ending back before it commits, as it does for every other kind - so
   *  the ending comes off before the name is read as a title. Without that the row
   *  wrote `Blog.url.url` and put `Blog.url` in the shortcut's own `Title`, which is
   *  the `.url` Emil kept seeing in the file list. */
  async createWebsite(folder?: string, named?: string) {
    if (viewport.device === 'phone') return

    const dir = folder ?? this.activeSpace?.root
    if (!dir) return
    if (named === undefined && this.startNaming('web', dir)) return

    const title = named === undefined ? UNTITLED : shownName(named)
    const path = joinPath(dir, this.freeName(dir, `${nameFromTitle(title) ?? UNTITLED}.url`))
    const content = writeShortcut('', title, new Date())

    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const file = this.document({
      kind: 'web',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    pages.of(tab.id).title = title

    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await invoke('write_note', { path, content })
    await this.loadTree()
    this.persist()
  }

  /** The address a web tab's file says, or null for a tab with no file yet and for
   *  one whose file has no address in it. */
  webAddressOf(tab: Tab): string | null {
    if (tab.kind !== 'web' || tab.path === null) return null
    return readWebFile(tab.path, tab.doc)?.url ?? null
  }

  /** The reader typed an address into the bar, which is the one thing that changes
   *  where a website points.
   *
   *  Following a link inside the page does not: the file says where the document
   *  points and the session remembers where the reading got to, so a file that moved
   *  under every click would be a file no link could point at. See `webWalked`. */
  async webAimed(tab: Tab, url: string) {
    if (tab.kind !== 'web' || tab.path === null) return

    const was = readWebFile(tab.path, tab.doc)
    if (was?.url === url) return

    const title = was?.title ?? shownName(nameOf(tab.path))
    const content = writeShortcut(url, title, new Date())
    tab.note.replace(content, false)

    await invoke('write_note', { path: tab.path, content }).catch(() => undefined)
    this.persist()
  }

  /** The page a web tab went to, written down for the session so a restart comes
   *  back on it. Not into the file: following a link is browsing, and the file says
   *  where the document points. */
  webWalked(tab: Tab, url: string) {
    if (tab.address === url) return

    tab.address = url
    this.scheduleSession()
  }

  /** Which web tabs are in the middle of being written, so two reports of the same
   *  page do not write two files. */
  private readonly keeping = new Set<string>()

  /** What the strip calls a website nobody has saved: whatever the page calls itself.
   *
   *  A tab with no file is a browser tab, so it wears the page's own title and the
   *  page's own mark and there is nothing on disk saying either. A tab that has a file
   *  is left alone: a page renaming its own file as somebody reads it would be a file
   *  moving under every link to it. */
  webNamed(tab: Tab, title: string) {
    if (tab.kind !== 'web' || tab.path !== null) return

    const named = title.trim()
    if (named && tab.name !== named) tab.name = named
  }

  /** Writes the shortcut for a website that has none, which is what saving one means.
   *
   *  Emil, 2026-09-14: a new web tab *"should open it as a tab and not create it in the
   *  sidebar ... they should be able to exist in an "unsaved" state. Just as a tab, like
   *  a browser tab normally would."* So nothing is written while somebody is only
   *  reading, and this is the moment they say to keep it: the address the tab is on, the
   *  title the page reported, and the site's own mark, in the folder the sheet asked
   *  about. From here on it is an ordinary file and the reading follows it; see keep.ts.
   *
   *  The tab becomes the saved one in place - the same tab, the same page, still live -
   *  because all that changes is which file the document is of.
   *
   *  Which makes this the one gesture that gives a file to a document that already
   *  exists, and so the one that can put a second document on a file. The name came
   *  from the save sheet, which stepped it aside by number off the file list - and a
   *  listing is a round trip behind what is open, so two tabs kept in the same
   *  instant were handed the same name. It is asked for again here, against what is
   *  open as well as what is listed, and claimed before the write begins: the same
   *  rule and the same owner as opening a file. See workspace/open.ts. */
  async keepWeb(tab: Tab, path: string) {
    if (tab.kind !== 'web' || tab.path !== null || this.keeping.has(tab.id)) return

    // Picked and claimed with nothing between them, which is the whole of it: a
    // second keep of the same name finds this one written down however closely it
    // follows, and steps aside by number rather than landing on the same file.
    const dir = folderOf(path)
    const target = joinPath(dir, this.freeName(dir, nameOf(path)))
    await this.opened.opening(target, () => this.keptWeb(tab, target))
  }

  /** The shortcut one keep writes, and the document it leaves at that file. Only
   *  `keepWeb` calls it, and only through the one claim. */
  private async keptWeb(tab: Tab, path: string): Promise<NoteDoc | null> {
    const page = pages.of(tab.id)
    const url = page.url ?? tab.address ?? ''
    const title = (page.title || tab.name || UNTITLED).trim()

    this.keeping.add(tab.id)
    try {
      const text = writeShortcut(url, title, new Date(), undefined, page.icon ?? undefined)

      this.showEntry(this.freshEntry(path, false))
      await invoke('write_note', { path, content: text })
      await this.loadTree()

      tab.note.path = path
      tab.note.name = nameOf(path)
      tab.note.replace(text, false)
      this.remember(path)
      this.persist()
      return tab.note
    } finally {
      this.keeping.delete(tab.id)
    }
  }

  /** A page note in the space, in a tab of its own. The same three lines a canvas
   *  gets, and for the same reason: its words are the JSON in the file, so the tab
   *  holds a document exactly as a note's tab does and everything that crosses
   *  between words and a file works here without knowing what a page is.
   *
   *  `page` counts from one, and null means wherever the tab was left. */
  async openPages(path: string, page: number | null = null) {
    const tab = this.showTab(await this.opened.opening(path, () => this.openDeck(path, page)))
    // A deck already open turns to the page the link named. One opening at it is
    // already there, which is what the page it was given says.
    if (tab && page !== null && tab.page !== page) this.gotoPage = { path, page }
  }

  /** The document one open of a page note comes to. Only `openPages` calls it, and
   *  only through the one open. */
  private async openDeck(path: string, page: number | null): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    // Gone, or unreadable. A page note that cannot be read is not blank paper to
    // write on: saving one over it would take the file with it.
    if (text === null) return null

    const file = this.document({
      kind: 'pages',
      path,
      name: nameOf(path),
      text,
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    if (page !== null) tab.page = page
    this.add(tab)
    this.dropScaffolding(tab)

    // A page note made from a PDF names that PDF on every page, which is a link out
    // of it: the same scan a canvas's file nodes go through, because they are file
    // nodes.
    links.canvasRead(path, text)

    this.remember(path)
    this.persist()
    return file
  }

  /** Makes a page note in a folder and opens it. The row asks for the name first
   *  where there is a list to ask in, exactly as a note's and a canvas's do. */
  async createPages(folder?: string, named?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return
    if (named === undefined && this.startNaming('pages', dir)) return

    // What an empty stack of paper says, fetched with the first one asked for. The
    // pages engine is a surface's worth of code, and a window that opens on a note has
    // no stack of paper to read; see surfaces.svelte.ts, where the surface itself comes
    // through.
    const { blankPages } = await import('@nib/markdown/pages')
    // And the paper the reader chose, which the workspace has no opinion about: A4
    // outside North America and Letter inside it are both right, so the store is asked
    // rather than a size assumed. Fetched here rather than imported at the top because
    // this file is about files and that one is about the reader; see the same move for
    // the sync pass in workspace/note-text.ts.
    const { modes } = await import('./modes.svelte')

    const path = joinPath(dir, this.freeName(dir, named ?? PLACEHOLDER.pages))
    const content = blankPages(modes.pagesPaper)

    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const file = this.document({
      kind: 'pages',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await invoke('write_note', { path, content })
    await this.loadTree()
    this.persist()
  }

  /** Which page of a PDF a followed link asked for. Read and taken down by the
   *  pane showing that PDF, the way `goto` is by the one showing a note. */
  gotoPage = $state<{ path: string; page: number } | null>(null)

  /** Opens whatever a row of the file list names: a PDF or a canvas in its own
   *  kind of tab, anything else as a note. Every way in from a listing goes
   *  through here - the tree, the palette, a bookmark, the Links panel, the graph
   *  - so none of them can open a paper or a plane as text.
   *
   *  `open` itself stays about notes: a note is what the caret, the preview tab
   *  and every unsaved word belong to. */
  /** Steps off the welcome note once the account has brought real notes down.
   *
   *  A browser build opens the welcome note because on a first visit there is
   *  nothing else to read. Signing in changes that, and nothing was watching:
   *  the workspace restores seconds before the account does, so somebody who
   *  signs in is left looking at "Welcome to Nib" with their own notes in the
   *  sidebar beside it.
   *
   *  Only when the welcome note is the only thing open and untouched. Somebody
   *  who has written in it, or opened something beside it, has said what they
   *  want on screen. */
  async leaveTheWelcomeNote(): Promise<void> {
    const only = this.tabs.length === 1 ? this.tabs[0] : null
    if (only?.path !== WELCOME_PATH || only.dirty) return

    // Where they were last, if that note is still there, and otherwise the first
    // note that is theirs.
    const mine = this.notes.filter((one) => one.path !== WELCOME_PATH)
    const back = this.recent.find((path) => mine.some((one) => one.path === path))
    const next = back ?? mine[0]?.path
    if (!next) return

    await this.openEntry(next, { activate: true })
    this.close(only.id)
  }

  async openEntry(path: string, options: { activate?: boolean; preview?: boolean } = {}) {
    // Which kind of tab this path is for, or null where this build has no surface
    // for it - a PDF, a canvas or a page note in the plugin. Every reason is in
    // `openerFor`; making the tab is the class's own, below.
    const opener = openerFor(path, (one) => links.urlOf(one) !== null, {
      evenBuild: __EVEN_PLUGIN__,
      isPlugin: isPlugin(),
    })

    switch (opener) {
      case null:
        return
      case 'pdf':
        this.openPdf(path)
        return
      case 'web':
        await this.openWeb(path)
        return
      case 'pages':
        await this.openPages(path)
        return
      case 'canvas':
        await this.openCanvas(path)
        return
      case 'note':
        await this.open(path, options)
        return
    }
  }

  /** Drops the blank untitled tab a window starts with, now that something real
   *  is open. Compared by id, because `this.tabs` holds reactive proxies and
   *  `=== tab` on the object just pushed is never true.
   *
   *  A tab that is not a note is never scaffolding: the graph of the space has no
   *  path and nothing unsaved either, and closing it behind the reader's back
   *  because they opened a note would be a surprise. */
  private dropScaffolding(kept: Tab) {
    for (const other of this.tabsIn(kept.paneId)) {
      if (other.id === kept.id || other.kind !== 'note' || other.path !== null || other.dirty) {
        continue
      }

      this.close(other.id)
    }
  }

  /** Reads the spaces folder, which is the truth about which spaces exist; see
   *  workspace/spaces. */
  async loadSpaces() {
    await spaces.loadSpaces(this)
    mark('spaces listed')
  }

  /** A space the account has that this machine does not. */
  async adoptSpace(name: string, fresh = false): Promise<string | null> {
    return spaces.adoptSpace(this, name, fresh)
  }

  /** Creates a space folder under the one the app owns, and opens it. */
  async addSpace(name: string) {
    return spaces.addSpace(this, name)
  }

  async renameSpace(id: string, name: string) {
    await spaces.renameSpace(this, id, name)
  }

  /** Drops the dragged space in front of `beforeId`, or at the end for null.
   *  Answers whether anything actually moved, so a drag onto itself is quiet. */
  moveSpace(id: string, beforeId: string | null): boolean {
    return spaces.moveSpace(this, id, beforeId)
  }

  /** Takes the account's order, which is the one the other machines see. */
  applySpaceOrder(names: string[]): boolean {
    return spaces.applySpaceOrder(this, names)
  }

  async selectSpace(id: string) {
    await spaces.selectSpace(this, id)
  }

  /** The switcher's way in: the space, and the sidebar it is read in. */
  async showSpace(id: string) {
    await spaces.showSpace(this, id)
  }

  /** True as soon as one note on this machine has something written in it. */
  async hasLocalContent(): Promise<boolean> {
    return spaces.hasLocalContent(this)
  }

  /** Removes every space on this machine. Only ever called with an explicit yes. */
  async eraseLocalSpaces() {
    await spaces.eraseLocalSpaces(this)
  }

  /** Deletes the space's folder, or puts it in this device's trash. */
  async deleteSpace(id: string, keep = false) {
    await spaces.deleteSpace(this, id, keep)
  }

  async loadTree() {
    const root = this.activeSpace?.root
    if (!root) return

    mark('tree asked')
    try {
      this.tree = await invoke<Entry>('read_tree', { root, options: this.treeOptions })
    } catch {
      this.tree = null
    }

    // The three marks around this read are the launch's largest single step on a space
    // of a few thousand notes, and they are three rather than one so that the answer
    // says where: `tree asked` to `tree walked` is the disk, `tree walked` to here is
    // the bridge and the parse, and here to `tree painted` is the rows. See tree.rs.
    mark('tree read')

    // Rows that went away take themselves out of the selection.
    this.picked.keepOnly((path) => !!this.entryAt(path))
    this.keepNaming()

    // And a note the account named that has since landed is the listing's row now
    // rather than a place held for it; see arriving.svelte.ts.
    arriving.prune((path) => !!this.entryAt(path))

    // The link index is of a space, so it is built when the space's tree is - after
    // it, and not awaited. The tree is what is on screen; a scan that reads every
    // note in the space must neither hold it up nor start in the same breath, which
    // on a space of a few thousand notes is the same thing. Opening a second space
    // is the case that is not the launch: see `turn` in startup.svelte.ts, which is
    // what makes the frame with the rows in it go out first either way.
    if (links.rootOf() !== root) {
      void links.build(root)
      // And the search holds the space it is about to be asked about, a turn after
      // the index; see search/warm.svelte.ts. The papers of the space are the same
      // question about the files the notes sit beside: what was read of them before
      // comes back, and what has never been opened is read in idle time.
      void warm.forSpace(root)
      // Imported here rather than at the top, so that a window which never opens a
      // PDF never loads the module that reads one.
      const listed = this.files
      void import('./pdf/extract').then(({ readPapers }) => readPapers(root, listed))
    }
  }

  /** The order this space's list is read in.
   *
   *  Nothing is read off the disk again: the listing in memory is the listing, and
   *  which order it is drawn in is arithmetic over it. So the rows are in their new
   *  places in the frame the menu closes in - a round trip is what this used to cost,
   *  and on a synced folder it was long enough to wonder whether the press landed. */
  setSort(mode: SortMode) {
    const root = this.activeSpace?.root
    if (root === undefined) return

    this.device.setOrder(root, mode)
  }

  toggleHidden() {
    this.treeOptions = { ...this.treeOptions, showHidden: !this.treeOptions.showHidden }
    this.persistTreeOptions()
  }

  private persistTreeOptions() {
    keep(TREE_KEY, JSON.stringify(this.treeOptions))
    void this.loadTree()
  }

  /** Moves a note or folder into another folder. */
  async move(from: string, intoFolder: string) {
    const name = nameOf(from)
    const target = joinPath(intoFolder, name)

    if (target === from || intoFolder.startsWith(from)) return

    // The row is in its new folder as soon as the drop lands.
    this.showMove(from, target)

    // And back where it was if the move did not happen - something already there,
    // a file that has gone. The listing is what the tree really is, and until it is
    // read again the row is sitting in a folder that does not hold it; see `remove`,
    // which puts a row back the same way.
    try {
      await invoke('rename_note', { from, to: target })
    } catch (error) {
      await this.loadTree()
      throw error
    }
    this.positions.move(from, target)

    // A note that moved is a note every link to it has to be pointed at again;
    // see `rename` below, including why this comes before the index is told.
    const rewrote = (await this.retarget(from, target)) > 0
    links.notesMoved(from, target)
    paperMoved(from, target)
    // A folder's icon is kept under its path, so a folder that moved takes its
    // icon and its subfolders' icons with it.
    this.folderIcons.moved(from, target)
    // And the order it was arranged into: it leaves the list of the folder it was
    // in, and a folder that moved takes its own list and every list under it along.
    this.arranged.moved(from, target)
    this.excluded.moved(from, target)
    this.undone.record({ kind: 'move', from, to: target, ...(rewrote ? { rewrote } : {}) })

    // One document per file, so a path that changes moves rather than being written
    // over one of several; see workspace/open.ts.
    const note = this.opened.at(from)
    if (note) {
      note.path = target
      note.name = name
    }

    await this.movedOnAccount(from, target)
    await this.loadTree()
    await this.unnest(folderOf(from))
    this.persist()
  }

  /** A folder that has stopped holding anything but its own note, which is a
   *  folder that has stopped being one: the note comes back up to where the folder
   *  was and the folder goes, so dragging the last row out of a nested note leaves
   *  a note and nothing else behind. See `unnesting` in folder-notes.ts.
   *
   *  Never the space's own root: `entryAt` answers nothing for it, so a space that
   *  happens to hold a note of its own name stays a space. */
  private async unnest(folder: string) {
    const entry = this.entryAt(folder)
    const back = entry && unnesting(entry)
    if (!back) return

    await this.move(back.note, back.into)

    // The row goes as the note comes up rather than a round trip later: an empty
    // folder standing under the note it used to hold reads as half a move.
    this.hideEntry(back.folder)

    // Only if there is nothing at all left in it. The tree leaves out the dotted
    // files and the pictures beside a note, so a folder that looks empty here may
    // still hold the picture the note was written around; see
    // `remove_empty_folder` in src-tauri/src/notes.rs, which refuses rather than
    // taking one with it.
    await invoke('remove_empty_folder', { path: back.folder }).catch(() => undefined)
    await this.loadTree()
  }

  /** `preview` opens the way a single click in the file list does: one tab,
   *  reused by the next preview, and kept only until something is typed in it. */
  /** A drawer covers the note, so choosing one means wanting to see it: the
   *  drawer goes. A sidebar docked beside the note is not in the way and
   *  stays, which is how a tablet on its side reads. */
  private showNote() {
    if (!viewport.drawer || !this.panel) return

    this.panel = null
    this.persist()
  }

  /** Opens what a row of the file list stands for: the file itself, or - for a row
   *  that is a folder - the note that row is drawn as, which may not be written
   *  yet.
   *
   *  Every row opens something, because every row is a note or a file; the twist
   *  at the end of a row is what shows the rows under it. A folder out of
   *  somebody's vault has no note of its own until somebody writes in it, so this
   *  opens the empty page it is: nothing is written by looking, and the first
   *  keystroke is what makes the file. See folder-notes.ts and docs/tree.md. */
  async openRow(path: string, options: { activate?: boolean; preview?: boolean } = {}) {
    const entry = this.entryAt(path)
    if (!entry) return
    if (!entry.is_dir) return this.openEntry(path, options)

    const own = folderNote(entry)
    await this.open(own?.path ?? folderNotePath(path), { ...options, blank: !own })
  }

  async open(
    path: string,
    options: { activate?: boolean; preview?: boolean; blank?: boolean } = {},
  ) {
    // One open of a file at a time, whoever asked: a second click on the row, a link
    // followed twice, a note clicked while the session is still reading that very
    // note. A file already open answers with its document and reads nothing; one
    // still being read is waited out. Either way what comes back is the file's one
    // document, and the tab showing it is the tab this open is about. See
    // workspace/open.ts.
    const note = await this.opened.opening(path, () => this.openNote(path, options))
    const tab = note && this.tabs.find((one) => one.note === note)
    if (!tab) return

    // Opening for real what was only being looked at makes it stay.
    if (!options.preview) this.keep(tab.id)
    if (options.activate !== false) {
      this.activeTabId = tab.id
      this.showNote()
    }
  }

  /** The document one open of a note comes to: the file read, and put in a tab or
   *  taken on by the tab that previews notes. Null for a file that cannot be
   *  opened at all. Only `open` above calls it, and only through the one open. */
  private async openNote(
    path: string,
    options: { activate?: boolean; preview?: boolean; blank?: boolean },
  ): Promise<NoteDoc | null> {
    const found = await invoke<string>('read_note', { path }).catch(() => null)

    // A row the first pass has named whose body has not come down yet. It opens,
    // because a row that does nothing when it is clicked reads as broken, and it
    // opens saying what it is waiting for rather than as an empty note: an empty
    // note is something to type into, and typing into this one would be writing
    // over the copy on its way. See `arrived`, which finishes it.
    //
    // Before the blank below, and for the same reason: a note on its way is not a
    // note nobody has written.
    if (found === null && arriving.coming.has(path)) {
      const waiting = this.document({
        kind: 'note',
        path,
        name: nameOf(path),
        text: '',
        dirty: false,
      })
      const tab = new Tab(waiting, this.panes.focusedId)
      tab.coming = true
      this.add(tab, options.activate !== false)

      this.dropScaffolding(tab)
      this.persist()
      return waiting
    }

    // Gone, or unreadable: nothing to open, and no tab that pretends otherwise.
    // Unless the caller knows the file is not there yet and means to open it all
    // the same: a folder whose note nobody has written. It opens as the empty page
    // it is, and it is written when there are words in it - which is the ordinary
    // save, since a note in a space keeps itself.
    const doc = found ?? (options.blank ? '' : null)
    if (doc === null) return null

    // A preview reuses the one preview tab rather than opening another, and only
    // when that tab is in the pane being worked in: taking over a tab in another
    // pane would change a note nobody was looking at.
    //
    // And only while the preview is the one view of its document. Taking a note on
    // is the document being pointed at another file rather than the tab being handed
    // another document, so a preview that was split into a second pane would move
    // that pane to a note nobody asked it for - the same hole `walk` had, reached by
    // the other door. Such a tab simply stops being the preview: the note opening
    // gets a tab of its own, and that one is the preview from here.
    const reusable =
      options.preview &&
      this.tabs.find(
        (tab) =>
          tab.id === this.previewTabId &&
          tab.kind === 'note' &&
          !tab.dirty &&
          !tab.pinned &&
          tab.paneId === this.panes.focusedId &&
          !this.tabs.some((one) => one.id !== tab.id && one.note === tab.note),
      )

    if (reusable) {
      reusable.note.adopt({ path, name: nameOf(path), text: doc })
      this.walked(reusable, path)
      this.placeAt(reusable, path)
      // A note arriving in the preview tab is a note opening, and a note opens
      // for writing however the tab was left.
      reusable.reading = false

      this.remember(path)
      this.persist()
      return reusable.note
    }

    const note = this.document({
      kind: 'note',
      path,
      name: nameOf(path),
      text: doc,
      dirty: false,
    })
    const tab = new Tab(note, this.panes.focusedId)
    this.walked(tab, path)
    this.placeAt(tab, path)
    this.add(tab, options.activate !== false)

    this.previewTabId = options.preview ? tab.id : this.previewTabId
    this.remember(path)

    this.dropScaffolding(tab)
    this.persist()
    return note
  }

  /** Where the note was last being read on this device. */
  private placeAt(tab: Tab, path: string) {
    const place = this.positions.of(path)
    tab.cursor = place.cursor
    tab.scroll = place.scroll
    tab.anchor = place.anchor
    tab.folds = place.folds
  }

  /** A note named the way the space speaks of it, which is how the link index and
   *  the graph name them, opened the way a row in the file list opens: a look on
   *  one click, a tab of its own on two. */
  openRelative(relative: string, keep: boolean) {
    const root = this.activeSpace?.root
    if (!root) return

    void this.openEntry(insideSpace(root, relative), keep ? {} : { preview: true })
  }

  activate(id: string) {
    this.activeTabId = id
    this.persist()
  }

  /** Which pane a key or a command is talking about. */
  focusPane(id: string) {
    this.panes.focus(id)
  }

  /** The tab a pane is showing, which is what the pane is about. */
  showing(paneId: string): Tab | null {
    const id = this.panes.at(paneId)?.activeTabId
    return (id ? this.tabs.find((tab) => tab.id === id) : null) ?? null
  }

  /** Writes a note down as where this tab now is.
   *
   *  What was ahead of it is dropped, the way it is in anything that goes back
   *  and forward: arriving somewhere new from halfway along a trail makes the
   *  rest of that trail a road not taken. Arriving where it already is changes
   *  nothing, so opening the same note twice does not fill the trail with it. */
  private walked(tab: Tab, path: string) {
    if (tab.trail[tab.at] === path) return

    const behind = tab.trail.slice(0, tab.at + 1)
    tab.trail = [...behind, path].slice(-TRAIL)
    tab.at = tab.trail.length - 1
  }

  /** Shows the note this tab was on before this one, or the one it came back
   *  from. `to` is where along the trail to land, which the two steps and the
   *  list behind the back arrow all say for themselves.
   *
   *  A step is an opening like any other, and goes through the one place that says
   *  what a file is open as: the tab is pointed at that file's document - the one
   *  that is already open on it, or one made from the file here - and the editor
   *  keeps its own state per note, so the caret lands where it was left in the note
   *  being returned to.
   *
   *  It used to read the file and have the tab's own document take the note on,
   *  which went around all of that. Two things came of it and both are one note's
   *  words under another note's name: a step back to a note another pane was
   *  showing made a second set of words over one file, and a step back in a tab
   *  whose document a second pane shared moved that pane to the note as well. See
   *  workspace/open.ts.
   *
   *  A note that has gone from the disk is dropped from the trail rather than
   *  reported: it is a road that is no longer there. */
  async walk(to: number, id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || to < 0 || to >= tab.trail.length || to === tab.at) return

    const path = tab.trail[to]
    if (path === undefined) return

    this.flush()
    const note = await this.opened.opening(path, () => this.stepped(tab, path))
    if (!note) {
      tab.trail = tab.trail.filter((one) => one !== path)
      tab.at = Math.min(tab.at, Math.max(tab.trail.length - 1, 0))
      return
    }

    // The file was already open, so this step joins what is showing it. `stepped`
    // has done this for a file it read itself, before the open was let go of.
    tab.note = note
    tab.at = to
    this.placeAt(tab, path)
    tab.reading = false

    // Walking back does not make a tab stay: a tab that was only being looked at
    // is still only being looked at two notes ago, and taking the preview away
    // here would give the next click in the file list a tab of its own - and the
    // trail with it.
    this.activeTabId = tab.id
    this.showNote()
    this.remember(path)
    this.persist()
  }

  /** The document one step along a trail comes to, put in the tab that stepped.
   *  Only `walk` calls it, and only through the one open.
   *
   *  The tab is pointed at the document inside the open rather than after it, for
   *  the reason the open exists: what is open is the tabs, so a document that is in
   *  no tab yet is a file nothing says is open - and the next opener of it would
   *  read the file a second time. */
  private async stepped(tab: Tab, path: string): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text === null) return null

    const note = this.document({ kind: 'note', path, name: nameOf(path), text, dirty: false })
    tab.note = note
    return note
  }

  /** One step back, and one step on. */
  goBack(id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    // In a web tab the trail is the page's own history, which is the browser's
    // meaning of the same key rather than a second one; see web-tab/pages.svelte.ts.
    if (tab.kind === 'web') void pages.step(tab.id, 'back')
    else void this.walk(tab.at - 1, tab.id)
  }

  goForward(id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    if (tab.kind === 'web') void pages.step(tab.id, 'forward')
    else void this.walk(tab.at + 1, tab.id)
  }

  /** Holds a tab at the front of its strip, or lets it go again.
   *
   *  Pinning keeps the note as well: a tab nobody wants taken over is a tab that
   *  is being kept, and the two would otherwise have to be said one after the
   *  other. The tab moves to the end of the pinned run rather than being sorted
   *  on the way out, so every place that counts along a strip - the numbered
   *  keys, Ctrl+Tab, where a closed tab comes back - counts the same order the
   *  reader sees. Where a tab may sit once it is pinned is workspace/pinning.ts,
   *  which is the one rule the drags and the drops go through as well.
   *
   *  This machine's own, like the rest of the session: which of somebody's notes
   *  are worth a chip on this screen is a fact about the screen. It is written
   *  into `nib:workspace` with everything else that is open and comes back with
   *  the window; the account never hears of it. */
  togglePin(id: string) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    tab.pinned = !tab.pinned
    if (tab.pinned) this.keep(id)

    // The end of the pinned run either way: pinned, it joins the back of it;
    // let go of, it lands at the front of what is not pinned, which is the same
    // place.
    const others = this.tabsIn(tab.paneId).filter((one) => one.id !== id)
    this.tabs = this.placed(tab, tab.paneId, pinnedRun(others))
    this.persist()
  }

  /** Makes a tab that was only previewing its note stay: the italic goes, and
   *  the next single click in the file list gets a tab of its own instead of
   *  taking this one over. Every way of keeping a preview ends up here -
   *  typing in it, opening the note for real from the list, a double click or
   *  "Keep open" on the tab itself - so they cannot drift apart. Asking about
   *  a tab that is not the preview changes nothing. */
  keep(id: string) {
    if (this.previewTabId === id) this.previewTabId = null
  }

  /** Closes a tab, asking first when the note in it holds work that is not on
   *  disk. Every close somebody asked for goes through here: the cross on the
   *  tab, Ctrl+W, the menu row and the palette. `close` below stays the plain
   *  operation, which is what everything that closes a tab because the note has
   *  gone away needs.
   *
   *  Nothing is asked when the note stays open in another pane: closing one of
   *  two views of a note loses nothing at all.
   *
   *  A pinned tab closes like any other. What pinning takes away is the cross, not
   *  the gesture: the tab is a chip with nothing on it to close by accident, and
   *  the two deliberate ways - Ctrl+W and the row in the tab's own menu - still
   *  mean what they say, which is what a browser does with a pinned tab and what
   *  Emil asked for. This used to refuse, and a tab somebody had pinned in the
   *  morning could not be closed at all without being let go of first. */
  async closeAsking(id: string) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (await this.mayClose([tab])) this.close(id)
  }

  /** The tab being worked in, closed with the question. What Ctrl+W, the File
   *  menu, the palette and `:q` all mean by closing. */
  async closeActive() {
    const id = this.activeTabId
    if (id) await this.closeAsking(id)
  }

  /** Every other tab of one pane, asking about whatever is unsaved among them. */
  async closeOthers(keepId: string) {
    const tab = this.tabs.find((one) => one.id === keepId)
    if (!tab) return

    // A pinned tab is not one of the others: it was pinned to stay.
    const others = this.tabsIn(tab.paneId).filter((one) => one.id !== keepId && !one.pinned)
    if (!(await this.mayClose(others))) return

    for (const other of others) this.close(other.id)
  }

  /** Whether the window may go, which is the same question over every tab in it.
   *  See start.ts, which is what prevents the close until this answers. */
  async mayCloseWindow(): Promise<boolean> {
    return this.mayClose(this.tabs)
  }

  /** Whether a set of tabs may all go: the closing question once per note,
   *  however many of the tabs hold it, and nothing asked about a note that stays
   *  open outside the set. Cancel at any one of them stops the lot, because
   *  closing is one gesture and half of it done is worse than none.
   *
   *  Asked of documents rather than of tabs throughout: a note is the thing with
   *  words in it, and a tab is only a way of looking at one. */
  private async mayClose(closing: readonly Tab[]): Promise<boolean> {
    this.flush()

    const going = closing.map((tab) => tab.id)
    const asked: NoteDoc[] = []

    for (const tab of closing) {
      if (asked.includes(tab.note)) continue
      asked.push(tab.note)

      if (!tab.note.unsaved) continue
      // A note another pane keeps showing is not going anywhere.
      if (this.tabs.some((one) => one.note === tab.note && !going.includes(one.id))) continue
      if (!(await this.askToClose(tab.note))) return false
    }

    return true
  }

  /** The one question the app asks before words are lost, in three answers
   *  because there are three things a person can mean: write it down, let it go,
   *  or stay where they are.
   *
   *  Saving a note with no home yet goes through the name prompt, the way saving
   *  one always does. A name nobody gives leaves the note unsaved, and then the
   *  close does not happen either. */
  private async askToClose(note: NoteDoc): Promise<boolean> {
    const { prompt } = await import('./prompt.svelte')

    const answer = await prompt.choose({
      title: t('Save {name}?', { name: note.shown }),
      options: [
        { id: 'save', label: key('Save'), primary: true },
        { id: 'discard', label: key('Don’t save'), danger: true },
        { id: 'cancel', label: key('Cancel') },
      ],
    })

    if (answer !== 'save') return answer === 'discard'

    await this.saving.write(note)
    return !note.unsaved
  }

  close(id: string) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    const paneId = tab.paneId
    const at = this.tabsIn(paneId).findIndex((one) => one.id === id)

    // The words as they stand, since a tab closed with something unsaved in it
    // has to bring that back with it.
    this.flush()
    if (worthReopening(tab)) {
      this.closed.record({ draft: this.draftOf(tab), paneId, at: Math.max(at, 0) })
    }

    // The page is a webview of its own, and a tab that has gone is not holding a
    // browser open behind it.
    if (tab.kind === 'web') pages.forget(tab.id)

    this.tabs = this.tabs.filter((one) => one.id !== id)
    if (this.previewTabId === id) this.previewTabId = null

    const left = this.tabsIn(paneId)

    // The last tab of a pane takes the pane with it, and the pane beside it takes the
    // room. The last pane of all stays, and stays empty: what it shows is the kinds a
    // new tab could be, which is what Emil asked for - "it should be possible to have
    // no note open (there should not always open a new one)". See NewHere.svelte.
    if (!left.length) {
      this.panes.close(paneId)
      this.persist()
      return
    }

    if (this.panes.at(paneId)?.activeTabId === id) {
      this.panes.activate(paneId, (left[at] ?? left[left.length - 1])?.id ?? null)
    }

    this.persist()
  }

  /** The tab that was closed last, back where it was: in the pane it was closed
   *  from while that pane is still there, at its own place in the strip, with
   *  whatever was unsaved in it.
   *
   *  A note that has since been deleted cannot come back, so the entry is spent
   *  and the one under it is tried: reaching past a note that is gone is what
   *  somebody pressing the key twice means.
   *
   *  Nothing is dropped to make room for it. Reopening is not opening a note in
   *  the usual sense, and closing the blank page somebody is looking at because
   *  they asked for a tab back would be a surprise. */
  async reopenClosed() {
    for (let closed = this.closed.take(); closed; closed = this.closed.take()) {
      const paneId = this.panes.at(closed.paneId) ? closed.paneId : this.panes.focusedId
      const [tab] = await this.tabsFrom([closed.draft], paneId)
      if (!tab) continue

      this.tabs = this.placed(tab, paneId, closed.at)
      this.panes.activate(paneId, tab.id)
      this.panes.focus(paneId)
      // Where there is room for one document, the one coming back takes the
      // place of the one on screen - and that one goes on the stack in its turn,
      // so back and forward walk the same line.
      this.onlyOne(tab)
      this.persist()
      return
    }
  }

  /** The flat list with a tab put at a place in a pane's strip: `at` counts along
   *  that strip, so the place in the flat list is the one the tab that now holds
   *  the spot occupies. Past the end of the strip, or `null`, means last.
   *
   *  The tab itself is taken out first, so this both puts a new one in and moves
   *  one that is already open.
   *
   *  The place asked for is the place the reader aimed at, and the place taken is
   *  what `placeFor` makes of it: the pinned tabs are a run at the head of the
   *  strip, and this is the one door every drag, drop and reopen goes through, so
   *  none of them has to know that. See workspace/pinning.ts. */
  private placed(tab: Tab, paneId: string, at: number | null): Tab[] {
    const rest = this.tabs.filter((one) => one.id !== tab.id)
    const strip = rest.filter((one) => one.paneId === paneId)
    const place = placeFor(strip, tab.pinned, at)
    const after = place === null ? undefined : strip[place]
    const index = after ? rest.findIndex((one) => one.id === after.id) : -1
    if (index < 0) return [...rest, tab]

    return [...rest.slice(0, index), tab, ...rest.slice(index)]
  }

  /** Brings every open note's words up to what its views hold. Everything that
   *  reads the text of a note calls this first. */
  flush() {
    this.saving.flush()
  }

  /** Text put into a note from somewhere other than the editor: a version
   *  restored from the history, a note pulled in by a sync. */
  replace(text: string, target?: Tab) {
    this.saving.replace(text, target)
  }

  /** Notes holding work nothing else has hold of. */
  get unsaved(): NoteDoc[] {
    return this.saving.unsaved
  }

  /** The open notes a version could be kept of; see recovery.svelte.ts. */
  get worthKeeping(): { key: string; path: string; text: string; revision: number }[] {
    return this.saving.worthKeeping
  }

  /** Writes one tab down, because somebody asked. */
  async save(target?: Tab) {
    await this.saving.save(target)
  }

  /** Notes opened lately, for the palette. The taskbar keeps a list of its
   *  own, which is what the second call puts a note into. */
  get recent(): string[] {
    return this.device.recent
  }

  private remember(path: string) {
    this.device.remember(path)
    if (isDesktop) void invoke('remember_recent', { path }).catch(() => undefined)
  }

  forgetRecent() {
    this.device.forgetRecent()
  }

  /** The icon a space shows in the switcher, if it has been given one. Keyed by
   *  folder rather than id, so it survives the ids being handed out again. */
  iconFor(spaceId: string | null): string | null {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    return space ? this.device.iconOf(space.root) : null
  }

  /** The colour that icon is drawn in, or null for the plain foreground. */
  tintFor(spaceId: string | null): string | null {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    return space ? this.device.tintOf(space.root) : null
  }

  /** An icon and its colour as they came down from the account, and the colour this
   *  machine holds that the account has not heard - which is what asks for it to be
   *  sent up. Which of the two copies wins is next door, in workspace/device. */
  applyIcon(root: string, name: string | null, tint?: string | null): string | null {
    return this.device.applyIcon(root, name, tint)
  }

  /** The icon a folder of the open space wears and the colour it is drawn in, or
   *  none. Beside `setIcon` because the picker reaches both through here and the two
   *  differ only in where the value is kept; see workspace/folder-icons. */
  setFolderIcon(path: string, value: string | null, tint: string | null = null) {
    this.folderIcons.set(path, value, value === null ? null : readTint(tint))
  }

  setIcon(spaceId: string, name: string | null, tint: string | null = null) {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    if (!space) return

    const colour = name === null ? null : readTint(tint)
    this.device.setIcon(space.root, name, colour)

    // Imported here rather than at the top: syncing reads the workspace, and
    // the two would import each other.
    void import('./sync.svelte').then(({ sync }) => sync.pushIcon(space.root, name, colour))
  }

  /** The picked rows. The tree reads it; every change to it goes through the
   *  four calls below, so the anchor a Shift range counts from stays right. */
  get selection(): string[] {
    return this.picked.paths
  }

  isSelected(path: string): boolean {
    return this.picked.has(path)
  }

  /** A plain click: that row alone. */
  select(path: string) {
    this.picked.select(path)
  }

  /** Ctrl-click: in or out, leaving the rest as it is. */
  toggleSelect(path: string) {
    this.picked.toggle(path)
  }

  /** Shift-click: from the anchor to here, in the order the rows are shown. */
  selectRange(path: string) {
    this.picked.range(path, this.visibleRows())
  }

  selectAll() {
    this.picked.all(this.visibleRows())
  }

  clearSelection() {
    this.picked.clear()
  }

  /** Every row the tree shows, top to bottom, and which of them are folders
   *  standing open: a folder's children only while it is open, which is what
   *  Shift-click, Ctrl+A and the arrow keys all mean by "the next one".
   *
   *  The list the panel draws, which is `shownTree` and so includes the rows an
   *  account's first pass has named and not fetched yet: the keys walk what is on
   *  screen, and the window that mounts a slice of those rows counts them from the
   *  same list. One list, numbered once; see tree-flat.ts. */
  visibleTree(): TreeRow[] {
    return flatRows(this.shownTree, (path) => this.isExpanded(path)).map(({ entry }) => ({
      path: entry.path,
      folder: entry.is_dir,
      open: entry.is_dir && this.isExpanded(entry.path),
    }))
  }

  /** The same rows, as the paths on them. */
  visibleRows(): string[] {
    return this.visibleTree().map((row) => row.path)
  }

  /** What a drag from `path` carries: the whole selection when the row is part
   *  of it, the row alone otherwise. */
  dragPayload(path: string): string[] {
    return this.picked.dragging(path)
  }

  async moveMany(paths: string[], intoFolder: string) {
    // A drop on a note lands in the folder that note is about to become, so the
    // note goes in first and what was dropped on it follows: `A.md` becomes
    // `A/A.md`, and the folder is open afterwards because otherwise the row a
    // note was just dragged into swallowed it without a word. See folder-notes.ts.
    const nesting = noteToNest(this.tree, intoFolder)
    if (nesting && !paths.includes(nesting)) {
      // The folder is on the tree before the note is in it. Otherwise the row
      // blinks out - the note has left and the folder it went into does not exist
      // yet - and comes back a round trip later; see tree-edits.ts.
      this.showEntry(this.freshEntry(intoFolder, true))
      await this.move(nesting, intoFolder)
      this.device.expand(intoFolder)
    }

    for (const path of outermost(paths)) await this.move(path, intoFolder)
    this.clearSelection()
  }

  async removeMany(paths: string[]) {
    for (const path of outermost(paths)) {
      const entry = this.entryAt(path)
      if (entry) await this.remove(path, entry.is_dir)
    }
    this.clearSelection()
  }

  entryAt(path: string): Entry | null {
    const found = entryAt(this.tree, path)
    return found && found.path !== this.tree?.path ? found : null
  }

  /** A row put into the tree, taken out of it, or moved within it, before the
   *  filesystem has been asked. The listing that follows every one of these
   *  operations is what the tree really is; this is so the click is answered in
   *  the same frame it happened, rather than after a round trip and a re-read
   *  of the whole folder. An operation that fails undoes itself when the
   *  listing arrives. */
  showEntry(entry: Entry) {
    if (this.tree) this.tree = withEntry(this.tree, entry)
  }

  private hideEntry(path: string) {
    if (this.tree) this.tree = withoutEntry(this.tree, path)
  }

  private showMove(from: string, to: string) {
    if (this.tree) this.tree = withMove(this.tree, from, to)
  }

  /** A row for something that is about to exist. The times are now, which is
   *  what sorting by "created" or "modified" would put it under anyway. */
  freshEntry(path: string, isFolder: boolean): Entry {
    const at = Date.now()
    return {
      name: nameOf(path),
      path,
      is_dir: isFolder,
      modified: at,
      created: at,
      children: [],
    }
  }

  isExpanded(path: string): boolean {
    return this.device.isExpanded(path)
  }

  toggleFolder(path: string) {
    this.device.toggleFolder(path)
  }

  isTagOpen(path: string): boolean {
    return this.device.isTagOpen(path)
  }

  toggleTag(path: string) {
    this.device.toggleTag(path)
  }

  /** Whether a group of bookmarks is open, and opening or shutting one.
   *
   *  On this machine, like the folders in the tree: which groups somebody has
   *  open is how they are looking at the list this afternoon, while the groups
   *  themselves are what they chose to keep and travel with the account. See
   *  device.svelte.ts. */
  isGroupOpen(id: string): boolean {
    return this.device.isGroupOpen(id)
  }

  toggleGroup(id: string) {
    this.device.toggleGroup(id)
  }

  openGroup(id: string) {
    if (!this.device.isGroupOpen(id)) this.device.toggleGroup(id)
  }

  /** Opens a note and lands on the block a bookmark names.
   *
   *  The whole of what a link would say is in the path - `Plan.md#^a1b2c3` or
   *  `Plan.md#The plan` - so this is the same walk a followed link makes, from a
   *  row instead of from a link. */
  async openAtBlock(target: string) {
    const root = this.activeSpace?.root
    if (!root) return

    const cut = target.indexOf('#')
    const relative = cut < 0 ? target : target.slice(0, cut)
    const said = cut < 0 ? '' : target.slice(cut + 1)

    const path = insideSpace(root, relative)
    await this.open(path)
    if (!said) return

    const doc = this.tabs.find((tab) => tab.path === path)?.doc ?? ''
    const line = lineOfTarget(doc, {
      path: relative,
      target: relative,
      heading: said.startsWith('^') ? null : said,
      block: said.startsWith('^') ? said.slice(1) : null,
      page: null,
    })
    if (line !== null) this.goto = { path, line }
  }

  /** Opens a folder and every folder on the way down to it, so a bookmarked
   *  folder can be shown where it sits rather than only named. */
  revealFolder(path: string) {
    const root = this.activeSpace?.root
    if (root === undefined || !path.startsWith(root)) return

    // Each step down is a folder of its own, and its own row to open.
    let here = root
    for (const part of relativeTo(root, path).split('/')) {
      here = joinPath(here, part)
      this.device.expand(here)
    }
  }

  /** Opens a note and lands on one of its headings, the way a link into a
   *  heading does: the note that was just loaded says which line the words are
   *  on, because a bookmark keeps the words and not the line. */
  async openAtHeading(relative: string, heading: string) {
    const root = this.activeSpace?.root
    if (!root) return

    const path = insideSpace(root, relative)
    await this.open(path)

    const doc = this.tabs.find((tab) => tab.path === path)?.doc ?? ''
    const line = lineOfHeading(scanHeadings(doc), heading)
    if (line !== null) this.goto = { path, line }
  }

  /** The space's tags, for the tree above the search field; see
   *  workspace/note-text. */
  async loadTags() {
    await text.loadTags(this)
  }

  /** Renames a tag, and everything under it, in every note of the space. */
  async retagNotes(from: string, to: string | null): Promise<number> {
    return text.retagNotes(this, from, to)
  }

  /** A note's words as they stand: what is on screen when it is open, and what
   *  is on disk otherwise. */
  async noteText(path: string): Promise<string | null> {
    return text.noteText(this, path)
  }

  /** Ticks or clears the box on one line of a note, without opening it. */
  async toggleTaskAt(path: string, line: number): Promise<boolean> {
    return text.toggleTaskAt(this, path, line)
  }

  /** Writes a replacement across the space, as one thing to undo. */
  async replaceInNotes(changes: readonly Change[]) {
    await text.replaceInNotes(this, changes)
  }

  /** Writes the whole of one note that nobody has open, as the one span it changed
   *  by: what the editor in a hover card saves with. */
  async writeNoteText(path: string, before: string, after: string) {
    await text.writeNoteText(this, path, before, after)
  }

  /** Makes a note in a folder.
   *
   *  With no name it is the file list's own gesture: a row goes into the tree
   *  waiting to be named, and nothing is written until it has a name, which is
   *  what Finder, Explorer and VS Code all do. Where there is no list to type in -
   *  the sidebar shut, another panel open, the plus at the end of the tab strip -
   *  the note is made under a stepped `Untitled` straight away, because a gesture
   *  that made nothing at all would read as one that failed. */
  async createNote(folder?: string, named?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return
    if (named === undefined && this.startNaming('note', dir)) return

    // Opens with its own name as the title, so there is something to write
    // under rather than an empty page.
    const name = this.freeName(dir, named ?? PLACEHOLDER.note)
    const path = joinPath(dir, name)
    const content = `# ${shownName(name)}\n\n`

    // The row, the tab and the caret are all there before the file is. Making
    // a note is the one thing that should never feel like waiting for a disk,
    // and everything below knows what the note will say.
    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const note = this.document({
      kind: 'note',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(note, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()
    this.persist()
  }

  /** A note made out of words that were somewhere else: a canvas card that has
   *  outgrown its box. Answers the path it was written to, relative to nothing,
   *  or null when there is no space to write it in.
   *
   *  No tab and no renaming: the card it came from is still what the reader is
   *  looking at, and a note that opened over the plane would take them away from
   *  it. The name is stepped like every other new file's. */
  async noteFrom(text: string, folder?: string): Promise<string | null> {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return null

    const stem = nameFromContent(text) ?? UNTITLED
    const path = joinPath(dir, this.freeName(dir, `${stem}.md`))
    this.showEntry(this.freshEntry(path, false))

    await invoke('write_note', { path, content: text })
    links.noteSaved(path, text)
    await this.loadTree()
    this.persist()

    return path
  }

  /** Makes a canvas in a folder and opens it. The row asks for the name first
   *  where there is a list to ask in, exactly as a note's does; once it has one
   *  the file is written straight away, so the plane on screen and the file on
   *  disk say the same thing from the first frame. */
  async createCanvas(folder?: string, named?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return
    if (named === undefined && this.startNaming('canvas', dir)) return

    // What an empty plane says, fetched with the first one asked for: the reader and
    // writer for JSON Canvas are a surface's worth of code, and a window that opens on
    // a note has no plane to read. The surface itself comes through surfaces.svelte.ts,
    // and the index reads a plane through scan-canvas.ts, which is fetched the same way.
    const { blankCanvas } = await import('./canvas/format')

    const path = joinPath(dir, this.freeName(dir, named ?? PLACEHOLDER.canvas))
    const content = blankCanvas()

    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const file = this.document({
      kind: 'canvas',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await invoke('write_note', { path, content })
    await this.loadTree()
    this.persist()
  }

  /** A note inside a note, which is the one way a space is organised.
   *
   *  The row's own gesture for what a drag does: `A.md` becomes `A/A.md` and the
   *  new note arrives beside it, waiting for a name. A row that is already a
   *  folder - one nib nested, or one out of somebody's vault - only gets the new
   *  note, and a row that can hold nothing gets nothing: a PDF or a picture is not
   *  a place.
   *
   *  Nesting is `moveMany` with nothing to move, which is the one call the drop
   *  makes: it is the folder-note rule in one place, with the same rows put in
   *  optimistically and the same undo. See folder-notes.ts. */
  async createInside(path: string) {
    const entry = this.entryAt(path)
    if (!entry) return

    const folder = entry.is_dir ? path : folderFor(path)
    if (folder === path && !entry.is_dir) return

    if (!entry.is_dir) await this.moveMany([], folder)
    await this.createNote(folder)
  }

  /** A name nothing in the folder answers to: the one asked for, or the one asked
   *  for with a number after it. Every new file steps its name the same way, and a
   *  name typed into a row goes through it as well - the field can only know what
   *  the listing it was drawn from held, and a note that arrived from sync a moment
   *  ago would otherwise be written over.
   *
   *  How it steps is `freePath`, which is the one numbering in the app: a clip, an
   *  import, an export and a note coming back out of Recently deleted all read it.
   *  Its own copy took the last dot of the name for an extension however little was
   *  in front of it, so `.hidden` came back as ` 2.hidden`. */
  freeName(dir: string, wanted: string): string {
    const taken = this.everyPath()
    return freePath(wanted, (candidate) => taken.has(joinPath(dir, candidate)))
  }

  /** Every path in the open space. `notes` holds only files; this counts the
   *  folders between them too.
   *
   *  And the files that are open or on their way to being open. The tree is a
   *  listing, and a listing is a round trip behind what the app has done: a file
   *  written a moment ago is a document with a path and not yet a row, and a file
   *  being written this instant is neither. Said here rather than at each of the
   *  eight gestures that ask for a name, because the gestures are what keep being
   *  added; see `paths` in workspace/open.ts. */
  private everyPath(): Set<string> {
    const out = this.opened.paths
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        out.add(child.path)
        if (child.is_dir) walk(child)
      }
    }

    if (this.tree) walk(this.tree)
    return out
  }

  /** Opens the name field on a row that already exists, which is what renaming is.
   *
   *  Pointless where the field would not be on screen, and each of the two places
   *  it appears has its own answer to that: a row needs the file list, and the
   *  space's name is in the header over every panel, so it needs only that the
   *  sidebar is open at all. */
  startRenaming(path: string, appending = false) {
    const inHeader = this.spaces.some((space) => space.root === path)
    if (!(inHeader ? this.panel !== null : this.panel === 'tree')) return

    this.cancelNaming()
    this.naming = { path, appending, making: null }
  }

  /** A row for something that does not exist yet, waiting for the name that will
   *  make it. Answers whether the list took it: with no file list on screen there
   *  is nowhere to type, and the caller makes the thing itself.
   *
   *  The row is the optimistic insert every other file operation does - a row is
   *  in the tree before the disk has answered, and the listing that follows is what
   *  settles it - put in one step earlier: in its sorted place, in the folder it
   *  belongs to, with that folder open, before there is anything on disk at all. */
  private startNaming(kind: NewKind, dir: string): boolean {
    if (this.panel !== 'tree' || !this.tree) return false

    // A second gesture before the first had a name leaves no row behind it: a row
    // nobody named is a row for something that was never made.
    this.cancelNaming()

    const path = joinPath(dir, this.freeName(dir, PLACEHOLDER[kind]))
    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)
    this.naming = { path, appending: false, making: kind }

    return true
  }

  /** The row that was waiting for a name, made. The placeholder row goes first and
   *  the create puts the real one back, so a write that fails leaves nothing
   *  behind. */
  async makeNamed(name: string) {
    const naming = this.naming
    if (!naming?.making) return

    this.naming = null
    this.hideEntry(naming.path)

    const dir = folderOf(naming.path)
    if (naming.making === 'canvas') await this.createCanvas(dir, name)
    else if (naming.making === 'pages') await this.createPages(dir, name)
    else if (naming.making === 'web') await this.createWebsite(dir, name)
    else await this.createNote(dir, name)
  }

  /** The field is done and there is nothing to write: Escape, a name that cannot
   *  be written, or a name nobody changed. A row that was being made goes with it,
   *  since nothing was ever created. */
  cancelNaming() {
    const naming = this.naming
    this.naming = null
    if (naming?.making) this.hideEntry(naming.path)
  }

  /** Keeps the row a name is being typed on across a fresh listing.
   *
   *  A row that is being made is on no disk, so the listing that just arrived does
   *  not hold it and it is put back; without that, a sync pass landing mid-word
   *  would take the field out from under the caret. A row being renamed that the
   *  listing no longer holds is a file that has gone - deleted on another machine -
   *  and the field goes with it rather than committing a name onto nothing. */
  private keepNaming() {
    const naming = this.naming
    if (!naming) return

    if (naming.making) {
      this.showEntry(this.freshEntry(naming.path, false))
    } else if (!entryAt(this.tree, naming.path)) {
      this.naming = null
    }
  }

  /** What else is in the folder a row sits in, so the field can say a name is
   *  taken before the rename fails on it. The row's own name is left out: keeping
   *  it would make every name its own duplicate and every rename open onto a red
   *  row. */
  namesBeside(path: string): string[] {
    const folder = entryAt(this.tree, folderOf(path))
    return (folder?.children ?? []).filter((one) => one.path !== path).map((one) => one.name)
  }

  async rename(path: string, name: string) {
    const clean = name.trim()
    if (!clean || clean.includes('/') || clean.includes('\\')) return

    const target = joinPath(folderOf(path), clean)
    if (target === path) return

    // The new name is on the row before the rename has happened; the listing
    // that follows is what settles it.
    this.showMove(path, target)
    this.naming = null

    // And back under the name it had if the rename did not happen. The field refuses
    // a name the listing it was drawn from held, so what is left here is a race - a
    // note that arrived from sync, a name that differs from this one only in case,
    // which is the same file to Windows and to a Mac - and the row wore a name
    // nothing answered to until the next listing. See `move` and `remove`.
    try {
      await invoke('rename_note', { from: path, to: target })
    } catch (error) {
      await this.loadTree()
      throw error
    }
    this.positions.move(path, target)

    // Every link to the note now points at a name nothing answers to, so they
    // are rewritten, silently, as Obsidian does. Recorded on the action so that
    // undoing the rename undoes the rewrite with it.
    //
    // Before the index is told the note moved, not after: finding the links that
    // pointed at the old name means resolving them against the space as it was.
    const rewrote = (await this.retarget(path, target)) > 0
    links.notesMoved(path, target)
    paperMoved(path, target)
    this.folderIcons.moved(path, target)
    // A row renamed keeps the place it was arranged into, under its new name.
    this.arranged.moved(path, target)
    this.excluded.moved(path, target)
    this.undone.record({ kind: 'rename', from: path, to: target, ...(rewrote ? { rewrote } : {}) })

    const note = this.opened.at(path)
    if (note) {
      note.flush()
      // A new note is written with its own name as the heading, so renaming it
      // straight afterwards would otherwise leave `# Untitled` at the top. Only
      // while the heading still is the old name; an edited one is the author's.
      const was = `# ${shownName(nameOf(path))}`
      if (note.text === was || note.text.startsWith(was + '\n')) {
        // Nobody typed this, so it goes in the way any other outside edit does.
        note.replace(`# ${shownName(clean)}${note.text.slice(was.length)}`, note.dirty)
      }

      note.path = target
      note.name = nameOf(target)
    }

    await this.movedOnAccount(path, target)
    await this.loadTree()
    this.persist()
  }

  /** And the account, which keeps a note under an id rather than under its name.
   *
   *  Said from the two operations that move a file rather than by whoever asked for
   *  one, because the askers are what keep being added: the field in the file list,
   *  a drag, a drop onto a note, the palette, an automation, an undo, a folder that
   *  stopped holding anything. Every one of them is a `rename` or a `move`, and this
   *  is the sentence both of them owe. See `moved` in sync.svelte.ts, and
   *  `movedHere` in sync/mirror.ts for what the account is told and why the mirror
   *  is re-keyed only afterwards.
   *
   *  Fetched rather than imported, like every other word this store has for the
   *  account: nothing about syncing is in a window that never signs in.
   *
   *  Not private because putting a rename back is a rename, and that lives next
   *  door; see workspace/undoing.ts. */
  async movedOnAccount(from: string, to: string) {
    const { sync } = await import('./sync.svelte')
    await sync.moved(from, to)
  }

  async remove(path: string, isFolder: boolean) {
    // Gone from the tree before the snapshot has been taken and the file has
    // been moved: three round trips is a long time for a row to sit there
    // looking as though the delete had not registered.
    this.hideEntry(path)

    // A deleted note keeps one last snapshot, so the delete is recoverable. A PDF
    // is bytes and not words: there is no snapshot of one, so the only thing that
    // can put it back is the trash, and it is recorded once the trash has it.
    const words = !isFolder && !isPdfTarget(path)
    if (words) {
      const content = await invoke<string>('read_note', { path }).catch(() => '')
      if (content) await invoke('snapshot_note', { path, content }).catch(() => undefined)
      this.undone.record({ kind: 'delete', path, content })
    }

    try {
      // Signed in, the account keeps a copy for 14 days; signed out, this
      // device does, in its own trash folder (see trash.svelte.ts).
      if (account.signedIn) {
        await invoke(isFolder ? 'delete_folder' : 'delete_note', { path })
      } else {
        const entry = await invoke<{ id: string }>('trash_item', {
          path,
          kind: isFolder ? 'folder' : 'note',
        })
        if (words) this.undone.trashed(path, entry.id)
        else if (!isFolder) {
          this.undone.record({ kind: 'delete', path, content: '', trashId: entry.id })
        }
      }
    } catch (error) {
      // The row was hidden before the file was asked to go, so a delete that
      // did not happen has to put it back: the listing is what the tree really
      // is, and until it is read again the row is simply missing.
      await this.loadTree()
      throw error
    }

    for (const tab of this.tabs.filter((entry) => entry.path?.startsWith(path))) {
      this.close(tab.id)
    }

    links.noteGone(path)
    this.folderIcons.gone(path)
    this.arranged.gone(path)
    this.excluded.gone(path)
    // A paper that has gone has no words worth searching any more.
    paperGone(path)
    await this.loadTree()
    // The row deleted may have been the last thing keeping a nested note nested.
    await this.unnest(folderOf(path))
  }

  /** Puts the last file operation back; what each kind means going back is
   *  workspace/undoing.ts, and what is on the stack is workspace/undo.svelte.ts. */
  async undoFileAction() {
    await undoLastFileAction(this)
  }

  /** A note the first pass has just written, by the path it landed at.
   *
   *  A tab that was holding its place takes the words and becomes an ordinary
   *  note. Only that case: a note already open with words of its own is the
   *  syncing loop's business and is settled by the mirror rather than here. See
   *  `pull` in sync/mirror.ts, which says when each body lands. */
  async arrived(path: string) {
    const waiting = this.tabs.filter((tab) => tab.coming && tab.path === path)
    if (!waiting.length) return

    const content = await invoke<string>('read_note', { path }).catch(() => null)
    if (content === null) return

    this.reload(path, content)
    for (const tab of waiting) tab.coming = false
  }

  /** Text written to a note from outside the editor, put into the document if it
   *  is open, which puts it into every pane showing it. */
  reload(path: string, content: string) {
    this.opened.at(path)?.replace(content, false)
  }

  /** Rewrites every link in the space that points at `from` so it points at `to`.
   *  Answers how many notes were touched, so a caller can record whether there is
   *  anything to put back. */
  async retarget(from: string, to: string): Promise<number> {
    const root = this.activeSpace?.root
    if (!root) return 0

    const touched = await links.retarget(from, to, root)

    // A note on screen may be one of the notes that was rewritten.
    this.flush()
    for (const note of this.documents) {
      if (!note.path || note.dirty) continue

      // The file this document is on, which of its notes that is, and where its
      // words had got to, all read before the file is. This is one round trip per
      // open document, which is a click's worth of time, and a click in the file
      // list moves the preview tab on to another note: words read for one note
      // must never land on another. A keystroke in that moment is the same
      // question with a shorter answer - what is on disk is no longer this note's
      // news, and landing it would take the keystroke with it. See
      // NoteDoc.arrivals.
      const path = note.path
      const holding = note.arrivals
      const revision = note.revision
      const fresh = await invoke<string>('read_note', { path }).catch(() => null)
      if (fresh === null) continue
      if (note.path !== path || note.arrivals !== holding || note.revision !== revision) continue

      if (fresh !== note.text) note.replace(fresh, false)
    }

    return touched
  }

  /** Follows a link between notes: opens the note, goes to the heading or the
   *  block it names, and makes the note when the space has none.
   *
   *  Where the caret ends up is worked out from the note that has just been
   *  loaded rather than from the index, because the index knows a heading's words
   *  and not which line they are on - and the note on disk is the authority. */
  async followLink(jump: NoteJump) {
    const root = this.activeSpace?.root
    if (!root) return

    // A PDF, a canvas and a page note are files: a link to one the space does not
    // hold is a link to nothing, never a reason to make a note under that name.
    if (isPdfTarget(jump.target)) {
      if (jump.path) this.openPdf(insideSpace(root, jump.path), jump.page)
      return
    }

    if (isPagesTarget(jump.target)) {
      // `#page=3` means the same thing here as it does in a PDF, because it is the
      // same question about the same kind of thing; see links.ts.
      if (jump.path) await this.openPages(insideSpace(root, jump.path), jump.page)
      return
    }

    if (isCanvasTarget(jump.target)) {
      if (jump.path) await this.openCanvas(insideSpace(root, jump.path))
      return
    }

    const path = jump.path ? insideSpace(root, jump.path) : await this.makeLinked(jump.target, root)
    if (!path) return

    // A website opens as the page it points at, which is what its row in the file
    // list does; `[[Svelte docs]]` is a link to the document and the document is the
    // page, whether the file is a shortcut or one of the notes websites used to be.
    // A heading or a block in such a link means nothing, and the early return is the
    // honest answer to it.
    if (isWebTarget(path) || links.urlOf(path) !== null) {
      await this.openWeb(path)
      return
    }

    await this.open(path)
    if (jump.heading === null && jump.block === null) return

    const doc = this.tabs.find((tab) => tab.path === path)?.doc ?? ''
    const line = lineOfTarget(doc, jump)
    if (line !== null) this.goto = { path, line }
  }

  /** Where a followed link asked to land: which note, and which line of it. Read
   *  and cleared by the app, which is what owns the editor's scroll. */
  goto = $state<{ path: string; line: number } | null>(null)

  /** The note a link names but the space has not got. Made where a link would
   *  look for it: in the folder the link says, or beside the note that links to
   *  it when it says none. */
  private async makeLinked(target: string, root: string): Promise<string | null> {
    const clean = target.replace(/[\\]/g, '/').replace(/^\/+|\/+$/g, '')
    if (!clean) return null

    const here = this.active?.path ? folderOf(relativeTo(root, this.active.path)) : ''
    const relative = clean.includes('/') || !here ? clean : `${here}/${clean}`

    // What a link says is somebody's prose. A note out of a shared space, a room,
    // a sync pull or a paste can say `[[../../../.bashrc]]`, and a note made under
    // that name is a file written over somewhere else on the machine - `write_note`
    // takes any path the app hands it and folds the `..` away rather than refusing
    // it. So the same function the local endpoint and every `nib://` link are
    // judged by decides this too: one rule for the three roads a path somebody
    // else wrote takes into a space. See automation/inside.ts.
    const safe = insideOnly(isMarkdownPath(relative) ? relative : `${relative}.md`)
    if (safe === null) return null

    const path = insideSpace(root, safe)
    const content = `# ${noteName(relative)}\n\n`
    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()

    return path
  }

  /** Appends this note into another, deletes it, and points every link that came
   *  here at the note it went into; see workspace/composing. */
  async mergeInto(from: string, into: string) {
    await composing.mergeInto(this, from, into)
  }

  /** Everything from the caret on becomes a note of its own, with a link left in
   *  its place. */
  async splitAtCaret(at: number) {
    await composing.splitAtCaret(this, at)
  }

  /** The selection becomes a note of its own, with a link in its place. */
  async extractSelection(from: number, to: number) {
    await composing.extractSelection(this, from, to)
  }

  /** A note whose name is the moment it was made, so nothing ever collides with
   *  it and no link to it ever has to be rewritten. The format is the reader's;
   *  see note-id.ts and the Editor settings. */
  async createUniqueNote(format: string, folder?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return

    // Two notes made in the same minute is the one way a moment can be taken, and
    // it steps aside the way every other name in the app does - `Name 2.md`,
    // through `freePath`. Its own numbering said `Name-2.md`, a spelling nothing
    // else in the app writes.
    const name = this.freeName(dir, `${noteId(format)}.md`)

    // Opens with an empty heading and the caret in it: the name is settled, so
    // the only thing left to do is say what the note is about.
    const path = joinPath(dir, name)
    const content = '# '

    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const note = this.document({
      kind: 'note',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = new Tab(note, this.panes.focusedId)
    tab.cursor = content.length
    this.add(tab)
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)
    // The name is settled and the row is waiting for a title after it; typing
    // one leaves `202609070155 Some title.md`, and pressing Enter with nothing
    // typed leaves the timestamp alone.
    this.startRenaming(path, true)

    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()
    this.persist()
  }

  /** What undoing would do, phrased for a menu. Null when there is nothing. */
  get undoLabel(): string | null {
    return this.undone.label
  }

  /** A second copy of a file, beside the first.
   *
   *  `Plan.md` copies to `Plan copy.md`: the word goes beside the name rather than
   *  after the ending, so the copy is still a note in a vault opened next door, and
   *  `copyName` is where that is said. Through `freeName` like every other name the
   *  app writes, because a second copy used to be written straight over the first -
   *  `write_note` replaces what is there, and nothing asked. */
  async duplicate(path: string) {
    const folder = folderOf(path)
    const content = await invoke<string>('read_note', { path })
    const name = this.freeName(folder, copyName(nameOf(path)))

    await invoke('write_note', { path: joinPath(folder, name), content })
    await this.loadTree()
  }

  /** The three panel fields together, for the rules next door to work out the
   *  next set of; see workspace/panels. */
  private get sides(): Sides {
    return { panel: this.panel, rightPanel: this.rightPanel, right: this.right }
  }

  private set sides(next: Sides) {
    this.panel = next.panel
    this.rightPanel = next.rightPanel
    this.right = next.right
    // Every deliberate showing, shutting and moving of a panel comes through here,
    // which is what makes this the one place a choice is noted; see `panelChosen`.
    this.panelChosen = true
    this.persist()
  }

  /** Which side a panel lives on. Left unless it was moved. */
  sideOf(panel: Panel): PanelSide {
    return panels.sideOf(this.right, panel)
  }

  /** The panel open on one side, which is what that side's tab strip marks and
   *  what its body draws. */
  openOn(side: PanelSide): Panel | null {
    return panels.openOn(this.sides, side)
  }

  /** Which tabs one side holds, in the order the strip shows them. */
  panelsOn(side: PanelSide, every: readonly Panel[]): Panel[] {
    return panels.panelsOn(this.right, side, every)
  }

  /** The panel the right side shows when something asks it to open: whatever was
   *  last open there, or the first one that was moved over - which, on a side
   *  holding one panel, is that panel.
   *
   *  One rule, because two things ask it: the bar's own button for that side, and
   *  the drag that pulls the drawer out from that edge on a phone. Nothing until
   *  a panel has been moved over, which is a side that is not drawn at all. */
  get nextRight(): Panel | null {
    return this.rightPanel ?? this.right[0] ?? null
  }

  /** Shows a panel. Asking for the one already showing leaves it showing, which is
   *  what a method called `show` has to mean.
   *
   *  It used to be the switch below, and every caller that meant "show" had to
   *  remember: two of them did, with `if (workspace.panel !== panel)` in front of
   *  the call, and the rest took the file list away instead of opening it - the
   *  menu's own File list row, the bookmarks row of a website, the drag that pulls
   *  the drawer out. The drives met it hardest, because a drive asks for the file
   *  list on every launch and the sitting before it left the file list open: they
   *  spent a minute each waiting for rows they had just closed.
   *
   *  So the fact is held here rather than by everybody who asks for it, and the
   *  gesture that switches says switch; see `togglePanel`. */
  showPanel(next: Panel) {
    if (this.openOn(this.sideOf(next)) === next) return

    this.sides = panels.showing(this.sides, next)
  }

  /** Shows a panel, or shuts it where it is already the one showing: the press on
   *  a panel's own tab, and the button for a side.
   *
   *  A switch belongs to a control somebody is looking at, which knows what it is
   *  showing. The rule itself is `showing` in workspace/panels.ts, which answers
   *  what the two sides are after the press. */
  togglePanel(next: Panel) {
    this.sides = panels.showing(this.sides, next)
  }

  /** Shuts a side whichever panel is in it. */
  closePanel(side: PanelSide = 'left') {
    if (!this.openOn(side)) return

    this.sides = panels.closing(this.sides, side)
  }

  /** Moves a panel to the other side, and takes its open state with it. */
  movePanel(panel: Panel, side: PanelSide) {
    this.sides = panels.moving(this.sides, panel, side)
  }

  toggleSidebar() {
    this.panel = this.panel ? null : 'tree'
    this.panelChosen = true
    this.persist()
  }

  /** The note beside itself, or below itself: another view of the same document
   *  in a pane of its own, opened where this one is being read so the split
   *  starts as two windows onto the same place.
   *
   *  Nothing happens on a phone, where there is one pane and the commands for
   *  this are not offered. */
  split(along: Along, tabId?: string) {
    if (viewport.touch) return

    const tab = tabId ? this.tabs.find((one) => one.id === tabId) : this.active
    if (!tab) return

    const made = this.panes.split(along, tab.paneId)
    if (!made) return

    const beside = new Tab(tab.note, made.id)
    beside.cursor = tab.cursor
    beside.scroll = tab.scroll
    beside.anchor = tab.anchor
    beside.folds = tab.folds

    this.add(beside)
    this.persist()
  }

  /** Whether a pane can still be split that way, which is what hides the entry
   *  rather than offering one that does nothing. */
  canSplit(along: Along, tabId?: string): boolean {
    if (viewport.touch) return false

    const tab = tabId ? this.tabs.find((one) => one.id === tabId) : this.active
    return !!tab && this.panes.splittable(along, tab.paneId)
  }

  /** A tab dragged into a pane, at a place in its strip: `at` counts along that
   *  strip, and past its end - or left out - means last, which is where a tab
   *  dropped on the note rather than on the strip belongs.
   *
   *  The pane it came from goes if that was its last tab, which is the same rule
   *  as closing one: dragging the last tab of a pane onto another pane's strip
   *  is how the two are merged. */
  moveTab(id: string, paneId: string, at: number | null = null) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || !this.panes.at(paneId)) return

    const from = tab.paneId
    // Dropped back where it already is, with no place asked for: nothing moved.
    if (from === paneId && at === null) return

    tab.paneId = paneId
    this.tabs = this.placed(tab, paneId, at)

    if (from !== paneId) {
      const left = this.tabsIn(from)
      if (!left.length) this.panes.close(from)
      else if (this.panes.at(from)?.activeTabId === id) {
        this.panes.activate(from, left[left.length - 1]?.id ?? null)
      }
    }

    this.activeTabId = id
    this.persist()
  }

  /** A tab dropped where the last drag told it: at a place in a strip, in the
   *  middle of a pane, or against one of its sides, which makes a pane there. */
  dropTab(id: string, landing: Landing) {
    if (!this.tabs.some((one) => one.id === id)) return

    if (landing.kind === 'strip') {
      this.moveTab(id, landing.paneId, landing.at)
      return
    }
    if (landing.zone === 'middle') {
      this.moveTab(id, landing.paneId)
      return
    }

    const made = this.panes.split(alongOf(landing.zone), landing.paneId, madeFirst(landing.zone))
    if (made) this.moveTab(id, made.id)
  }

  /** Notes dragged out of the file list onto a pane, opened where they were
   *  dropped: at their place in that pane's strip, or in a pane made against the
   *  side they were held against.
   *
   *  Opened first and split afterwards, so a note that turns out not to be there
   *  to open cannot leave a pane behind with nothing in it. */
  async dropNotes(paths: string[], landing: Landing) {
    if (!this.panes.at(landing.paneId)) return
    this.panes.focus(landing.paneId)

    const opened: string[] = []
    let at = landing.kind === 'strip' ? landing.at : null

    for (const path of paths) {
      await this.openEntry(path)
      const tab = this.active
      if (!tab) continue

      this.moveTab(tab.id, landing.paneId, at)
      if (at !== null) at += 1
      opened.push(tab.id)
    }

    if (landing.kind === 'strip' || landing.zone === 'middle' || !opened.length) return

    const made = this.panes.split(alongOf(landing.zone), landing.paneId, madeFirst(landing.zone))
    if (made) for (const id of opened) this.moveTab(id, made.id)
  }

  /** Whether a tab dropped against that side of a pane would do anything: the
   *  pane has to be able to split that way, and the tab must not be the only one
   *  in the pane being split, which would empty that pane and close it again the
   *  moment the new one opened. What decides which zones a pane offers. */
  canLand(side: Side, paneId: string, tabId: string | null): boolean {
    if (viewport.touch || !this.panes.splittable(alongOf(side), paneId)) return false

    const tab = tabId === null ? null : this.tabs.find((one) => one.id === tabId)
    return !(tab?.paneId === paneId && this.tabsIn(paneId).length < 2)
  }

  /** A pane and everything in it, asking about whatever is unsaved among its
   *  notes. The last pane cannot go: a window with none has nowhere to show a
   *  note. */
  async closePane(paneId: string = this.panes.focusedId) {
    if (this.panes.count < 2) return

    const tabs = this.tabsIn(paneId)
    if (!(await this.mayClose(tabs))) return

    for (const tab of tabs) this.close(tab.id)
  }

  /** The other panes showing the note this one is showing. What the link toggle
   *  appears for, and what a linked pane scrolls with. */
  twins(paneId: string): string[] {
    const note = this.showing(paneId)?.note
    if (!note) return []

    return this.panes.all
      .filter((one) => one.id !== paneId && this.showing(one.id)?.note === note)
      .map((one) => one.id)
  }

  /** The link between the panes showing one note, on or off. One toggle for the
   *  pair rather than one each: it is one relationship, and a pane that says it
   *  is linked while its twin says it is not would be a lie in one of them. */
  toggleLink(paneId: string) {
    const on = !(this.panes.at(paneId)?.linked ?? false)
    for (const id of [paneId, ...this.twins(paneId)]) this.panes.setLinked(id, on)
  }

  /** Whether a pane may lay its notes out as columns at all: it has to hold more than
   *  one note, and the machine has to be one that holds more than one document. A
   *  handheld holds one, so there is nothing to put beside anything. */
  canStack(paneId: string = this.panes.focusedId): boolean {
    if (viewport.touch) return false

    return this.tabsIn(paneId).filter((tab) => tab.kind === 'note' && !tab.reading).length > 1
  }

  /** Whether a pane is stacked. */
  stacked(paneId: string = this.panes.focusedId): boolean {
    return this.panes.at(paneId)?.stacked ?? false
  }

  /** Lays a pane's notes out as columns, or puts them back to one document with a strip
   *  of names over it. A pane's own answer, and remembered with the pane. */
  toggleStacked(paneId: string = this.panes.focusedId) {
    this.panes.setStacked(paneId, !this.stacked(paneId))
    this.persist()
  }

  /** One pane again, with everything in it: what a phone gets, since there is no
   *  room there to put two notes beside each other. */
  collapsePanes() {
    if (this.panes.count < 2) return

    const kept = this.panes.focusedId
    for (const tab of this.tabs) tab.paneId = kept

    this.panes.collapse()
    this.persist()
  }

  /** Keeps the arrangement under a name; see workspace/layouts.svelte.ts. */
  saveLayout(name: string) {
    this.layouts.save(name, this.layout())
  }

  async useLayout(name: string) {
    const layout = this.layouts.of(name)
    if (layout) await this.applyLayout(layout)
  }
}

export const workspace = new Workspace()
