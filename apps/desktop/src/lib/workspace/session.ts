/** The session as it is written down between runs: which spaces there are, how
 *  the panes were arranged, which notes were open in each, and where each was
 *  being read.
 *
 *  Reading it is the interesting half. Storage is not a type system - the entry
 *  may have been written by an older version of the app, or cut short by a full
 *  disk - so nothing here casts. Each field is recognised on its own, and one
 *  that is not recognised is simply absent, which lets an entry bring back the
 *  notes it does hold rather than none of them.
 *
 *  Three shapes have been written so far, and all three are still read: a list
 *  of paths, then one flat strip of tabs, and now a tree of panes with a strip
 *  in each. `version` says which; an entry with none is read by looking for the
 *  fields it does have. */

import type { FoldLines } from '@nib/editor'
import { isPagesTarget, isWebTarget } from '@nib/markdown/links'
import { identifier } from '../identifier'
import { roomKind } from '../rooms/kind'
import { isNumber, isRecord, isString, keep, stringList } from '../stored'
import type { Panel, Space } from '../workspace.svelte'
import type { TabKind } from './documents.svelte'
import { type Along, type Frame, pane } from './pane-tree'

/** The shape this version writes. */
const VERSION = 2

/** One tab as it is written down: enough to put it back exactly, including work
 *  that never reached the disk. */
export interface Draft {
  kind: TabKind
  path: string | null
  name: string
  doc: string
  dirty: boolean
  cursor: number
  scroll: number
  anchor?: number | undefined
  /** What was folded, as pairs of line numbers. Absent for a tab with nothing
   *  folded, which is what a tab is unless it says otherwise. */
  folds?: readonly FoldLines[] | undefined
  /** Which document this tab was a view of. Two panes showing the same note
   *  write the same key here, so a restart puts them back on one document rather
   *  than on two copies of it. Absent for a tab that had it to itself. */
  share?: string | undefined
  /** Whether the tab was showing the note as it reads. Absent for one that was
   *  being written in, which is what a tab is unless it says otherwise. */
  reading?: boolean | undefined
  /** Whether the tab was held at the front of its strip. Absent for the tabs
   *  that were not, which is most of them. */
  pinned?: boolean | undefined
  /** For a PDF: the page it was open at and how far it was zoomed. Absent for a
   *  tab holding a note, which keeps a caret and a scroll instead. */
  page?: number | undefined
  zoom?: number | undefined
  /** For a website: the address it was on, which may not be the one its file says.
   *  Absent for every other kind of tab. */
  address?: string | undefined
}

/** One pane: its strip of tabs, which of them was showing, and whether it was
 *  scrolling with the other pane on the same note. */
export interface PaneDraft {
  id: string
  tabs: Draft[]
  /** Index into `tabs`, not an id: ids are handed out fresh on every run. */
  active: number
  linked: boolean
}

export type FrameDraft =
  | { kind: 'pane'; pane: PaneDraft }
  | { kind: 'split'; id: string; along: Along; fraction: number; sides: [FrameDraft, FrameDraft] }

/** The arrangement, whole: the panes, what is in them, which one had the focus,
 *  and the sidebar. This is what the session is, and what a named layout holds a
 *  copy of; see layouts.svelte.ts. */
export interface Layout {
  frame: FrameDraft
  focused: string
  panel: Panel | null
}

export interface Position {
  cursor: number
  scroll: number
  anchor?: number | undefined
  /** What was folded when the note was last read here. View state, never the
   *  note: a fold is written down beside the scroll and never into the file. */
  folds?: readonly FoldLines[] | undefined
  at: number
}

/** One tab this window has closed, kept so the last one can be reopened.
 *
 *  Written down like everything else here, because closing a note and then
 *  restarting is exactly when reopening it is worth most. It holds the same
 *  draft a tab does, so unsaved words come back with it, plus where it sat. */
export interface ClosedTab {
  draft: Draft
  /** The pane it was closed from. Reopening looks for that pane and settles for
   *  the focused one when it has since gone. */
  paneId: string
  /** Its place in that pane's strip, counting from zero. */
  at: number
}

