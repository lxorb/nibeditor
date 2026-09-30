<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { quintOut } from 'svelte/easing'
  import { agentMarks } from './agent-marks.svelte'
  import { dragged, isTreeDrag, mayCarryAddress } from './drag-paths'
  import { i18n, t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { menu, type MenuEntry } from './menu.svelte'
  import { middleOpens, tabAsk } from './new-tab'
  import { rooms } from './rooms.svelte'
  import { roving } from './roving'
  import { shortcuts } from './shortcuts.svelte'
  import { viewport } from './viewport.svelte'
  import { shownName } from './note-name'
  import { nameOf } from './space-paths'
  import SharedMark from './SharedMark.svelte'
  import { heldMark } from './surfaces.svelte'
  import TabMark from './TabMark.svelte'
  import { ClosingWidths } from './tab-strip/closing.svelte'
  import { wheelAlong } from './tab-strip/wheel'
  import { arrival, handOver, picks, register, stripOf, TabDrag } from './tab-strip/drag.svelte'
  import type { Block } from './tab-strip/picking.svelte'
  import {
    type Bounds,
    endOf,
    holds,
    keptWidths,
    MAGNETISM,
    moved,
    partsFor,
    placed,
    separated,
    slotAt,
    widthsFor,
    worthKeeping,
  } from './tab-strip/layout'
  import { pages } from './web-tab/pages.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import type { Landing } from './workspace/panes.svelte'
  import { pinnedRun } from './workspace/pinning'
  import { inside, zoneAt } from './workspace/zones'
  import { dur } from './motion'
  import Cross from './Cross.svelte'

  /** `caption` is the window's own titlebar: there the empty stretch of the strip is
   *  what the window is dragged by, and a double click on it maximises, the way it
   *  does beside Chrome's tabs. A strip over a pane is inside the window and is not. */
  const { paneId, caption = false }: { paneId: string; caption?: boolean } = $props()

  const pane = $derived(workspace.panes.at(paneId))
  const tabs = $derived(workspace.tabsIn(paneId))
  /** The pane that acts on the keyboard is marked here rather than by a border
   *  around the words: quietly, and where the tabs already say what is what. */
  const focused = $derived(workspace.panes.focusedId === paneId)
  const alone = $derived(workspace.panes.count < 2)
  /** Shown only where there is another pane on this note to scroll with. */
  const twinned = $derived(workspace.twins(paneId).length > 0)

  /** The tab the arrows are about, and whether this strip has been anywhere at
   *  all. The pair is drawn once a tab in this pane has moved on from one note
   *  to another, and stays after that: two arrows appearing and disappearing as
   *  the strip is walked along would move every tab under the pointer. */
  const walking = $derived(workspace.showing(paneId))
  const walked = $derived(tabs.some((one) => one.trail.length > 1))

  /** Where this tab has been, newest first, as rows to go straight back to.
   *  What is ahead of it is left out: forward is one arrow away and a list of
   *  both directions is a list nobody can read at a glance. */
  function trailMenu(tab: Tab): MenuEntry[] {
    return tab.trail
      .slice(0, tab.at)
      .map((path, at) => ({ label: shownName(nameOf(path)), at }))
      .reverse()
      .map((row) => ({ label: row.label, run: () => void workspace.walk(row.at, tab.id) }))
  }

  /** Everything a tab offers; see tab-strip/menu.ts. Fetched as the launch ends
   *  rather than carried into it (see `warmDoors`), so the browser's own menu is
   *  refused here, in the frame of the press. */
  function showMenu(event: MouseEvent, tab: Tab) {
    event.preventDefault()
    event.stopPropagation()
    void import('./tab-strip/menu').then(({ tabMenu, tabMenuTitle }) =>
      menu.show(event, tabMenu(tab, paneId), { title: tabMenuTitle(tab, paneId) }),
    )
  }

  /** A press on a paused agent's mark gives the tab back to it, and nothing else
   *  does (docs/agent-native.md 7.3). Read on the press, which is where the pointer
   *  was: the tab captures it, so the click lands on the tab as a whole. */
  let onMark = false
  function givesBack(id: string) {
    if (onMark && agentMarks.on[id]?.paused) agentMarks.act?.(id, 'give-back')
    onMark = false
  }

  /** The empty stretch's own menu, by the point: a held finger's has no target. */
  function showStripMenu(event: MouseEvent) {
    if (document.elementFromPoint(event.clientX, event.clientY) !== strip) return
    void import('./tab-strip/strip-menu').then(({ stripMenu }) =>
      menu.show(event, stripMenu(paneId)),
    )
  }

  /** A held finger is the right click a touch screen has, and the menu key is the one
   *  a keyboard has: all three ask for the same list, at the plus. What the list holds
   *  is new-kinds.ts - one list for the plus, the Ctrl+T dialog and the buttons an
   *  empty pane shows - fetched like the tab's own menu above, and already here by the
   *  first press: the dialog brings it as the launch ends. */
  function showNewMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    void import('./new-kinds').then(({ showNewKinds }) => showNewKinds(event, paneId))
  }

  /* ── Where the tabs are ───────────────────────────────────────────
     Chrome's layout, which is tab-strip/layout.ts. Every tab is placed by hand -
     absolutely, at a transform along the strip - rather than by a flex row, because
     the whole of what makes the strip feel like Chrome's is that tabs move to where
     they are meant to be rather than being there: a tab opening pushes the others
     along, one closing pulls them in, one being dragged slides the rest aside. With
     every position a number, each of those is the same eased transform. */

  /** Before the first tab, the room its foot reaches out into: an active first tab
   *  flares out past its own edge the way every active tab does, and the strip must
   *  not cut the flare off. */
  const LEAD = 8
  /** The plus, and the gap either side of it, which the tabs leave room for. */
  const PLUS_GAP = 4
  const PLUS = 28 + 2 * PLUS_GAP
  /** From the top of the strip to the top of a tab, which is the frame showing
   *  above it. Also in the stylesheet, as `--tab-top`. */
  const TOP = 5

  let strip = $state<HTMLElement>()
  let stripWidth = $state(0)
  /** Whether the strip has been laid out once, and is not being resized right now.
   *  Before the first measurement every tab is its standard width, and easing from
   *  that to the width that fits would be the launch visibly settling; while the
   *  window is being resized the tabs follow the edge rather than chasing it. */
  let live = $state(false)
  let resizing = $state(false)

  const room = $derived(
    stripWidth > 0 ? Math.max(0, stripWidth - LEAD - (viewport.touch ? 0 : PLUS)) : null,
  )

  const drag = new TabDrag()
  const closing = new ClosingWidths()
  /** The tab under a mouse, which hides the hairlines either side of it. */
  let hovered = $state<string | null>(null)
  /** The tab just let go of, which stays over its neighbours while it settles. */
  let settling = $state<string | null>(null)
  /** How far below the top of its body the pointer took hold of a tab, so the
   *  tab carried over the panes hangs from the same point. */
  let grabY = 0

  const activeId = $derived(pane?.activeTabId ?? null)
  const sized = $derived(
    tabs.map((tab) => ({ id: tab.id, pinned: tab.pinned, active: tab.id === activeId })),
  )
  const run = $derived(pinnedRun(tabs))

  /** Every tab's width in the strip's own order: held still while tabs are being
   *  closed with the pointer, else shared out by Chrome's rule. */
  const widths = $derived(
    (closing.widths ? keptWidths(sized, closing.widths) : null) ?? widthsFor(sized, room),
  )
  const base = $derived(placed(widths))

  /** The tabs picked with Ctrl or Shift, and what a press on one carries; see
   *  tab-strip/picking.svelte.ts. */
  const picking = $derived(picks.loaded)
  const picked = $derived(new Set(picking?.chosen.of(paneId).map((one) => one.id)))
  let plainOnPick = false
  let block = $state<Block | null>(null)
  const lifted = $derived(drag.tabId === null ? [] : (block?.ids ?? [drag.tabId]))

  const landing = $derived(workspace.panes.landing)
  /** Where something from outside the strip is about to be dropped: a note out of
   *  the file list, or a tab carried in from another pane. The strip makes room for
   *  it there, the way Chrome's strip makes room for a tab attaching to it. */
  const incoming = $derived(
    landing?.kind === 'strip' && landing.paneId === paneId && !drag.on ? landing.at : null,
  )

  /** Where each tab is drawn, and where the tabs end. */
  const layout = $derived.by(() => {
    const boxes: Record<string, Bounds> = {}
    const carried = drag.tabId

    if (carried) {
      if (block) return block.layout(room, drag)
      const from = drag.from
      const own = { x: drag.x, width: widths[from] ?? 0 }

      // Out over the panes: the strip closes up behind it, and the tab itself stays
      // where it last was, out of sight, holding the pointer.
      if (drag.out) {
        const rest = sized.filter((_, at) => at !== from)
        const bounds = placed(widthsFor(rest, room))
        for (const [at, one] of rest.entries()) boxes[one.id] = bounds[at] ?? own
        boxes[carried] = own
        return { boxes, end: endOf(bounds) }
      }

      const order = moved(sized, from, drag.slot)
      const bounds = placed(moved(widths, from, drag.slot))
      for (const [at, one] of order.entries()) {
        boxes[one.id] = one.id === carried ? own : (bounds[at] ?? own)
      }
      return { boxes, end: endOf(bounds) }
    }

    if (incoming !== null) {
      // A tab's worth of room where it would land, and the rest shrunk to make it,
      // exactly as they would be with the tab already there.
      const withGap = [
        ...sized.slice(0, incoming),
        { id: '', pinned: false, active: false },
        ...sized.slice(incoming),
      ]
      const bounds = placed(widthsFor(withGap, room))
      for (const [at, one] of withGap.entries()) {
        if (one.id) boxes[one.id] = bounds[at] ?? { x: 0, width: 0 }
      }
      return { boxes, end: endOf(bounds) }
    }

    for (const [at, one] of sized.entries()) boxes[one.id] = base[at] ?? { x: 0, width: 0 }
    return { boxes, end: endOf(base) }
  })

  /** The hairlines between tabs, in the order they are drawn in. */
  const lines = $derived.by(() => {
    const ids =
      drag.on && !drag.out
        ? (block?.order(drag) ?? moved(sized, drag.from, drag.slot).map((one) => one.id))
        : sized.filter((one) => !(drag.out && lifted.includes(one.id))).map((one) => one.id)
    // The room opening for a drop is a tab that is not there yet, and a gap needs
    // no hairline either side of it.
    if (incoming !== null) ids.splice(incoming, 0, '')
    const filled = new Set([...lifted, ...picked, '', activeId ?? '', hovered ?? ''])

    return separated(ids, filled)
  })

  /** Where a point on the glass is along the strip, from the start of the first
   *  tab, in the direction the interface reads, the strip's own scroll included. */
  function alongOf(clientX: number): number {
    if (!strip) return 0

    const box = strip.getBoundingClientRect()
    return i18n.factor > 0
      ? clientX - box.left - LEAD + strip.scrollLeft
      : box.right - LEAD - clientX - strip.scrollLeft
  }

  // What other strips ask this one, while it is on screen: where a tab carried in
  // from them would land, read off where the tabs are meant to be rather than where
  // they are drawn, so the answer does not move as the room opens under it.
  $effect(() =>
    register(paneId, {
      slotAt: (clientX) => slotAt(base, alongOf(clientX), run),
      top: () => (strip?.getBoundingClientRect().top ?? 0) + TOP,
    }),
  )

  // Held widths go as soon as the strip is not the one they were taken of.
  $effect(() => {
    closing.still(sized.map((one) => one.id))
  })

  // The first measurement is not a change, and a resize is not a movement.
  $effect.pre(() => {
    if (stripWidth <= 0) return
    if (!untrack(() => live)) {
      requestAnimationFrame(() => (live = true))
      return
    }

    resizing = true
    const frame = requestAnimationFrame(() => (resizing = false))
    return () => cancelAnimationFrame(frame)
  })

  // The tab being read is kept in view in a strip too full to show every tab.
  $effect(() => {
    const id = activeId
    const node = strip
    if (!id || !node || node.scrollWidth <= node.clientWidth) return

    node
      .querySelector<HTMLElement>(`[data-box="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })

  /* ── Closing ─────────────────────────────────────────────────────── */

  /** A tab closed by hand. Closed with the pointer, the others keep their widths
   *  until the pointer leaves, so the next close button is already under it; closed
   *  with a key there is no pointer to wait for. See tab-strip/closing.svelte.ts. */
  function closeTab(tab: Tab, by: 'mouse' | 'touch' | null) {
    if (by && worthKeeping(sized, room)) {
      closing.hold(
        new Map(sized.map((one, at) => [one.id, widths[at] ?? 0])),
        sized.map((one) => one.id),
        by,
        () => strip?.getBoundingClientRect() ?? null,
        () => i18n.factor,
      )
    }

    void workspace.closeAsking(tab.id)
  }

  /** What pressed the cross: a click a key sent has no pointer behind it. */
  function pointerOf(event: MouseEvent): 'mouse' | 'touch' | null {
    if (event.detail === 0) return null
    return 'pointerType' in event && event.pointerType === 'touch' ? 'touch' : 'mouse'
  }

  /* ── Dragging ─────────────────────────────────────────────────────
     Chrome's gesture; tab-strip/drag.svelte.ts holds the numbers. What is here is
     the window's half: pointer events in, and where the tab lands out. */

  /** A landing as one string, so a frame that would set the same one again sets
   *  nothing: the landing is read by every pane on the screen. */
  const keyOf = (where: Landing | null): string =>
    !where
      ? ''
      : where.kind === 'strip'
        ? `strip:${where.paneId}:${where.at}`
        : `pane:${where.paneId}:${where.zone}`

  /** Where a tab carried out of this strip would land: at a place in another
   *  pane's strip, or in or against a side of a pane. Nothing in the middle of its
   *  own pane, which it is already in - let go there, it goes back. */
  function landingAt(x: number, y: number, tabId: string): Landing | null {
    const under = document.elementFromPoint(x, y)
    const other = under?.closest<HTMLElement>('[data-strip]')

    if (other) {
      const id = other.dataset.strip ?? ''
      const at = id === paneId ? undefined : stripOf(id)?.slotAt(x)
      return at === undefined ? null : { kind: 'strip', paneId: id, at }
    }

    const box = under?.closest<HTMLElement>('[data-pane]')
    const id = box?.dataset.pane
    if (!box || !id) return null

    const zone = zoneAt(box.getBoundingClientRect(), x, y, (side) =>
      workspace.canLand(side, id, tabId),
    )
    return zone === 'middle' && id === paneId ? null : { kind: 'pane', paneId: id, zone }
  }

  /** The drop zones and the landing, kept in step with where the carried tab is.
   *  The panes only offer their zones once the tab is out of the strip: a tab
   *  going along its own strip has nothing to aim at. */
  function follow() {
    const tabId = drag.tabId
    if (!tabId) return

    const where = drag.out ? landingAt(drag.pointer.x, drag.pointer.y, tabId) : null
    if (keyOf(workspace.panes.landing) !== keyOf(where)) workspace.panes.landing = where

    const carried = drag.out ? tabId : null
    if ((workspace.panes.dragging?.tabId ?? null) !== carried) {
      workspace.panes.dragging = carried ? { tabId: carried } : null
    }
  }

  function unfollow() {
    workspace.panes.landing = null
    workspace.panes.dragging = null
  }

  /** Where the tab carried over the panes is drawn: under the pointer, held where it
   *  was grabbed, and lined up with a strip it is over, as if already in it. */
  const chip = $derived.by(() => {
    // `out` first: it is the state this hangs on, and the press is not state.
    if (!drag.out) return null
    const press = drag.pressing
    if (!press) return null

    const width = widths[sized.findIndex((one) => one.id === drag.tabId)] ?? 0
    const grab = press.grab - (block?.strip.before ?? 0)
    const left = i18n.factor > 0 ? drag.pointer.x - grab : drag.pointer.x + grab - width
    const target = landing?.kind === 'strip' ? stripOf(landing.paneId) : undefined

    return { left, top: target ? target.top() : drag.pointer.y - grabY, width }
  })

  const carriedTab = $derived(tabs.find((one) => one.id === drag.tabId) ?? null)

  /** The pointer, held by the tab for the rest of the drag. Refused where there is
   *  nothing to take - a finger is held by what it went down on already - which is
   *  no reason to drop a drag. */
  function capture(node: HTMLElement, pointerId: number) {
    try {
      node.setPointerCapture(pointerId)
    } catch {
      // Nothing to hold on to, and nothing that needs holding.
    }
  }

  function pressed(event: PointerEvent, tab: Tab, at: number) {
    // The middle button closes, on its release; its press must not start the
    // browser's scrolling instead.
    if (event.button === 1) {
      event.preventDefault()
      return
    }
    if (event.button !== 0 || drag.pressing) return

    const finger = event.pointerType === 'touch'
    if (!finger && picksWith(event)) {
      // Ctrl or Shift: the pick changes, and the press drags nothing.
      event.preventDefault()
      void (
        picks.loaded ? Promise.resolve(picks.loaded) : import('./tab-strip/picking.svelte')
      ).then((one) => {
        picks.loaded = one
        const how = one.pickingOf(event, shortcuts.platform === 'mac')
        const front = how && one.pick(paneId, tab.id, how)
        if (front) workspace.activate(front)
      })
      return
    }
    // Chrome activates a tab on the press, before anything has moved, so the tab
    // under a mouse answers at once and the one being dragged is the one open, and a
    // pick stays while this may drag it. A finger's press may be a scroll, so it waits.
    plainOnPick = picked.has(tab.id)
    if (!finger && !plainOnPick) picking?.chosen.clear()
    if (!finger) workspace.activate(tab.id)
    block = finger ? null : (picking?.Block.of(paneId, tab, sized, widths) ?? null)

    const node = event.currentTarget as HTMLElement
    const top = node.closest('.tab')?.getBoundingClientRect().top ?? event.clientY
    const along = alongOf(event.clientX)

    grabY = event.clientY - (top + TOP)
    drag.down({
      tabId: tab.id,
      from: block?.strip.from ?? at,
      pinned: tab.pinned,
      along,
      x: event.clientX,
      y: event.clientY,
      grab: along - (base[at]?.x ?? 0) + (block?.strip.before ?? 0),
      finger,
    })

    if (!finger) capture(node, event.pointerId)
  }

  function movedTo(event: PointerEvent) {
    const press = drag.pressing
    if (!press || !strip) return

    const lifting = !drag.on
    const up = drag.move(
      alongOf(event.clientX),
      event.clientX,
      event.clientY,
      holds(
        strip.getBoundingClientRect(),
        event.clientX,
        event.clientY,
        press.finger ? MAGNETISM.touch : MAGNETISM.mouse,
      ),
      block?.frame(room ?? endOf(base)) ?? { widths, room: room ?? endOf(base), pinnedRun: run },
    )
    if (!up) return

    event.preventDefault()
    if (lifting) {
      closing.letGo()
      // The held finger that opens the menu is this same finger on this same tab:
      // once it is carrying the tab, it is not asking about it. See longpress.ts.
      ;(event.currentTarget as HTMLElement).dispatchEvent(new CustomEvent('nib-took-over'))
    }
    follow()
  }

  /** The tab just let go of stays over its neighbours for as long as it takes to
   *  reach its slot. */
  function settle(tabId: string) {
    settling = tabId
    setTimeout(() => {
      if (settling === tabId) settling = null
    }, dur(210))
  }

  /** A tab that was out over the panes and comes back to its strip slides home from
   *  where it was let go, rather than appearing in its slot. */
  function flyHome(tabId: string, from: { left: number; top: number }) {
    requestAnimationFrame(() => {
      const node = strip?.querySelector<HTMLElement>(`[data-box="${CSS.escape(tabId)}"]`)
      const box = layout.boxes[tabId]
      if (!node || !box) return

      const rect = node.getBoundingClientRect()
      const x = box.x * i18n.factor
      node.animate(
        [
          {
            transform: `translate(${x + from.left - rect.left}px, ${from.top - TOP - rect.top}px)`,
          },
          { transform: `translate(${x}px, 0)` },
        ],
        { duration: dur(210), easing: easeOut() },
      )
    })
  }

  /** The app's one easing, read from the stylesheet that owns it. */
  const easeOut = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out'

  function released(event: PointerEvent) {
    if (!drag.pressing) return

    const from = chip
    const where = workspace.panes.landing
    const carried = block
    block = null
    const ending = drag.release()
    unfollow()
    if (ending.kind === 'click') {
      // Chrome's release: a plain click on a picked tab picks it alone.
      if (plainOnPick) picking?.chosen.clear()
      return
    }

    event.preventDefault()
    settle(ending.tabId)

    if (ending.kind === 'moved') {
      if (carried) carried.moved(paneId, ending.from, ending.to)
      else if (ending.to !== ending.from) workspace.moveTab(ending.tabId, paneId, ending.to)
      return
    }

    // Let go over another strip or a pane: that is where it goes, from where it was.
    if (where) {
      if (from) handOver(ending.tabId, from.left, from.top)
      if (carried) carried.dropped(where)
      else workspace.dropTab(ending.tabId, where)
    } else if (from) {
      flyHome(ending.tabId, from)
    }
  }

  /** The drag given up - Escape, or a window that took the pointer away. Every tab
   *  goes back to where it was and nothing is written down. */
  function giveUp() {
    const tabId = drag.tabId
    const from = chip
    block = null
    drag.cancel()
    unfollow()
    if (!tabId) return

    settle(tabId)
    if (from) flyHome(tabId, from)
  }

  /** On the window, and before anything else hears it, because a tab carried under
   *  a pointer has not been focused and Escape must not also close whatever layer
   *  is open. */
  function keyed(event: KeyboardEvent) {
    if (!drag.on || event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    giveUp()
  }

  onDestroy(() => {
    if (drag.on) unfollow()
    closing.letGo()
  })

  /* ── Arriving and leaving ─────────────────────────────────────────
     Chrome grows a new tab out of nothing at the end of the tab before it, while the
     tabs after it slide along, and shrinks a closed one back to nothing the same
     way. Width is the one property that has to move for that, and it is a width of
     an absolutely placed box, so it lays out that tab and nothing beside it. */

  const widthOf = (node: HTMLElement) => parseFloat(node.style.width) || 0

  function arrive(node: HTMLElement, { id, x }: { id: string; x: number }) {
    const from = arrival(id)
    const duration = dur(210)

    // Carried in from another strip: it slides from where it was let go.
    if (from) {
      const rect = node.getBoundingClientRect()
      const dx = from.left - rect.left
      const dy = from.top - TOP - rect.top
      return {
        duration,
        easing: quintOut,
        css: (_t: number, u: number) => `transform: translate(${x + dx * u}px, ${dy * u}px)`,
      }
    }

    // Opened: it grows out of the end of the tab before it, which is still where
    // that tab is drawn this frame, and slides with it as the strip makes room.
    const width = widthOf(node)
    const before = node.previousElementSibling
    const dx = before?.classList.contains('tab')
      ? before.getBoundingClientRect().right - node.getBoundingClientRect().left
      : 0

    return {
      duration,
      easing: quintOut,
      css: (t: number, u: number) =>
        `width: ${t * width}px; transform: translateX(${x + dx * u}px)`,
    }
  }

  function leave(node: HTMLElement) {
    const width = widthOf(node)
    return { duration: dur(210), easing: quintOut, css: (t: number) => `width: ${t * width}px` }
  }

  /* ── A note out of the file list, or a link out of another app ─────── */

  /** Whether a drag is one the strip takes: rows out of the file list, or what may be
   *  a link dragged in from another app. See tab-strip/dropped.ts. */
  const takes = (transfer: DataTransfer | null) =>
    isTreeDrag(transfer) || mayCarryAddress(transfer?.types ?? [])

  function over(event: DragEvent) {
    if (!takes(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer && isTreeDrag(event.dataTransfer)) {
      event.dataTransfer.dropEffect = 'move'
    }

    const at = slotAt(base, alongOf(event.clientX), run)
    const where: Landing = { kind: 'strip', paneId, at }
    if (keyOf(workspace.panes.landing) !== keyOf(where)) workspace.panes.landing = where
  }

  function dropped(event: DragEvent) {
    const transfer = event.dataTransfer
    if (!takes(transfer)) return

    event.preventDefault()
    event.stopPropagation()

    const at = slotAt(base, alongOf(event.clientX), run)
    workspace.panes.landing = null
    workspace.panes.dropped()

    if (!isTreeDrag(transfer)) {
      // A page, as a tab of its own where it was let go, in front: Chrome's drop. The
      // transfer is read now, while the drop still holds it.
      const held = new Map(
        ['text/uri-list', 'text/plain'].map((type) => [type, transfer?.getData(type) ?? '']),
      )
      void import('./tab-strip/dropped').then(({ droppedAddress }) => {
        const address = droppedAddress((type) => held.get(type) ?? '')
        // Opened from the tab in front of that pane, so it lands in that pane.
        const from = workspace.panes.at(paneId)?.activeTabId ?? undefined
        const id = address === null ? null : workspace.openPage(address, 'plain', from)
        if (id !== null) workspace.moveTab(id, paneId, at)
      })
      return
    }

    const paths = dragged(transfer)
    if (paths.length) void workspace.dropNotes(paths, { kind: 'strip', paneId, at })
  }

  /* ── The wheel, and F2 ───────────────────────────────────────────── */

  // Along a strip too full to show every tab; see tab-strip/wheel.ts. Not passive,
  // because a turn the strip takes must not also scroll whatever is under it.
  $effect(() => {
    const node = strip
    if (!node) return

    const turned = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return
      const along = wheelAlong(event, node.clientWidth)
      if (along === 0) return

      event.preventDefault()
      node.scrollLeft += along * i18n.factor
    }

    node.addEventListener('wheel', turned, { passive: false })
    return () => node.removeEventListener('wheel', turned)
  })

  /** F2 on a tab renames its file, which is the key a file list renames with; see
   *  `renameFromTab`. */
  function renameKey(event: KeyboardEvent) {
    if (!shortcuts.pressed('tabs.rename', event) || !(event.target instanceof Element)) return

    const id = event.target.closest<HTMLElement>('.pick')?.dataset.tab
    const tab = tabs.find((one) => one.id === id)
    if (!tab || !workspace.canRenameFromTab(tab)) return

    event.preventDefault()
    void import('./tab-strip/ops').then((ops) => ops.renameFromTab(tab.id))
  }

  /** Whether a click picks: Ctrl, Cmd on a Mac, or Shift. */
  const picksWith = (event: MouseEvent) =>
    event.shiftKey || (shortcuts.platform === 'mac' ? event.metaKey : event.ctrlKey)

  /** Chrome's hover card, fetched with the first pointer on a tab; see hover-card.svelte.ts. */
  let cards: Promise<typeof import('./tab-strip/hover-card.svelte')> | undefined
  const card = (tab: Tab, node: Element | null, focused = false) =>
    void (cards ??= import('./tab-strip/hover-card.svelte')).then(({ hovering }) =>
      node ? hovering.restOn(tab, node, Math.max(0, ...widths), focused) : hovering.leave(tab.id),
    )

  /** Puts an element at the end of the page, where no strip can clip it and no
   *  pane can draw over it: the tab carried over the panes. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }
</script>

<!-- Escape gives up a drag. On the window because a tab carried under a pointer has
     not been focused, and the key has to reach the drag wherever the keyboard is. -->
<svelte:window onkeydowncapture={keyed} />

<div class="strip">
  <!-- Where this pane has been. Two arrows, at the head of the strip the way
       every browser puts them, and only in a pane that has been anywhere: a note
       opened and read is not a journey. Each says whether it can go, rather than
       going and doing nothing. The back one also holds the trail itself, which is
       the one place the whole of it can be read. -->
  {#if walked && walking}
    <div class="steps">
      <button
        class="step"
        title={shortcuts.tooltip(t('Back'), 'app.back')}
        aria-label={t('Back')}
        disabled={!walking.canGoBack}
        onclick={(event) => workspace.goBack(walking.id, tabAsk(event))}
        use:middleOpens={(event) => workspace.goBack(walking.id, tabAsk(event))}
        oncontextmenu={(event) =>
          walking.canGoBack && menu.show(event, trailMenu(walking), { title: t('Back') })}
        use:longPress={(event) =>
          walking.canGoBack && menu.show(event, trailMenu(walking), { title: t('Back') })}
      >
        <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
      </button>
      <button
        class="step"
        title={shortcuts.tooltip(t('Forward'), 'app.forward')}
        aria-label={t('Forward')}
        disabled={!walking.canGoForward}
        onclick={(event) => workspace.goForward(walking.id, tabAsk(event))}
        use:middleOpens={(event) => workspace.goForward(walking.id, tabAsk(event))}
      >
        <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
      </button>
    </div>
  {/if}

  <!-- The whole strip takes a note dropped out of the file list, and makes room
       for it where it would land. In the titlebar its empty stretch is the
       window's caption: dragged, it moves the window, and a double click maximises
       it, which is what the stretch beside Chrome's tabs does. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- The strip is one tab stop, on whichever note is open, and left and right
       move along it. Unlike the panel tabs it does not change as it is arrived at:
       every one of these is a file to be read off a disk, and the ARIA practices
       say to choose on arrival only where arriving costs nothing. So an arrow moves,
       Enter opens, and Delete closes - which is what the practices give for a strip
       whose tabs can be closed. See roving.ts. -->
  <div
    class="tabs"
    data-region="tabs"
    data-strip={paneId}
    data-tauri-drag-region={caption ? '' : undefined}
    bind:this={strip}
    bind:clientWidth={stripWidth}
    style:--lead="{LEAD}px"
    style:--tab-top="{TOP}px"
    use:roving={{
      across: true,
      rows: '.pick',
      current: '.active > .pick',
      wrap: true,
      quiet: '.shut',
      open: (row) => row.click(),
      peek: (row) => row.click(),
      remove: (row) => void workspace.closeAsking(row.dataset.tab ?? ''),
      menu: (row, at) => row.dispatchEvent(at),
    }}
    class:quiet={!focused && !alone}
    class:live={live && !resizing}
    class:moving={drag.on}
    ondragover={over}
    ondragleave={(event) => {
      const box = event.currentTarget.getBoundingClientRect()
      if (incoming === null || inside(box, event.clientX, event.clientY)) return

      workspace.panes.landing = null
    }}
    ondrop={dropped}
    onkeydown={renameKey}
    oncontextmenu={showStripMenu}
    use:longPress={showStripMenu}
  >
    {#each tabs as tab, at (tab.id)}
      <!-- How many other devices are in this note, once and at most three: the
           expression below it allocated a fresh array-like per tab per render. -->
      {@const elsewhere = Math.min(rooms.present[tab.note.key] ?? 0, 3)}
      {@const box = layout.boxes[tab.id] ?? { x: 0, width: 0 }}
      {@const parts = partsFor(
        box.width,
        { pinned: tab.pinned, active: tab.id === activeId },
        viewport.touch,
      )}
      <!-- Placed by hand: a width, and a transform along the strip. The tab being
           dragged is drawn where the pointer has it; see `layout`. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        data-box={tab.id}
        class:active={tab.id === activeId}
        class:pinned={tab.pinned}
        class:preview={tab.id === workspace.previewTabId}
        class:line={lines.has(tab.id)}
        class:closable={parts.close}
        class:chosen={picked.has(tab.id)}
        class:carried={lifted.includes(tab.id) && !drag.out}
        class:gone={lifted.includes(tab.id) && drag.out}
        class:settling={settling === tab.id}
        class:onbar={tab.kind === 'web'}
        style:width="{box.width}px"
        style:transform="translateX({box.x * i18n.factor}px)"
        style:--w="{box.width}px"
        onpointerenter={(event) => {
          if (event.pointerType !== 'mouse') return
          hovered = tab.id
          card(tab, event.currentTarget)
        }}
        onpointerleave={() => {
          if (hovered === tab.id) hovered = null
          card(tab, null)
        }}
        in:arrive={{ id: tab.id, x: box.x * i18n.factor }}
        out:leave
      >
        <!-- The tab's shape: the rounded body with its feet when it is the one
             being read, nothing on the frame when it is not. -->
        <span class="fill" aria-hidden="true"></span>
        <!-- A double click keeps a preview, the way VS Code does it. A long press
             stands in for the right click on a touch screen, and the middle button
             closes, as it does on every browser's tab. Dragged, it goes along its
             own strip, into another pane's strip, or against a side of a pane to
             make one there. -->
        <!-- Named by the note, and named on the button. A pinned tab is a mark and
             no words, and the name used to be put on the `span` around the mark -
             which has no role, so nothing read it and the tab was a button with
             nothing to call it. No `title`: the hover card says the name. -->
        <button
          class="pick"
          class:centred={parts.centred}
          data-tab={tab.id}
          aria-label={tab.shown}
          onfocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) card(tab, event.currentTarget, true)
          }}
          onblur={() => card(tab, null)}
          onclick={(event) => {
            givesBack(tab.id)
            // A click with Ctrl or Shift was a pick, and its press answered it.
            if (event.detail > 0 && picksWith(event)) return
            workspace.activate(tab.id)
          }}
          ondblclick={() => workspace.keep(tab.id)}
          oncontextmenu={(event) => showMenu(event, tab)}
          onauxclick={(event) => {
            if (event.button === 1) closeTab(tab, 'mouse')
          }}
          onpointerdown={(event) => {
            onMark = event.target instanceof Element && !!event.target.closest('.face')
            pressed(event, tab, at)
          }}
          onpointermove={movedTo}
          onpointerup={released}
          onpointercancel={giveUp}
          onlostpointercapture={() => {
            if (drag.on) giveUp()
          }}
          use:longPress={(event) => showMenu(event, tab)}
        >
          <!-- What this tab is looking at, on every tab: a strip of a note, a
               canvas and two websites says which is which before any of the names
               are read. The icon the file chose for its row where it chose one,
               because it is the same file and one file wears one mark - which is the
               whole of what a pinned tab is reduced to. See TabMark.svelte. -->
          <span class="face" class:hidden={!parts.mark}><TabMark {tab} /></span>
          {#if tab.reading}
            <!-- An open book, quietly: the tab says which face of the note is up
                 without spending a word on it. -->
            <!-- A drawing that says something, so it says what: an `svg` carrying a
                 name and no role is a graphic nothing reads. -->
            <svg
              class="reading"
              class:hidden={!parts.title}
              viewBox="0 0 14 12"
              role="img"
              aria-label={t('Reading')}
              transition:fade={{ duration: dur(140) }}
            >
              <path d="M7 3.2v7.3M7 3.2C5.6 2 3.9 1.6 1.5 1.6v7.3c2.4 0 4.1.4 5.5 1.6" />
              <path d="M7 3.2c1.4-1.2 3.1-1.6 5.5-1.6v7.3c-2.4 0-4.1.4-5.5 1.6" />
            </svg>
          {/if}
          <!-- The name, which takes whatever the tab has left and fades out at its
               end rather than being cut with an ellipsis, as Chrome's does. A pinned
               tab is its mark and nothing else: a tab kept open all day is one
               somebody knows by sight. The name is still what it says to a reader
               who cannot see it, and what the title shows. -->
          {#if !tab.pinned}
            <span class="label" class:hidden={!parts.title}>{tab.shown}</span>
          {/if}
          <!-- Chrome's speaker, struck through on a muted site. -->
          {#if tab.kind === 'web' && parts.title}
            {@const heard = pages.of(tab.id)}
            {#if heard.playing}
              <svg
                class="reading"
                viewBox="0 0 14 14"
                role="img"
                aria-label={heard.muted ? t('Muted') : t('Playing audio')}
                transition:fade={{ duration: dur(140) }}
              >
                <path d="M2.5 5.2h2L7.6 2.8v8.4L4.5 8.8h-2z" />
                <path
                  d={heard.muted
                    ? 'M9.6 5.4l3 3m0-3-3 3'
                    : 'M9.8 5a2.9 2.9 0 0 1 0 4M11.6 3.4a5.2 5.2 0 0 1 0 7.2'}
                />
              </svg>
            {/if}
          {/if}
          <!-- Not yours: this document is one somebody else shared on its own, and
               the tab says so in the mark the whole app says it with. On the tab
               because there is nowhere else it could be said - a shared file has no
               row in the tree to carry it. See SharedMark.svelte. -->
          {#if tab.note.shared && parts.title}
            <SharedMark label={t('Shared with you')} />
          {/if}
          {#if heldMark.asked && parts.title}
            {#await heldMark.asked then Held}<Held path={tab.path} />{/await}
          {/if}
          <!-- Who else is in this note: one dot per other device, in the accent,
               and nothing at all while nobody is. No word, because the dots are
               already the whole sentence. -->
          {#if elsewhere && parts.title}
            <span
              class="here"
              role="img"
              aria-label={t('Also open elsewhere')}
              title={t('Also open elsewhere')}
            >
              {#each { length: elsewhere } as _, at (at)}
                <span class="who" transition:fade={{ duration: dur(190) }}></span>
              {/each}
            </span>
          {/if}
        </button>
        <!-- A pinned tab has no cross: what is kept is not closed by the hand that
             happened to be passing over it. Ctrl+W, the middle button and the row
             in the tab's own menu still close it, which is what Emil asked for and
             what a browser does. Any other tab shows it while it is the one being
             read or has the room for it, as Chrome's do. -->
        {#if !tab.pinned}
          <button
            class="shut"
            class:hidden={!parts.close}
            title={shortcuts.tooltip(t('Close'), 'app.close')}
            aria-label={t('Close')}
            onclick={(event) => closeTab(tab, pointerOf(event))}
          >
            <Cross small />
          </button>
        {/if}
      </div>
    {/each}

    <!-- A press opens the chooser: note, canvas, website, page note. The right
         click, the held finger and the menu key open the same list, so the plus
         answers every way of asking with the one gesture Emil asked for.
         Right after the last tab, and moving with it, as Chrome's does.
         Left out on a phone and a tablet, which hold one document at a time: a
         plus has no second tab to open, and the round button over the note is
         what makes one there. Left out rather than hidden, so no key reaches it
         and nothing reads it out. -->
    {#if !viewport.touch}
      <button
        class="new"
        title={shortcuts.tooltip(t('New'), 'app.new-kind')}
        aria-label={t('New')}
        aria-haspopup="menu"
        style:transform="translateX({(layout.end + PLUS_GAP) * i18n.factor}px)"
        onclick={showNewMenu}
        oncontextmenu={showNewMenu}
        use:longPress={showNewMenu}
      >
        <svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" /></svg>
      </button>
    {/if}
  </div>

  <!-- Two links of a chain: this pane scrolls with the other one on the same
       note. Only there while there is another one. -->
  {#if twinned}
    <button
      class="link"
      class:on={pane?.linked}
      title={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-label={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-pressed={!!pane?.linked}
      onclick={() => workspace.toggleLink(paneId)}
    >
      <svg viewBox="0 0 14 14">
        <path
          d="M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6"
        />
      </svg>
    </button>
  {/if}
</div>

<!-- The tab carried out over the panes: the tab itself, lifted off the strip, held
     where it was grabbed. At the end of the page, so nothing clips it and nothing
     is drawn over it; see `portal`. -->
{#if chip && carriedTab}
  <div
    class="chip"
    class:onbar={carriedTab.kind === 'web'}
    use:portal
    style:width="{chip.width}px"
    style:transform="translate({chip.left}px, {chip.top}px)"
    aria-hidden="true"
  >
    <TabMark tab={carriedTab} />
    {#if !carriedTab.pinned}<span class="label">{carriedTab.shown}</span>{/if}
  </div>
{/if}

<style>
  /* All the room the row has, and the tabs share it out themselves: see `layout`.
     The window's controls and the caption either side keep what they need. */
  .strip {
    display: flex;
    align-items: stretch;
    min-width: 0;
    flex: 1 1 0;
  }

  /* The tabs are placed by hand inside this box, so it is only a box: as tall as
     the row, as wide as what is left of it, and scrolling sideways only once even
     the narrowest tabs do not fit - which Chrome would cut off, and a tab nobody
     can see is a tab nobody can press. */
  .tabs {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    transition: opacity var(--dur-base) var(--ease-out);
    /* What the active tab is filled with: the ground of whatever is directly under
       the strip, so the two are one surface. A note's page by default; a tab that
       brings a bar of its own says so with `.onbar`. */
    --tab-ground: var(--bg);
    /* The fill a hovered tab gets: the active tab's colour, part of the way. */
    --tab-hover: color-mix(in srgb, var(--tab-ground) 40%, transparent);
    /* Chrome's top corner, and its concave foot at the bottom. */
    --tab-round: var(--radius-md);
    --tab-foot: var(--radius-md);
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  /* The pane that is not being worked in says so by receding. Nothing is drawn
     around the words themselves; a line there is a line to read past. */
  .tabs.quiet {
    opacity: 0.55;
  }

  /* One tab: a box as tall as the strip, at a place along it. Its shape is drawn
     inside it; see `.fill`. */
  .tab {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: var(--lead);
    user-select: none;
    -webkit-user-select: none;
    /* The top corners round less on a narrow tab, so a third of its top is always
       flat and a sliver of a tab is not a pill: Chrome's rule. */
    --round: clamp(0px, (var(--w) - 6px - 2 * var(--tab-round)) / 3, var(--tab-round));
  }

  /* Every tab moves to where it is meant to be, on the app's one easing and at
     Chrome's pace: opening, closing, making room, settling. Not before the first
     layout and not while the window is being resized. */
  .tabs.live .tab,
  .tabs.live .new {
    transition:
      transform var(--dur-base) var(--ease-out),
      width var(--dur-base) var(--ease-out);
  }

  /* The one being dragged is fixed to the pointer: an easing there would be the tab
     disagreeing with the hand. */
  .tabs.live .tab.carried {
    transition: none;
  }

  .tab.active {
    z-index: var(--z-raised);
  }

  .tab.carried,
  .tab.settling {
    z-index: var(--z-lifted);
  }

  /* Out over the panes, where the tab is drawn at the end of the page instead. It
     keeps the pointer, so it is only out of sight. */
  .tab.gone {
    opacity: 0;
  }

  /* While a tab is being carried nothing else in the strip answers the pointer: a
     neighbour lighting up under a tab passing over it is noise. */
  .tabs.moving .tab:not(.carried) {
    pointer-events: none;
  }

  /* A tab over a page has the bar the page brings as its ground. */
  .tab.onbar {
    --tab-ground: var(--surface);
  }

  /* The body: a rounded box from the frame down, a hair inside the tab's own box
     so two neighbours' fills never touch. Filled only on the active tab, which then
     runs down into what is under the strip with no line between them. */
  .fill {
    position: absolute;
    inset: var(--tab-top) 3px 0;
    border-radius: var(--round) var(--round) 0 0;
    pointer-events: none;
  }

  .tab.active .fill {
    background: var(--tab-ground);
  }

  /* Picked with Ctrl or Shift: the hover's box, held, as Chrome's selected tab. */
  .tab.chosen:not(.active)::before {
    opacity: 1;
  }

  /* The two feet: where the active tab meets the bar under it, it flares out into
     it with a concave curve on either side, which is the whole of what makes it
     read as the same surface rather than a box sitting on one. */
  .tab.active .fill::before,
  .tab.active .fill::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: var(--tab-foot);
    height: var(--tab-foot);
  }

  .tab.active .fill::before {
    right: 100%;
    background: radial-gradient(
      circle at 0 0,
      transparent calc(var(--tab-foot) - 0.5px),
      var(--tab-ground) var(--tab-foot)
    );
  }

  .tab.active .fill::after {
    left: 100%;
    background: radial-gradient(
      circle at 100% 0,
      transparent calc(var(--tab-foot) - 0.5px),
      var(--tab-ground) var(--tab-foot)
    );
  }

  /* Hovered, a tab that is not the active one lights as a floating rounded box,
     short of the bar underneath: Chrome's hover, faded in and out. */
  .tab::before {
    content: '';
    position: absolute;
    inset: var(--tab-top) 3px 6px;
    border-radius: var(--round);
    background: var(--tab-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .tab:not(.active):hover::before {
      opacity: 1;
    }
  }

  /* The hairline between two tabs that are both only their names on the frame;
     see `separated`. Faded rather than cut, with the hover beside it. */
  .tab::after {
    content: '';
    position: absolute;
    inset-inline-end: -0.5px;
    top: calc(50% + var(--tab-top) / 2 - 8px);
    width: 1px;
    height: 16px;
    background: var(--line-strong);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .tab.line::after {
    opacity: 1;
  }

  button {
    border: none;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  /* The whole height of the tab takes the press, not only its body: a pointer
     thrown at the top of the window still lands on a tab. The contents sit in the
     body, eight in from its sides, and a finger dragging along the strip moves the
     tab under it rather than scrolling. */
  .pick {
    position: absolute;
    inset: 0 3px;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: var(--tab-top) 8px 0;
    overflow: hidden;
    white-space: nowrap;
    text-align: start;
    touch-action: none;
  }

  /* Room at the end for the close button, which sits over the tab rather than in
     the row so the name does not jump as it comes and goes. */
  .tab.closable .pick {
    padding-inline-end: calc(8px + 16px + 4px);
  }

  /* Too narrow for anything but the mark: the mark, in the middle, clipped. */
  .pick.centred {
    justify-content: center;
    padding-inline: 0;
  }

  .tab:hover .pick {
    color: var(--text);
  }

  .tab.active .pick {
    color: var(--text-strong);
  }

  .face {
    display: flex;
    flex: none;
  }

  .hidden {
    display: none;
  }

  /* The parts of a tab are spaced one by one rather than by a gap on the row, so
     a part that is not there takes its space with it. The mark is first and wants
     none; the shared glyph brings its own, the same lead it has in every other
     list. */
  .reading,
  .label,
  .here {
    margin-inline-start: 6px;
  }

  /* The name takes what the tab has left and fades out over its last three
     characters, or a third of itself on a very narrow tab, rather than ending in an
     ellipsis - Chrome's FADE_TAIL. It is as wide as the room, so a short name
     never reaches the fade. A note's own name, isolated: a file called `خطة.md` in a
     strip that reads left to right keeps its extension at its own end. See
     .nib-row-label in base.css. */
  .label {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    unicode-bidi: isolate;
    --fade: min(24px, 33%);
    mask-image: linear-gradient(to right, #000 calc(100% - var(--fade)), transparent);
  }

  :global(:root[dir='rtl']) .label {
    mask-image: linear-gradient(to left, #000 calc(100% - var(--fade)), transparent);
  }

  /* Italic says the note is only being looked at, and that the next thing
     clicked in the file list will take this tab's place. */
  .tab.preview .pick {
    font-style: italic;
  }

  /* The open book, after the mark that says what the tab holds and before the name:
     the two say different kinds of thing and should not be read as one pair, and a
     state belongs beside the name rather than in front of the mark. Smaller than the
     mark, because it is about the note rather than what the note is. */
  .reading {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  /* One dot per other device in the note, stacked so they read as a small group
     rather than as a row of separate marks. Three at most: past that the answer
     is "several", and counting them is not what anyone is looking for. */
  .here {
    display: flex;
    flex: none;
    align-items: center;
    /* Overlapped by a third of themselves, which is what makes a stack. */
    margin-inline-end: -2px;
  }

  .who {
    width: 5px;
    height: 5px;
    flex: none;
    margin-inline-end: -2px;
    border-radius: 50%;
    background: var(--accent);
    /* A ring in the tab's own colour, so two dots against each other still read
       as two. */
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  /* The close button: sixteen pixels and round, at the end of the body, lit by a
     circle when the pointer is on it. Its press area reaches four pixels past the
     circle, so it is Chrome's target and not a sixteen-pixel one. */
  .shut {
    position: absolute;
    inset-inline-end: calc(3px + 8px);
    top: calc(50% + var(--tab-top) / 2 - 8px);
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    flex: none;
    padding: 0;
    border-radius: 50%;
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .shut::after {
    content: '';
    position: absolute;
    inset: -4px;
  }

  .shut.hidden {
    display: none;
  }

  .shut:hover {
    color: var(--danger);
    background: var(--surface-hover);
  }

  /* A press is a step stronger than the hover, and "stronger" is towards the ink
     rather than towards black: mixed with black it came out darker than the
     danger colour on a dark theme, which is a press that reads as fading. */
  .shut:active {
    color: color-mix(in srgb, var(--danger) 78%, var(--text-strong));
    background: var(--surface-press);
  }

  /* A mark inside a row that is not the row's own, which is `--icon-sm`, drawn a
     little smaller here so the cross sits inside its circle. */
  .shut :global(svg) {
    width: 8px;
    height: 8px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  /* The plus: right after the last tab, moving with it, as Chrome's does. */
  .new {
    position: absolute;
    inset-inline-start: var(--lead);
    top: calc(50% + var(--tab-top) / 2 - var(--row-height) / 2);
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .new:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .new:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .new svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  /* The tab carried out over the panes: its body, lifted - rounded all round,
     since it is off the bar it would have flared into, with the small shadow of a
     thing held just above the page. */
  .chip {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-carried);
    height: calc(var(--titlebar-height) - var(--tab-top, 5px));
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
    pointer-events: none;
    will-change: transform;
  }

  .chip.onbar {
    background: var(--surface);
  }

  .chip .label {
    margin: 0;
  }

  /* Where the pane has been, at the head of the strip. Quiet until there is
     something to press, and never in the way: the pair is the width of two marks
     and gives none of it back as the strip fills. */
  .steps {
    display: flex;
    align-items: center;
    flex: none;
    padding-inline-start: var(--space-1);
    padding-top: var(--tab-top, 5px);
  }

  .step {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    display: grid;
    place-items: center;
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .step:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .step:active:not(:disabled) {
    background: var(--surface-press);
  }

  .step svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .link {
    flex: none;
    align-self: center;
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    margin: 0 var(--space-1);
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .link:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .link:active {
    background: var(--surface-press);
  }

  .link.on {
    color: var(--accent);
    background: var(--surface-selected);
  }

  .link svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }
</style>
