<script lang="ts">
  /** The file list: one flat column of rows, of which only the ones in view are in
   *  the page.
   *
   *  This used to draw one of itself per open note, which is why a space of three
   *  thousand notes was three thousand buttons - three thousand marks, three
   *  thousand reads of the link index, and about two hundred milliseconds of
   *  rendering after the tree first appeared, all of it for the twenty rows a panel
   *  can show. So the tree is flattened once into a list of rows (tree-flat.ts), a
   *  window says which of them to mount (row-window.ts), and the rest of the height
   *  stands in as one empty box above and one below.
   *
   *  Nothing about a row changed: the same button, the same classes, the same marks,
   *  the same menu, the same drag. What changed is how many of them exist.
   *
   *  Three things a window has to answer for, and all three are here:
   *
   *  - the keyboard walks rows that are not in the page, so the walk is over the
   *    list and `reach` puts a row there before the focus moves to it; see roving.ts
   *  - the row with the keyboard on it, and the row whose name is being typed, are
   *    held in the page wherever they are, because a focus inside a row that is
   *    taken away is a focus on nothing
   *  - a twist still slides, as a measured transition over the window rather than a
   *    height on a box: the band of rows coming out is drawn short and clipped and
   *    everything under it sits that much higher, which is the same picture the
   *    wrapper's `slide` drew. */

  import { tick, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  // The kind of file a row is, under a name of its own: `FileMark` here is the
  // component that draws one.
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import {
    folderFor,
    folderNote,
    folderNotePath,
    isFolderNote,
    nestedIn,
    renameSteps,
  } from './folder-notes'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { longPress } from './longpress'
  import { movesInto } from './move-targets'
  import NameField from './NameField.svelte'
  import { extensionOf } from './naming'
  import { rowName } from './note-name'
  import { rowMenu } from './row-menu'
  import { roving } from './roving'
  import SharedMark from './SharedMark.svelte'
  import { isSharedItem, othersIn } from './sharing.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { carried, carriedNothing, carry, dragged, isTreeDrag } from './drag-paths'
  import { dropTarget, targetFor } from './drop-target.svelte'
  import { autoScrollBy, heightOf, offsetOf, type Fold, type Rows, windowFor } from './row-window'
  import { ListView, tokenFloor, tokenRow } from './row-window.svelte'
  import { folderOf } from './space-paths'
  import { flatRows, heldRows, rowIndex, type FlatRow } from './tree-flat'
  import { bandOf, slides, type Band } from './tree-lift'
  import { steppedKey } from './direction'
  import { treeStep, TREE_MOVES } from './tree-keys'
  import { viewport } from './viewport.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { inside } from './workspace/zones'
  import Twist from './Twist.svelte'
  import { dur } from './motion'

  const { tree }: { tree: Entry } = $props()

  /** How many rows are kept beyond either edge of the view, so a wheel click
   *  arrives at rows that are already drawn rather than at an empty box. */
  const OVERSCAN = 6

  /** How long a twist takes to slide what it holds into place. The duration the
   *  wrapper's own `slide` had. */
  const FOLDING = 190

  /** How long a row takes to get out of the way of one being dragged past it.
   *
   *  A little shorter than a fold, because a fold happens once and this happens every
   *  time the gap moves: the rows have to have arrived before the pointer asks them to
   *  move again, or a slow drag leaves them permanently behind the finger. */
  const SLIDING = 180

  /** How long a finger has to be still on a row before it lifts, in milliseconds.
   *
   *  Shorter than the 500 the row's own menu waits, and deliberately: a press that
   *  then moves is a drag and a press that stays put is a menu, so the lift arms
   *  first and the menu only happens if nothing moved. Long enough not to fire on a
   *  tap, short enough that it does not feel like waiting; see longpress.ts. */
  const HOLD_TO_LIFT = 250

  /** How far a finger may stray in that time before it counts as a scroll rather
   *  than a press. Tighter than the menu's ten, since this is the gesture that has
   *  to give way to the list scrolling. */
  const LIFT_SLOP = 8

  /** How long the pointer has to rest on a closed folder before it opens under what
   *  is being dragged. The dwell every file manager has: long enough that passing
   *  over a folder on the way somewhere else does not open it, short enough that
   *  waiting on purpose is not waiting. */
  const DWELL = 400

  /** Whether the name being typed cannot be written, which the row wears as a
   *  hairline in red; the field is what knows why. One flag for the list, because
   *  one row at a time is being named. */
  let wrong = $state(false)

  const isOpen = (path: string) => workspace.isExpanded(path)

  /** Whether the rows are in the order somebody arranged, which is the one order a
   *  drag and the two keys can change. In the other six, a drag still moves a row
   *  into a folder exactly as it always has. */
  const manual = $derived(workspace.sortMode === 'manual')

  /** Every row the list shows, top to bottom. The same list `visibleTree` hands
   *  the keys and the selection, numbered the same way; see tree-flat.ts. */
  const live = $derived(flatRows(tree, isOpen))

  /** The list as it was a moment ago, held while a twist closes: the rows on their
   *  way out have already left `live`, and a slide has to have something to slide.
   *  Null whenever the list is still. */
  let frozen = $state<FlatRow[] | null>(null)

  const flat = $derived(frozen ?? live)

  /** Where each row is, by path: what turns the row an event came off into the
   *  number the window and the walk speak in. */
  const at = $derived(rowIndex(flat))

  /** The list, and the scroller it is in. The scroller is the panel's own body,
   *  which holds the bookmarks above this list and the empty stretch below it, so
   *  it is found rather than passed: the drawer on a phone and the panel on a
   *  desktop are this same component in that same box. */
  let list = $state<HTMLUListElement>()

  /** Where this list's window is: how far down the scroller has got, how much of
   *  the list it can show, and how tall one row is. The Links panel's lists hold the
   *  same three the same way; see row-window.svelte.ts. */
  const where = new ListView()

  /** How tall one row is: the token, 28 under a pointer and 56 under a thumb. Read
   *  through `where` so a window resized re-reads it, and off the device class so
   *  that plugging a mouse into a tablet does too - which changes the row scale
   *  without resizing anything. */
  const rowOf = () => tokenRow(viewport.touch)
  const rowHeight = $derived(where.row || tokenFloor(viewport.touch))

  // The one thing the observer on the box cannot see: a mouse plugged into a tablet
  // changes the row scale and resizes nothing.
  // A mouse plugged into a tablet changes the row scale and resizes nothing, so no
  // observer on the box can see it: the scale is handed over instead.
  $effect(() => {
    where.refresh(tokenRow(viewport.touch))
  })

  /** A twist on the move, or null while the list is still. */
  let fold = $state<Fold | null>(null)

  /** The row the keyboard is on, and the row a key or an open has asked for. Held
   *  by path rather than by number, since the numbers move under a rename. */
  let standing = $state<string | null>(null)
  let reaching = $state<string | null>(null)

  /** The rows the window must keep whatever the scroll says: the name being typed,
   *  the keyboard, and whatever a key or an open has just asked for. Three at the
   *  very most, and usually the same one three times over. */
  const pinned = $derived(
    [workspace.naming?.path, standing, reaching]
      .map(pathAt)
      .filter((one): one is number => one !== null),
  )

  const rows = $derived<Rows>({
    count: flat.length,
    height: rowHeight,
    top: where.top,
    room: where.room,
    overscan: OVERSCAN,
    fold,
    pinned,
  })

  const view = $derived(windowFor(rows))

  /** One row of the list as it is drawn: which row it is, and whether it is drawn
   *  where the flow puts it or at an offset of its own. */
  interface Drawn {
    row: FlatRow
    index: number
    /** Held although the window is elsewhere, so out of the flow; see `.away`. */
    away: boolean
  }

  /** The rows to draw: the window's own, and the few the list is holding on to
   *  wherever the scroll has gone. The part of a sliding band that is not out yet
   *  is left out of the first of those - it is flat, and a row no pixels high adds
   *  no pixels to the flow.
   *
   *  One list rather than two, and in the order of the list itself, because the two
   *  are the same rows: a row held at its own offset while the scroll is elsewhere
   *  becomes a row of the window the moment the scroll arrives, and two lists would
   *  make that one element ending and another beginning. Which is not a nicety - it
   *  took the keyboard out of a name being typed. */
  const drawn = $derived.by(() => {
    const out: Drawn[] = []
    const skip = view.skip

    for (let index = view.first; index <= view.last; index++) {
      if (skip && index >= skip.from && index <= skip.to) continue

      const row = flat[index]
      if (row) out.push({ row, index, away: false })
    }

    for (const index of view.pinned) {
      const row = flat[index]
      if (row) out.push({ row, index, away: true })
    }

    return out.sort((one, other) => one.index - other.index)
  })

  function pathAt(path: string | null | undefined): number | null {
    if (path === null || path === undefined) return null
    return at.get(path) ?? null
  }

  /** Ctrl and Shift build a selection and do nothing else; a plain click makes
   *  the row the one selected and goes on to what it always did. Returns
   *  whether the click was taken by the selection. */
  function pick(event: MouseEvent, entry: Entry): boolean {
    if (event.ctrlKey || event.metaKey) {
      workspace.toggleSelect(entry.path)
      return true
    }
    if (event.shiftKey) {
      workspace.selectRange(entry.path)
      return true
    }
    workspace.select(entry.path)
    return false
  }

  /** The row a press came from, by the path written on it. Null for a press
   *  from anywhere in the list that is not a row. */
  function rowPath(event: KeyboardEvent): string | null {
    const from = event.target instanceof Element ? event.target.closest('.row') : null
    return from instanceof HTMLElement ? (from.dataset.path ?? null) : null
  }

  /** Brings row n into view and into the page, and answers its element once it is
   *  there. Null for a row the list has not got, and for the row whose name is being
   *  typed, which wears a field rather than a path.
   *
   *  The whole of what a window owes the rest of the app: a row far off screen is not
   *  in the page, and End, a spelled name, a rename and a note being opened all have
   *  to arrive at one.
   *
   *  Held first and scrolled second: the row is drawn at its own offset outside the
   *  window, which is its true place in the list, and then the browser is asked to
   *  bring it in. Its own scrolling rather than arithmetic of ours, because what a
   *  scroll has to clear is not only the rows - the label above the list, the empty
   *  stretch below it and the box's own padding are all in the way, and how far a
   *  scroll may go at all is the box's to say.
   *
   *  Which is only safe because the window and the rows it is holding on to are one
   *  keyed list: the row stays the same element as it stops being held and becomes a
   *  row of the window, so a focus or a name being typed inside it survives the
   *  handover. Two lists made that two elements, and End landed on nothing. */
  async function reach(index: number): Promise<HTMLElement | null> {
    const row = flat[index]
    if (!row) return null

    reaching = row.entry.path
    await tick()

    const line = list?.querySelector(`li[data-row="${index}"]`)
    if (!(line instanceof HTMLElement)) return null

    line.scrollIntoView({ block: 'nearest' })
    where.refresh()

    // The row inside it, for whoever wants to put the keyboard on it. Null for the
    // row whose name is being typed, which wears a field instead.
    const found = line.querySelector('.row[data-path]')
    return found instanceof HTMLElement ? found : null
  }

  /** Puts the keyboard on a row and makes it the one selected, which is what
   *  arriving at a row in a file list means. */
  function stand(path: string) {
    workspace.select(path)

    const index = at.get(path)
    if (index === undefined) return

    void reach(index).then((row) => row?.focus())
  }

  /** Which of the walk's keys this press is, by the id the registry holds it
   *  under. Read off the registry rather than off the event, so a reader who
   *  rebinds one is obeyed; see tree-keys.ts. */
  function walkKey(event: KeyboardEvent): string | null {
    for (const [id, key] of TREE_MOVES) {
      // In reading terms: under an interface that reads right to left, the key
      // that steps into a folder is the one pointing the way the closed row's own
      // mark points. See `steppedKey` in direction.ts.
      if (shortcuts.pressed(id, event)) return steppedKey(key)
    }

    return null
  }

  /** Keys that act on the selection, from anywhere in the tree. Which keys those
   *  are comes from the registry, like every other shortcut; they are read here
   *  rather than on the window because they only mean anything while the focus is
   *  in the list.
   *
   *  Walking the rows is not here: up, down, Home, End, spelling a name, Enter,
   *  Space, the menu key and Escape are the same in every list the app draws and
   *  are roving.ts, which the `<ul>` below is handed to. What is left is what only
   *  a list of files has - a selection, renaming, and the two keys that delete. */
  function onKey(event: KeyboardEvent) {
    // A row being renamed is a text field, and Escape, Ctrl+A and the arrows
    // belong to the words in it.
    if (event.target instanceof HTMLInputElement) return

    if (shortcuts.pressed('tree.select-all', event)) {
      event.preventDefault()
      workspace.selectAll()
      return
    }

    const deleting =
      shortcuts.pressed('tree.delete', event) || shortcuts.pressed('tree.delete.alt', event)
    if (deleting && workspace.selection.length) {
      event.preventDefault()
      void workspace.removeMany(workspace.selection)
      return
    }

    const here = rowPath(event)
    if (here === null) return

    if (shortcuts.pressed('tree.rename', event)) {
      event.preventDefault()
      workspace.startRenaming(here)
      return
    }

    // A row a step up or down the order somebody arranged, with the same slide a drag
    // gets. Nothing at all in the other six orders, which are the notes' own rules
    // rather than anybody's arrangement; see `moveInOrder` in workspace.svelte.ts.
    const step = shortcuts.pressed('tree.move-up', event)
      ? -1
      : shortcuts.pressed('tree.move-down', event)
        ? 1
        : 0

    if (step !== 0) {
      event.preventDefault()
      const was = placesNow()
      if (workspace.moveInOrder(here, step)) void slideInto(was)
    }
  }

  /** Left and right in a list that holds lists: right shows what a row holds and
   *  then steps into it, left hides it again and otherwise steps out to the row
   *  holding this one. The rule is tree-keys.ts; up and down are the walk every
   *  list shares. True when the press was spent. */
  function sideways(key: string, row: HTMLElement): boolean {
    const here = row.dataset.path
    if (here === undefined) return false
    if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false

    const step = treeStep(key, workspace.visibleTree(), here)
    if (!step) return false

    if (step.do === 'stand') stand(step.path)
    else workspace.toggleFolder(step.path)

    return true
  }

  /** Enter on a row: it opens, and the note takes the keyboard, which is what
   *  `takesCaret` does a frame later.
   *
   *  Every row opens something, because every row is a note or a file: a folder
   *  opens the note it is drawn as, written or not. What a row holds is the two
   *  arrows and the twist, never Enter. See `openRow` in workspace.svelte.ts. */
  function openRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here !== undefined) void workspace.openRow(here)
  }

  /** Space on a row: the same, except the keyboard stays in the list, so a space
   *  can be walked and read down without leaving it. Obsidian has the same idea on
   *  Ctrl and an arrow. */
  function peekRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here === undefined) return

    void workspace.openRow(here, { preview: true })
    row.focus()
  }

  /** Escape: the selection first, and once there is none the note takes the
   *  keyboard back. One level at a time, and never an action - the same order
   *  Obsidian's tree uses. True while the list still had something of its own. */
  function leaveList(): boolean {
    if (!workspace.selection.length) return false

    workspace.clearSelection()
    return true
  }

  /** What the name field starts with. Nothing at all for a row that is being
   *  made: the name is what will make it. A note waiting for a title starts with
   *  the name it has and a space, so typing one adds to it. */
  function nameToEdit(entry: Entry): string {
    if (workspace.naming?.making) return ''

    const name = labelOf(entry)
    return workspace.naming?.appending ? `${name} ` : name
  }

  /** The mark in front of the name: the note's own, so the row being renamed wears
   *  the one it wore a moment ago.
   *
   *  A folder with no note of its own is a page with nothing written on it, which
   *  is what `file` draws and what the row is: nothing has been written there yet.
   *  Asked of the folder rather than of its name, because a folder's name is not a
   *  file name - a vault with a folder called `Papers.pdf` is not holding a paper.
   *  See file-mark.ts. */
  function markOf(entry: Entry, own: Entry | null): Mark {
    if (own) return fileMark(own.name)
    return entry.is_dir ? 'file' : fileMark(entry.name)
  }

  /** What the row is called: the folder's name where the row is a folder, so a row
   *  whose note is somebody else's `index.md` is still called after its place. Also
   *  what a spelled name is looked for in; see roving.ts. */
  function labelOf(entry: Entry): string {
    return rowName(entry.name, entry.is_dir)
  }

  /** Whose icon it is: the note's where the row has one, and the folder's while it
   *  has none - which is the one thing the space's icon map is still for. Either
   *  way `chosen-icon.ts` reads both, so a folder that wore an icon before
   *  anybody wrote in it keeps it afterwards. */
  function markPath(entry: Entry, own: Entry | null): string {
    return own?.path ?? entry.path
  }

  /** What the name that was typed does: makes the row that does not exist yet,
   *  renames the folder and the note inside it together, or renames the one file
   *  the row is. Which steps a row that is a folder takes is folder-notes.ts. */
  function commit(entry: Entry, own: Entry | null, name: string) {
    if (workspace.naming?.making) void workspace.makeNamed(name)
    else if (own) void renameNested(own, name)
    else void workspace.rename(entry.path, name)
  }

  /** Renaming a row that is a folder and a note renames both, in the order
   *  folder-notes.ts gives them. Each step is the ordinary rename, so the links
   *  are rewritten and the file undo has each half of it. */
  async function renameNested(note: Entry, name: string) {
    for (const step of renameSteps(note.path, name)) {
      await workspace.rename(step.path, step.name)
    }
  }

  function startDrag(event: DragEvent, path: string) {
    const paths = workspace.dragPayload(path)
    carry(event.dataTransfer, paths)
    carrying = paths
    // The panes light their drop zones for a note out of the list as well as
    // for a tab out of a strip: both land in the same five places.
    workspace.panes.dragging = { tabId: null }
  }

  function endDrag() {
    workspace.panes.dragging = null
    workspace.panes.landing = null
    carriedNothing()
    // A drag that ended without a drop - Escape, or a release over nothing - takes
    // the gap back with it, and the rows slide to where they were.
    letGo()
    stopRolling()
  }

  /* -- A row lifted out of the order ---------- */

  /** The rows being carried, whichever gesture is carrying them.
   *
   *  The same list `carried()` holds for a drag the platform started, and the only
   *  list there is for a lift under a finger: a touch screen fires no drag events at
   *  all, so the one gesture that can reorder a list on a phone is a press, a hold and
   *  a move. One name for both, so everything below this line is the same code on a
   *  desktop and on a phone - and so the design is one design, with two ways in
   *  because the platforms offer two. */
  let carrying = $state<string[]>([])

  /** The row drawn under the pointer while a finger is carrying it. The platform
   *  draws this itself for a drag it started; a lift has to. */
  let ghost: HTMLElement | null = null
  let ghostFrom = 0

  /** The press that has not become a lift yet, and where it started. */
  let holding: ReturnType<typeof setTimeout> | null = null
  let heldAt = { x: 0, y: 0 }

  /** The folder the pointer is resting on, and the timer that will open it. */
  let dwelling: ReturnType<typeof setTimeout> | null = null
  let dwellOn: string | null = null

  const entryFor = (path: string): Entry | null => {
    const index = at.get(path)
    return index === undefined ? null : (flat[index]?.entry ?? null)
  }

  /** Where every row on screen is, by the path written on it. Measured before the
   *  order changes and again after, which is what the slide is the difference of. */
  function placesNow(): Map<string, number> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- measured and thrown away inside one frame
    const out = new Map<string, number>()
    for (const row of list?.querySelectorAll<HTMLElement>('.row[data-path]') ?? []) {
      const path = row.dataset.path
      if (path !== undefined) out.set(path, row.getBoundingClientRect().top)
    }

    return out
  }

  /** The rows slide from where they were to where the new order puts them.
   *
   *  Measured, changed, measured again, and each row started from its own old place
   *  and animated back to none: the rows are laid out by the flow and by the window's
   *  arithmetic, so there is nothing to animate except the distance between the two
   *  answers. Nothing at all for a reader who has asked for as little movement as
   *  possible - `dur` answers zero - and then the new order simply is the order. */
  async function slideInto(was: Map<string, number>) {
    const ms = dur(SLIDING)
    if (ms === 0) return

    await tick()
    const moving = slides(was, placesNow(), carrying)

    for (const row of list?.querySelectorAll<HTMLElement>('.row[data-path]') ?? []) {
      const from = moving.get(row.dataset.path ?? '')
      if (from === undefined) continue

      row.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], {
        duration: ms,
        // Ease out, which is cubicOut as a browser spells it: the row leaves at once
        // and settles, rather than creeping away from the pointer.
        easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
      })
    }
  }

  /** What the pointer is pointing at, and the order that would leave behind.
   *
   *  Answers whether a gap is showing, which is what tells the row underneath not to
   *  light up as a folder to drop into as well: a row cannot be both the place
   *  something goes into and the place it goes beside.
   *
   *  The row under the pointer while a gap is showing is usually the row the last gap
   *  put there, which is the row being carried - and that is what holds the gap still
   *  instead of letting it flick back and forth under a resting pointer. */
  function aimAt(row: HTMLElement, y: number, entry: Entry): boolean {
    if (!manual || !carrying.length) return false
    if (workspace.holdArrange(carrying, entry.path)) return true

    const box = row.getBoundingClientRect()
    const band: Band = bandOf(y, box.top, box.height)
    if (band === 'on') return false

    const was = placesNow()
    if (!workspace.showArrange(carrying, entry.path, band === 'after')) return false

    void slideInto(was)
    return true
  }

  /** A closed folder the pointer is resting on opens, so a drop can go further in
   *  than the row it started over. Only while nothing is being dropped between two
   *  rows, and only for a folder that is shut. */
  function dwellOver(path: string | null, folder: boolean) {
    if (path === dwellOn) return

    dwellOn = path
    if (dwelling !== null) clearTimeout(dwelling)
    dwelling = null
    if (path === null || !folder || workspace.isExpanded(path)) return

    dwelling = setTimeout(() => {
      dwelling = null
      if (dwellOn === path) workspace.device.expand(path)
    }, DWELL)
  }

  /** The gap goes, and the rows slide to where the order was before it opened.
   *
   *  Measured first, like every other change to the order: a gap that simply stopped
   *  being there would put three rows back in one frame, and the one thing a drag has
   *  to be is continuous. */
  function slideBack() {
    if (!workspace.arranging) return

    const was = placesNow()
    workspace.cancelArrange()
    void slideInto(was)
  }

  /** The gap goes, whatever was holding it: a drag that ended over nothing, Escape,
   *  or a lift that was let go. */
  function letGo() {
    slideBack()
    dwellOver(null, false)
    carrying = []
  }

  /** A row under a finger, lifted after a short hold.
   *
   *  A copy of the row rather than the row itself, for the reason the platform draws a
   *  copy for a drag of its own: the row in the list is a row of a window that is
   *  still scrolling, still being rebuilt as the order changes and still keyed by its
   *  path, and a row taken out of that to follow a finger is a row the list has lost
   *  track of. The copy keeps the row's own classes, so it is drawn by the same
   *  stylesheet, and it sits above everything at the place the finger took it from. */
  function lift(row: HTMLElement, entry: Entry) {
    holding = null
    carrying = workspace.dragPayload(entry.path)

    const box = row.getBoundingClientRect()
    const copy = row.cloneNode(true)
    if (!(copy instanceof HTMLElement)) return

    copy.classList.add('carried')
    copy.style.width = `${box.width}px`
    copy.style.left = `${box.left}px`
    copy.style.top = `${box.top}px`
    copy.setAttribute('aria-hidden', 'true')
    document.body.append(copy)

    ghost = copy
    ghostFrom = heldAt.y

    window.addEventListener('touchmove', onLiftMove, { passive: false })
    window.addEventListener('touchend', onLiftEnd)
    window.addEventListener('touchcancel', dropLift)
    window.addEventListener('keydown', onLiftKey)
  }

  function onRowTouchStart(event: TouchEvent, entry: Entry) {
    if (!manual || ghost) return

    // Two fingers down is a pinch or a scroll, not a press; the row's own menu reads
    // it the same way.
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    if (!touch) {
      cancelHold()
      return
    }

    const row = event.currentTarget
    if (!(row instanceof HTMLElement)) return

    heldAt = { x: touch.clientX, y: touch.clientY }
    holding = setTimeout(() => lift(row, entry), HOLD_TO_LIFT)
  }

  /** Moving before the hold is up is the list being scrolled, which outranks both the
   *  lift and the menu - and the menu cancels itself on the same movement, for the
   *  same reason; see longpress.ts. */
  function onRowTouchMove(event: TouchEvent) {
    const touch = event.touches[0]
    if (!touch || holding === null) return

    const strayed =
      Math.abs(touch.clientX - heldAt.x) > LIFT_SLOP ||
      Math.abs(touch.clientY - heldAt.y) > LIFT_SLOP
    if (strayed) cancelHold()
  }

  function cancelHold() {
    if (holding !== null) clearTimeout(holding)
    holding = null
  }

  function onLiftMove(event: TouchEvent) {
    const touch = event.touches[0]
    if (!ghost || !touch) return

    // The list must not scroll under the finger that is carrying a row; the page's
    // own gesture is what this is instead of.
    if (event.cancelable) event.preventDefault()

    ghost.style.transform = `translateY(${touch.clientY - ghostFrom}px) scale(1.03)`

    const under = document.elementFromPoint(touch.clientX, touch.clientY)
    const row = under instanceof Element ? under.closest('.row[data-path]') : null
    const path = row instanceof HTMLElement ? row.dataset.path : undefined
    const entry = path === undefined ? null : entryFor(path)

    if (row instanceof HTMLElement && entry) {
      if (aimAt(row, touch.clientY, entry)) {
        dropTarget.clear()
        dwellOver(null, false)
      } else if (takes(entry)) {
        slideBack()
        dropTarget.over(targetFor(entry.path, entry.is_dir))
        dwellOver(entry.path, entry.is_dir)
      }
    }

    const box = where.box
    if (box) {
      edgeAt = touch.clientY - box.getBoundingClientRect().top
      rolling ??= requestAnimationFrame(rollOn)
    }
  }

  function onLiftEnd(event: TouchEvent) {
    // The finger lifting is the end of the gesture, not a tap: left alone the browser
    // follows it with a click, and the click would open whatever row the drop landed
    // on. See longpress.ts, which says the same about its own press.
    if (event.cancelable) event.preventDefault()

    // Written down before anything is cleaned up: the clean-up is what takes the gap
    // away, and a drop that ran after it would have nothing left to write.
    const landed = workspace.arranging
    const folder = dropTarget.folder
    const paths = [...carrying]

    if (landed) workspace.dropArrange()
    dropLift()

    if (!landed && folder && paths.length) void workspace.moveMany(paths, folder)
  }

  /** Escape while a row is in the air: everything slides back. */
  function onLiftKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return

    event.preventDefault()
    const was = placesNow()
    dropLift()
    void slideInto(was)
  }

  /** The lift is over, however it ended: the copy goes, the listeners go, and
   *  whatever the gap was showing is dropped unless somebody has just taken it. */
  function dropLift() {
    ghost?.remove()
    ghost = null
    cancelHold()
    dropTarget.clear()
    letGo()
    stopRolling()

    window.removeEventListener('touchmove', onLiftMove)
    window.removeEventListener('touchend', onLiftEnd)
    window.removeEventListener('touchcancel', dropLift)
    window.removeEventListener('keydown', onLiftKey)
  }

  $effect(() => () => dropLift())

  /** A row lights only where a drop would do something, the way a pane's drop
   *  zones do: a row held over itself, over a row inside it, or over the row it
   *  already sits in used to light and then move nothing.
   *
   *  A note held over itself is the same nothing, and the row itself is what says
   *  so: the folder a drop would make out of a note does not exist yet, so no rule
   *  about paths can tell it from the note it would be made of. */
  function takes(entry: Entry): boolean {
    const paths = carried()
    if (paths.includes(entry.path)) return false

    return paths.length === 0 || movesInto(paths, targetFor(entry.path, entry.is_dir))
  }

  /** Whether a drop would land in this row: in the folder it is, or in the folder
   *  the note it shows is about to become. A PDF or a canvas becomes no folder, so
   *  `folderFor` answers its own path back and its row never lights - the row of
   *  the folder it sits in lights instead, as it always has. */
  function nesting(entry: Entry): boolean {
    return dropTarget.lit(entry.is_dir ? entry.path : folderFor(entry.path))
  }

  function overRow(event: DragEvent, entry: Entry) {
    if (!isTreeDrag(event.dataTransfer)) return

    const row = event.currentTarget
    // The thin bands at the top and the bottom of a row are the spaces between rows,
    // and in Manual that is where a new order is; the middle of the row is the row
    // itself, which is the move into a folder the list has always had. See
    // tree-lift.ts.
    if (row instanceof HTMLElement && aimAt(row, event.clientY, entry)) {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      dropTarget.clear()
      dwellOver(null, false)
      return
    }

    if (!takes(entry)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    slideBack()
    dropTarget.over(targetFor(entry.path, entry.is_dir))
    dwellOver(entry.path, entry.is_dir)
  }

  /** `dragleave` also fires when the pointer moves onto a child - the label
   *  inside a row, the icon inside a space - and the `dragover` that follows
   *  sets it straight back. That off-on-off is the flicker. Geometry settles
   *  it: still inside the box means still over the thing. */
  function stillInside(event: DragEvent): boolean {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return inside(box, event.clientX, event.clientY)
  }

  /** Into the folder the row stands for, which for a note is the folder that note
   *  is about to become; see drop-target.svelte.ts. Making it is the move's own
   *  business, so this is the same call every other drop makes. */
  function drop(event: DragEvent, entry: Entry) {
    event.preventDefault()
    dropTarget.clear()
    dwellOver(null, false)

    // A drop with a gap showing is a new order rather than a move: the row is already
    // where it is going, and what is left is to write it down.
    if (workspace.arranging) {
      workspace.dropArrange()
      carrying = []
      return
    }

    const paths = dragged(event.dataTransfer)
    if (paths.length) void workspace.moveMany(paths, targetFor(entry.path, entry.is_dir))
  }

  /** Clicking the row opens what it is; clicking the twist at the end of it shows
   *  what it holds. One button rather than two, because the row is also a drag
   *  handle, a drop target and where the keyboard stands, and none of those can be
   *  half a row - and a button cannot hold a button. The arrows are the twist for
   *  a keyboard; see tree-keys.ts.
   *
   *  One rule for every row in the list, which is what makes the list one list:
   *  the name opens the thing, the twist discloses it. A folder that has no note
   *  of its own opens the empty page it is - see `openRow` in workspace.svelte.ts
   *  - and writes nothing by being looked at. */
  function openRowAt(event: MouseEvent, entry: Entry) {
    const twist = event.target instanceof Element ? event.target.closest('.twist') : null
    if (twist) {
      workspace.toggleFolder(entry.path)
      return
    }

    if (!pick(event, entry)) void workspace.openRow(entry.path, { preview: true })
  }

  /* ── Where the window is ──────────────────── */

  $effect(() => {
    const ul = list
    if (!ul) return

    // Where this space was left. Read outside the effect's own reading, or writing
    // it down on every scroll would run this again and put the list back where the
    // scroll started from.
    const root = untrack(() => workspace.activeSpace?.root)

    const stop = where.follow(ul, rowOf, (box) => {
      if (root !== undefined) workspace.device.setListAt(root, box.scrollTop)
    })

    const box = where.box
    if (!box) return stop

    if (root !== undefined) {
      const left = untrack(() => workspace.device.listAt(root))
      if (left > 0) box.scrollTop = left
      where.refresh()
    }

    box.addEventListener('dragover', onDragOver)
    box.addEventListener('dragleave', offList)
    box.addEventListener('drop', stopRolling)
    box.addEventListener('dragend', stopRolling)

    return () => {
      stop?.()
      box.removeEventListener('dragover', onDragOver)
      box.removeEventListener('dragleave', offList)
      box.removeEventListener('drop', stopRolling)
      box.removeEventListener('dragend', stopRolling)
      stopRolling()
    }
  })

  /* ── Autoscroll under a drag ──────────────── */

  /** How far into the list the pointer is while something is held over it, and the
   *  frame loop that brings rows in under it. A drop can only land on a row that
   *  is there, and a space of three thousand has one row on screen in a hundred. */
  let edgeAt: number | null = null
  let rolling: number | null = null

  function rollOn() {
    const box = where.box
    if (!box || edgeAt === null) {
      rolling = null
      return
    }

    // The band is one row deep and the fastest it goes is half a row a frame,
    // which is the row scale rather than a number of its own.
    const step = autoScrollBy(edgeAt, box.clientHeight, rowHeight, rowHeight / 2)
    if (step !== 0) box.scrollTop += step

    rolling = requestAnimationFrame(rollOn)
  }

  function onDragOver(event: DragEvent) {
    const box = where.box
    if (!box || !isTreeDrag(event.dataTransfer)) return

    edgeAt = event.clientY - box.getBoundingClientRect().top
    rolling ??= requestAnimationFrame(rollOn)
  }

  /** A `dragleave` that is the pointer moving from one row to the next, which is
   *  most of them, is not the pointer leaving the list: the events from the rows
   *  arrive here too. The same geometry the rows settle it with; see `stillInside`. */
  function offList(event: DragEvent) {
    const box = where.box
    if (box && inside(box.getBoundingClientRect(), event.clientX, event.clientY)) return

    stopRolling()
  }

  function stopRolling() {
    edgeAt = null
    if (rolling !== null) cancelAnimationFrame(rolling)
    rolling = null
  }

  /* ── A twist sliding ──────────────────────── */

  /** Where a block of rows appeared or went, or null for any other way the list
   *  changed. A rename re-sorts and is not one block; a listing that arrives with
   *  the same rows in it is no change at all. */
  function blockMoved(was: string[], now: string[]): { at: number; rows: number } | null {
    const grew = now.length - was.length
    if (grew === 0) return null

    const [fewer, more] = grew > 0 ? [was, now] : [now, was]
    const many = Math.abs(grew)

    let head = 0
    while (head < fewer.length && fewer[head] === more[head]) head += 1
    for (let rest = head; rest < fewer.length; rest++) {
      if (fewer[rest] !== more[rest + many]) return null
    }

    return { at: head, rows: many }
  }

  let wasPaths: string[] = []
  let wasRows: FlatRow[] = []
  let sliding: number | null = null

  /** The band coming out or going in, over `FOLDING` milliseconds, which is what
   *  the wrapper's `slide` took. Instant for a reader who has asked for as little
   *  movement as possible: `dur` answers zero and there is no band at all. */
  function slide(twist: number, many: number, shutting: boolean, keep: FlatRow[]) {
    if (sliding !== null) cancelAnimationFrame(sliding)

    const ms = dur(FOLDING)
    if (ms === 0) {
      fold = null
      frozen = null
      return
    }

    if (shutting) frozen = keep
    const started = performance.now()

    const step = (now: number) => {
      const along = Math.min(1, (now - started) / ms)
      const eased = cubicOut(along)
      const out = shutting ? 1 - eased : eased
      fold = { at: twist, rows: many, grown: many * out }

      if (along < 1) {
        sliding = requestAnimationFrame(step)
        return
      }

      sliding = null
      fold = null
      frozen = null
    }

    fold = { at: twist, rows: many, grown: shutting ? many : 0 }
    sliding = requestAnimationFrame(step)
  }

  // Before the paint, so the band is short in the very first frame it exists:
  // a frame at full height followed by a slide from nothing is a flicker.
  $effect.pre(() => {
    const now = live
    const paths = now.map((one) => one.entry.path)
    const before = wasRows
    const moved = blockMoved(wasPaths, paths)

    wasPaths = paths
    wasRows = now

    if (!moved || moved.at < 1) return

    // The row the block belongs to, which is the one above it and is in both
    // lists. A twist, and nothing else: a note arriving from a sync appears
    // under a row that holds nothing, or is one of several a folder gained, and
    // neither is a fold.
    const opening = paths.length > before.length
    const twist = (opening ? now : before)[moved.at - 1]
    if (!twist?.entry.is_dir) return
    if (workspace.isExpanded(twist.entry.path) !== opening) return
    if (heldRows(twist.entry, isOpen) !== moved.rows) return

    slide(moved.at - 1, moved.rows, !opening, before)
  })

  $effect(() => () => {
    if (sliding !== null) cancelAnimationFrame(sliding)
  })

  /* ── Rows that have to be looked at ───────── */

  /** The row a note is shown as: its own, or the folder's where the note is the
   *  one its folder is drawn as. */
  function rowOfNote(note: string): number | null {
    const own = at.get(note)
    if (own !== undefined) return own
    if (!isFolderNote(note)) return null

    return at.get(folderOf(note)) ?? null
  }

  /** The note being read, kept in view. Nearest, so a row already on screen is not
   *  pulled around under the reader; and only when the note changes, so the list
   *  stays where it was left otherwise. */
  let showing: string | null = null

  /** Whether a note has yet been opened while the panel was watching. The first one
   *  it sees is the note that was already open when it appeared - a launch, a panel
   *  switched back to - and the list has just come back to where the space was left,
   *  which is the place that wins. Only a note opened after that is a note being
   *  opened, and only that is worth moving the list for. */
  let opened = false

  $effect(() => {
    const note = workspace.active?.path ?? null
    if (note === showing) return
    showing = note

    if (!opened) {
      opened = true
      return
    }
    if (note === null) return

    const index = rowOfNote(note)
    if (index === null) return

    void reach(index)
  })

  /** The row whose name is being typed, in view and in the page: a new note
   *  appears at its sorted position already editing, which may be anywhere. */
  let naming: string | null = null

  $effect(() => {
    const path = workspace.naming?.path ?? null
    if (path === naming) return
    naming = path
    if (path === null) return

    const index = at.get(path)
    if (index === undefined) return

    // The element is not asked for: a row being named wears a field rather than a
    // path, so there is nothing to find and nothing to focus - the field takes the
    // keyboard itself. `reach` is here for the scroll.
    void reach(index)
  })

  /** Which row the keyboard is on, so the window holds it however far the reader
   *  then scrolls. */
  function onFocus(event: FocusEvent) {
    const from = event.target instanceof Element ? event.target.closest('.row') : null
    standing = from instanceof HTMLElement ? (from.dataset.path ?? null) : null
  }

  function onBlur(event: FocusEvent) {
    const to = event.relatedTarget
    if (to instanceof Node && list?.contains(to)) return
    standing = null
  }
</script>

<!-- Keys are read on the list, where every row's keydown ends up: the selection
     keys here, and the walk every list in the app shares through the action; see
     roving.ts. The rows carry `is-on` for the note that is open, so Tab into the
     list arrives at the note being read rather than at the top of the space.
     `long` is what tells the walk the list is longer than the page: End and a
     spelled name reach a row that is not mounted yet. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
  bind:this={list}
  onkeydown={onKey}
  onfocusin={onFocus}
  onfocusout={onBlur}
  use:roving={{
    rows: '.row',
    keyOf: walkKey,
    sideways,
    open: openRow,
    peek: peekRow,
    menu: (row, to) => row.dispatchEvent(to),
    leave: leaveList,
    long: {
      count: () => flat.length,
      indexOf: (row) => (row.dataset.path === undefined ? -1 : (pathAt(row.dataset.path) ?? -1)),
      labels: () => flat.map((one) => labelOf(one.entry)),
      reach,
    },
  }}
>
  <!-- The rows above the window, as height. -->
  <li class="gap" style:height="{view.above}px" aria-hidden="true"></li>

  {#each drawn as one (one.row.entry.path)}
    {@render line(one)}
  {/each}

  <!-- And the rows below it. A row drawn out of the flow is between the two boxes
       like any other and takes no height from either, which is what lets the one
       list hold both. -->
  <li class="gap" style:height="{view.below}px" aria-hidden="true"></li>
</ul>

{#snippet line(one: Drawn)}
  <!-- How tall the row is drawn: one row, or the part of one that is out so far
       while the twist above it is sliding. The band is clipped rather than
       squashed, which is what the wrapper's own overflow did. A row out of the flow
       is at its own offset instead, and takes its height from what is in it. -->
  {@const cut = fold === null || one.away ? rowHeight : heightOf(one.index, rows)}
  <li
    data-row={one.index}
    class:away={one.away}
    class:cut={cut < rowHeight}
    style:top={one.away ? `${offsetOf(one.index, rows)}px` : undefined}
    style:height={cut < rowHeight ? `${cut}px` : undefined}
    aria-setsize={flat.length}
    aria-posinset={one.index + 1}
  >
    {@render inner(one.row)}
  </li>
{/snippet}

{#snippet inner(one: FlatRow)}
  {@const entry = one.entry}
  {@const depth = one.depth}
  <!-- The note a folder holds of its own name, which is the row the folder is
       drawn as; null for every other row. See folder-notes.ts. -->
  {@const own = folderNote(entry)}
  <!-- What the row discloses: everything the folder holds, except the note it is
       itself drawn as, which is this row. -->
  {@const nested = own ? nestedIn(entry) : entry.children}
  <!-- A folder nobody has written a note in: a row of somebody else's vault,
       drawn quietly until there are words in it. -->
  {@const unwritten = entry.is_dir && !own}
  <!-- What the row opens. A folder opens its own note, the one it has or the one
       it would have; anything else opens itself. -->
  {@const opens = own?.path ?? (entry.is_dir ? folderNotePath(entry.path) : entry.path)}
  <!-- What it is called: the folder's name where the row is a folder, so a row
       whose note is somebody else's `index.md` is still called after its place. -->
  {@const name = labelOf(entry)}
  <!-- The name being typed, if one is: read once, so the branch below and the field
       inside it cannot come to different answers about whether there is one. -->
  {@const named = workspace.naming}
  {#if named?.path === entry.path}
    <!-- The row while its name is being typed. Its mark, its indentation, its
         height, its font, the fill that says it is the note you have open, the
         twist at the far end and the rows it discloses all stay exactly as they
         were: renaming a file changes its name and nothing else about it. Only
         the name becomes a field, in the slot the name was already in; see
         NameField.svelte.
         A div rather than the button a row usually is, for two reasons that
         point the same way: a button cannot hold a field, and a row whose name
         is being typed is not a row to press. -->
    <div
      class="nib-row row"
      class:is-quiet={unwritten}
      class:is-on={workspace.active?.path === opens}
      class:is-picked={workspace.isSelected(entry.path)}
      class:is-wrong={wrong}
      style:--level={depth}
    >
      <FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />
      <NameField
        value={nameToEdit(entry)}
        extension={extensionOf(entry.name, entry.is_dir)}
        taken={workspace.namesBeside(entry.path)}
        appending={named.appending}
        bind:wrong
        oncommit={(typed: string) => commit(entry, own, typed)}
        oncancel={() => workspace.cancelNaming()}
      />
      {#if nested.length}{@render twist(entry.path)}{/if}
    </div>
  {:else}
    <!-- One row, because the list shows one kind of thing: a note, which may
         hold other notes. The mark says which kind of file it is, the name is
         the note's, and the twist at the far end appears only where there is
         something under it - a vault may arrive with a folder holding nothing
         but its own note, and a twist that opens on to nothing is a row
         promising something it does not have.
         A folder with no note of its own is the same row drawn quietly: it is
         a note nobody has written, and clicking it opens the empty page it is
         without writing anything. See folder-notes.ts and docs/tree.md. -->
    <button
      class="nib-row row"
      data-path={entry.path}
      class:is-left-out={workspace.excluded.has(entry.path)}
      class:is-quiet={unwritten}
      class:is-taking={nesting(entry)}
      class:is-lifted={carrying.includes(entry.path)}
      class:is-on={workspace.active?.path === opens}
      class:is-picked={workspace.isSelected(entry.path)}
      style:--level={depth}
      aria-expanded={entry.is_dir ? workspace.isExpanded(entry.path) : undefined}
      draggable="true"
      onclick={(event) => openRowAt(event, entry)}
      ondblclick={() => workspace.openRow(entry.path)}
      oncontextmenu={(event) => menu.show(event, rowMenu(entry), { title: name })}
      use:longPress={(event) => menu.show(event, rowMenu(entry), { title: name })}
      ontouchstart={(event) => onRowTouchStart(event, entry)}
      ontouchmove={onRowTouchMove}
      ontouchend={cancelHold}
      ontouchcancel={cancelHold}
      ondragstart={(event) => startDrag(event, entry.path)}
      ondragend={endDrag}
      ondragover={(event) => overRow(event, entry)}
      ondragleave={(event) => stillInside(event) || dropTarget.clear()}
      ondrop={(event) => drop(event, entry)}
    >
      <!-- The row says what it opens into without spending a word on it, or
           wears the icon the note itself chose; the path is how it knows. -->
      <FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />
      <span class="nib-row-label">{name}</span>
      <!-- Somebody else is in this note. The same mark the switcher puts on a
           shared space, in the slot a row keeps for what it has to add about
           a name; see SharedMark.svelte.
           Or, where nobody is in it this minute, that it is a file shared on
           its own: the same mark about the same fact, one step less urgent.
           Both about the note the row stands for, which for a row that holds
           notes is the note inside it. -->
      {#if othersIn(opens)}<SharedMark label={t('Also open elsewhere')} />
      {:else if isSharedItem(opens)}<SharedMark />{/if}
      {#if nested.length}{@render twist(entry.path)}{/if}
    </button>
  {/if}
{/snippet}

<!-- What a row holds, said at the far end of it. One twist, whether the row is
     being read or being renamed. -->
{#snippet twist(path: string)}
  <span class="nib-row-meta twist">
    <Twist open={workspace.isExpanded(path)} />
  </span>
{/snippet}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    /* The rows the window has to hold on to while the scroll has moved on are drawn
       at their own offsets rather than in the flow; see `.away`. */
    position: relative;
    /* The arithmetic says where the list is, and nothing else may. A browser keeps a
       reader's place through a change in height by picking something on screen and
       holding the scroll to it - right for a page of words, wrong for a list whose
       rows come and go as it scrolls, because the row it anchored to has left the
       page a frame later and the scroll jumps by whatever it was worth. Turning a
       note's children out moved the scroll two thousand pixels on its own. The rows
       go with it: an element that may not be anchored to takes its descendants out
       of the running as well. */
    overflow-anchor: none;
  }

  /* The rows above the window and the rows below it, as height and nothing else.
     Two boxes rather than padding on the list, so the list's own top edge stays
     where the rows start and the arithmetic that reads it stays honest. */
  .gap {
    /* Never on screen - a box above the window only has height while the window
       has scrolled past it - and out of the way of a drag either way. */
    pointer-events: none;
  }

  /* A row on its way in or out with the twist above it. Clipped rather than
     squashed: the row inside keeps its own height and the box shows the part of
     it that is out, which is what the wrapper's overflow did. */
  .cut {
    overflow: hidden;
  }

  /* A row the list is holding on to while the window is elsewhere: the keyboard's,
     the one being named, the one a key has just asked for. At its true place in the
     list, so the scroll that brings the reader back to it lands where the row will
     be - and out of the flow, so the two boxes above and below still add up. */
  .away {
    position: absolute;
    left: 0;
    right: 0;
  }

  /* The row being carried, where it sits in the list. Hollow rather than hidden,
     because it is the gap: the space it leaves is exactly the space it will fill, so
     there is no drop line to draw and nothing for the reader to translate - what they
     see is the answer. The copy that follows the pointer is drawn from the same
     classes; see `.carried` below. */
  .row.is-lifted {
    opacity: 0.35;
  }

  /* The copy under the finger. Out of the list and above everything, a little larger
     than the row it came from and with a shadow under it, which is the whole of what
     "picked up" looks like: the two together say the row has left the surface. The
     platform draws this itself for a drag it started, and a touch screen starts none.

     It is in `body` rather than in the list, so no scroll and no rebuild of the window
     can take it away mid-gesture; the transform is written on it by hand every frame,
     so nothing here may set one. */
  :global(.row.carried) {
    position: fixed;
    z-index: 90;
    pointer-events: none;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-md, 0 6px 16px rgb(0 0 0 / 0.22));
    opacity: 0.95;
  }

  /* A row the space leaves out of its own search, its picture and its mentions.
     Still there to open and still syncing, and saying quietly that the space has
     stopped asking it things. Opacity rather than a colour, so the mark in front
     of the name goes quiet with it. See workspace/excluded.svelte.ts. */
  .row.is-left-out {
    opacity: 0.5;
  }

  /* The row is drawn in the themes package - see `.nib-row` in base.css. What is
     left here is where it sits: one step in per level of the tree, on a property
     rather than a number in the markup, so a phone takes a deeper step without
     this component knowing which kind of screen it is on. The outline's rows and
     the tag tree's are indented the same way. */
  .row {
    padding-inline-start: calc(var(--row-pad) + var(--level, 0) * var(--row-indent));
  }

  /* What a row holds, said at the far end of it rather than in front of the name.
     The mark in front is the note's own and says what the row is, so it cannot say
     "open" as well - and a twist in front of it would push one name in the list out
     of the column every other name is read in. The row's own trailing slot, which is
     where a list already puts what a row counts; see `.nib-row-meta` in the themes
     package. */
  .twist {
    display: grid;
    place-items: center;
    padding: 0 var(--space-1);
  }

  /* The box the twist fills; the shape and the turn are Twist.svelte's, which the
     tag tree draws too. */
  .twist :global(svg) {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  /* The open note's mark carries the accent. The name beside it is told apart by
     the fill under it and by its weight; the mark is the one place a colour of
     its own reads as the file being open rather than as the row being picked. */
  .row.is-on :global(.mark) {
    stroke: var(--accent);
    opacity: 1;
  }
</style>