export interface Session {
  spaces: Space[]
  activeSpace: string | null
  positions?: Record<string, Position>
  /** The panes and everything in them. Written by this version. */
  layout?: Layout
  /** One flat strip of tabs, and the index of the one showing. Written before
   *  there were panes; still read, so an update keeps the notes that were open. */
  tabs?: Draft[]
  active?: number
  /** Written before there were drafts. Still read, for the same reason. */
  openPaths?: string[]
  activePath?: string | null
  /** The tabs this window closed, oldest first; see workspace/closed. */
  closed?: ClosedTab[]
  /** The sidebar, for entries written before it became part of the layout. */
  panel: Panel | null
  /** Which panels this window keeps on the right, and which of them is open.
   *  Absent for a window that has never moved one over, which is every window
   *  until somebody does: the left side is where all four have always been, so
   *  there is no right side at all rather than an empty one. */
  right?: Panel[]
  rightPanel?: Panel | null
}

const PANELS: readonly Panel[] = ['tree', 'outline', 'search', 'links', 'footnotes']

function isPanel(value: unknown): value is Panel {
  return PANELS.some((panel) => panel === value)
}

const TAB_KINDS: readonly TabKind[] = ['note', 'graph', 'pdf', 'canvas', 'pages', 'web']

/** Which kind of tab an entry is, which is its file's name first and what the entry
 *  claims second.
 *
 *  The name wins because the name is what the file is, and because the service asks
 *  the very same question of the very same string when it decides what shape of room
 *  to open; see rooms/kind.ts, which states that rule once for both. An entry written
 *  before there were canvases, one whose kind was lost, or one naming a kind this
 *  version has never heard of used to come back as a note whatever it was called -
 *  and a canvas restored as a note joins the room of a file the service is serving as
 *  a plane, which is the two ends of one file building different documents for it.
 *
 *  A tab no file names is left to say for itself, because there is nothing to ask:
 *  that is the graph, and an unsaved draft. Everything else a name has no opinion
 *  about - a paper being read - it keeps. */
function tabKind(value: unknown, path: unknown): TabKind {
  const said = TAB_KINDS.find((kind) => kind === value) ?? 'note'
  if (typeof path !== 'string') return said

  // A website first of all, because its name is the whole of what it is: a shortcut
  // opened as a note would put three lines of INI in front of somebody in an editor,
  // and a session written before websites had a name of their own says `note` for it.
  if (isWebTarget(path)) return 'web'

  // The two planes are one room and two surfaces, so the extension is asked twice:
  // once for the shape of the document, which `roomKind` answers, and once for who
  // draws it, which only the name can say. Pages first, since a `.pages` file that
  // came back as a canvas would be drawn on an endless plane with its pages
  // invisible - the file would survive, being the same format, and nobody could
  // find their paper.
  if (isPagesTarget(path)) return 'pages'
  if (roomKind(path) === 'plane') return 'canvas'
  // And the other way: a canvas over a file whose name says words would draw an
  // empty plane over the prose in it.
  return said === 'canvas' || said === 'pages' ? 'note' : said
}

function isSpace(value: unknown): value is Space {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.root)
}

/** Folds as they were written down: pairs of line numbers, both whole and the
 *  second past the first. Anything else is dropped rather than guessed at - a
 *  fold over the wrong lines hides words somebody wrote. Nothing at all for an
 *  empty list, so an absent field and an empty one read the same. */
function readFolds(value: unknown): readonly FoldLines[] | null {
  if (!Array.isArray(value)) return null

  const out: FoldLines[] = []
  for (const one of value as unknown[]) {
    if (!Array.isArray(one) || one.length !== 2) continue

    const pair = one as unknown[]
    const head = pair[0]
    const last = pair[1]
    if (!isNumber(head) || !isNumber(last)) continue
    if (!Number.isInteger(head) || !Number.isInteger(last)) continue
    if (head < 1 || last <= head) continue
    out.push([head, last])
  }

  return out.length ? out : null
}

/** One tab, once it reads as one. A draft with no name or no text is not half a
 *  note; it is a corrupt entry. */
export function readDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null

  const { kind, path, name, doc, dirty, cursor, scroll, anchor, share, reading } = value
  const { folds, page, zoom, pinned, address } = value
  if (typeof name !== 'string' || typeof doc !== 'string') return null
  if (path !== null && typeof path !== 'string') return null

  const shut = readFolds(folds)

  return {
    kind: tabKind(kind, path),
    path,
    name,
    doc,
    dirty: dirty === true,
    cursor: isNumber(cursor) ? cursor : 0,
    scroll: isNumber(scroll) ? scroll : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
    ...(shut ? { folds: shut } : {}),
    ...(isString(share) ? { share } : {}),
    ...(reading === true ? { reading: true } : {}),
    ...(pinned === true ? { pinned: true } : {}),
    ...(isNumber(page) && page >= 1 ? { page } : {}),
    ...(isNumber(zoom) && zoom > 0 ? { zoom } : {}),
    ...(isString(address) ? { address } : {}),
  }
}

function readDrafts(value: unknown): Draft[] {
  if (!Array.isArray(value)) return []
  return value.map(readDraft).filter((draft): draft is Draft => draft !== null)
}

function readPane(value: unknown): PaneDraft | null {
  if (!isRecord(value) || !isString(value.id)) return null

  return {
    id: value.id,
    tabs: readDrafts(value.tabs),
    active: isNumber(value.active) ? value.active : 0,
    linked: value.linked === true,
  }
}

const ALONG: readonly Along[] = ['row', 'column']

/** A pane, or a split of two of them. A split missing either side is read as
 *  whichever side it does have, so half an arrangement still opens the notes. */
function readFrame(value: unknown): FrameDraft | null {
  if (!isRecord(value)) return null

  if (value.kind === 'split') {
    const sides = Array.isArray(value.sides) ? value.sides.map(readFrame) : []
    const [first, second] = sides
    if (!first || !second) return first ?? second ?? null

    const along = ALONG.find((one) => one === value.along) ?? 'row'
    const fraction = isNumber(value.fraction) ? value.fraction : 0.5
    const id = isString(value.id) ? value.id : identifier()

    return { kind: 'split', id, along, fraction, sides: [first, second] }
  }

  const pane = readPane(value.pane)
  return pane ? { kind: 'pane', pane } : null
}

export function readLayout(value: unknown): Layout | null {
  if (!isRecord(value)) return null

  const frame = readFrame(value.frame)
  if (!frame) return null

  return {
    frame,
    focused: isString(value.focused) ? value.focused : '',
    panel: isPanel(value.panel) ? value.panel : null,
  }
}

export function readPosition(value: unknown): Position | null {
  if (!isRecord(value)) return null

  const { cursor, scroll, anchor, folds, at } = value
  if (!isNumber(cursor) || !isNumber(scroll)) return null

  const kept = readFolds(folds)

  return {
    cursor,
    scroll,
    at: isNumber(at) ? at : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
    ...(kept ? { folds: kept } : {}),
  }
}

/** Where notes were last looked at, by path, dropping any entry that no longer
 *  reads as a place. One unreadable entry says nothing about the others. */
function readPositions(value: unknown): Record<string, Position> {
  if (!isRecord(value)) return {}

  const out: Record<string, Position> = {}
  for (const [path, one] of Object.entries(value)) {
    const place = readPosition(one)
    if (place) out[path] = place
  }

  return out
}

/** One closed tab, once it reads as one. A record with no draft in it says
 *  nothing about which tab it was, so it is dropped rather than reopened as a
 *  blank page. */
export function readClosed(value: unknown): ClosedTab | null {
  if (!isRecord(value)) return null

  const draft = readDraft(value.draft)
  if (!draft) return null

  return {
    draft,
    paneId: isString(value.paneId) ? value.paneId : '',
    at: isNumber(value.at) && value.at >= 0 ? value.at : 0,
  }
}

export function readSession(value: unknown): Session | null {
  if (!isRecord(value)) return null

  const layout = readLayout(value.layout)
  const drafts = Array.isArray(value.tabs) ? readDrafts(value.tabs) : null
  const openPaths = stringList(value.openPaths)

  return {
    spaces: Array.isArray(value.spaces) ? value.spaces.filter(isSpace) : [],
    activeSpace: isString(value.activeSpace) ? value.activeSpace : null,
    panel: layout?.panel ?? (isPanel(value.panel) ? value.panel : null),
    // Only what reads as a panel, and only once each: a list written by hand
    // would otherwise put a side's own tab strip out of step with itself.
    ...(Array.isArray(value.right) ? { right: [...new Set(value.right.filter(isPanel))] } : {}),
    ...(isPanel(value.rightPanel) ? { rightPanel: value.rightPanel } : {}),
    positions: readPositions(value.positions),
    ...(layout ? { layout } : {}),
    ...(drafts ? { tabs: drafts } : {}),
    ...(isNumber(value.active) ? { active: value.active } : {}),
    ...(openPaths ? { openPaths } : {}),
    ...(isString(value.activePath) ? { activePath: value.activePath } : {}),
    closed: Array.isArray(value.closed)
      ? value.closed.map(readClosed).filter((one): one is ClosedTab => one !== null)
      : [],
  }
}

/** Every pane of an arrangement, in the order they were laid out. */
export function panesOf(frame: FrameDraft): PaneDraft[] {
  if (frame.kind === 'pane') return [frame.pane]
  return [...panesOf(frame.sides[0]), ...panesOf(frame.sides[1])]
}

/** The written shape as a tree the app can run on. `showing` says which of a
 *  pane's tabs is the one on show, by the id the tab was given on the way in. */
export function frameOf(draft: FrameDraft, showing: (pane: PaneDraft) => string | null): Frame {
  if (draft.kind === 'pane') {
    const one = pane(draft.pane.id, showing(draft.pane))
    one.linked = draft.pane.linked
    return one
  }

  return {
    kind: 'split',
    id: draft.id,
    along: draft.along,
    fraction: draft.fraction,
    sides: [frameOf(draft.sides[0], showing), frameOf(draft.sides[1], showing)],
  }
}

/** And the other way about: the tree as it is written down. `strip` hands over
 *  the tabs of a pane, already drafted, since only the workspace knows them. */
export function frameDraft(
  frame: Frame,
  strip: (pane: { id: string; activeTabId: string | null }) => { tabs: Draft[]; active: number },
): FrameDraft {
  if (frame.kind === 'pane') {
    const { tabs, active } = strip(frame)
    return { kind: 'pane', pane: { id: frame.id, tabs, active, linked: frame.linked } }
  }

  return {
    kind: 'split',
    id: frame.id,
    along: frame.along,
    fraction: frame.fraction,
    sides: [frameDraft(frame.sides[0], strip), frameDraft(frame.sides[1], strip)],
  }
}

/** The same arrangement with nobody's words in it, which is what a named layout
 *  keeps: it says which notes sit where, and the notes themselves are on disk.
 *  Also what the session falls back to when storage is full; see below. */
export function withoutText(layout: Layout): Layout {
  return { ...layout, frame: bareFrame(layout.frame) }
}

function bareFrame(frame: FrameDraft): FrameDraft {
  if (frame.kind === 'split') {
    return { ...frame, sides: [bareFrame(frame.sides[0]), bareFrame(frame.sides[1])] }
  }

  const tabs = frame.pane.tabs.map((draft) =>
    draft.path && draft.doc ? { ...draft, doc: '', dirty: false } : draft,
  )

  return { kind: 'pane', pane: { ...frame.pane, tabs } }
}

/** Writes the session down, giving things up until it fits.
 *
 *  Storage is finite. Unsaved work is what has to survive a full one, so the
 *  notes that live somewhere else give up their copies first - the caller
 *  already leaves out the saved ones - and if that still does not fit, the
 *  edited ones that have a file give up theirs too. The file is an older version
 *  of the same note, which is a far better place to come back to than none. A
 *  note that has never been saved exists nowhere but here, so its words are the
 *  last thing to go.
 *
 *  Answers whether anything was written at all. */
export function writeSession(key: string, state: Session): boolean {
  if (put(key, state)) return true

  // What is on screen comes before what was closed, so the reopen stack is the
  // first thing to go: it is a convenience, and the notes in it are either on
  // disk or were deliberately given up on.
  const shorter: Session = { ...state, closed: [] }
  if (put(key, shorter)) return true

  const lean = state.layout ? withoutText(state.layout) : undefined
  return put(key, { ...shorter, ...(lean ? { layout: lean } : {}) })
}

/** One offer to storage. Answers whether it was taken: out of room, or a browser
 *  that allows no site data at all, and either way the entry already there stays,
 *  which is a better place to come back to than none. */
function put(key: string, state: Session): boolean {
  return keep(key, JSON.stringify({ version: VERSION, ...state }))
}
