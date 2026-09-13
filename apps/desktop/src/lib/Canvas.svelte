<script lang="ts">
  /** A canvas: an endless plane with cards, shapes, connectors and ink on it, in
   *  a tab like a note.
   *
   *  One transform for the whole plane. The cards are ordinary elements at the
   *  coordinates the file gives them, the connectors are one SVG layer beside
   *  them, the ink is two 2d canvases over both, and panning and zooming move the
   *  plane rather than anything in it - so a pan is a composited transform with
   *  no layout to redo, whether there are five cards or five hundred. Cards far
   *  off screen are left out of the page altogether.
   *
   *  Every gesture goes through the machine in canvas/pointer.ts. This file does
   *  three things and no more: it works out what is under a point, it hands the
   *  machine the event, and it carries out the effects it gets back. What a press
   *  means is not decided here, which is why it can be tested without a browser.
   *
   *  A gesture is one edit. What the plane shows while a gesture is under way is
   *  the same pure function of the canvas that the gesture ends by committing, so
   *  what you let go of is exactly what you saw, and nothing is written or
   *  recorded in between.
   *
   *  Keys. Undo, redo and select all are read off the shortcut registry, so a
   *  reader who rebound them has their own keys here too. The rest mean something
   *  only while a plane is the surface in front, so they are read straight. */

  import { untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import type { NoteJump } from '@nib/editor'
  import CanvasBar from './CanvasBar.svelte'
  import CanvasEdges from './CanvasEdges.svelte'
  import CanvasFind from './CanvasFind.svelte'
  import CanvasHands from './CanvasHands.svelte'
  import CanvasInk from './CanvasInk.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import CanvasPicked from './CanvasPicked.svelte'
  import { graphPoint, zoomed } from './camera'
  import { canvasMenu, place, pull, run } from './canvas/actions'
  import {
    coloured,
    movedBy,
    pickedBox,
    resizedPick,
    subset,
    turnedInk,
    withText,
  } from './canvas/edits'
  import {
    type Canvas as Plane,
    type InkPoint,
    readCanvas,
    type Shape,
    writeCanvas,
  } from './canvas/format'
  import {
    type Box,
    boxOf,
    caught,
    edgeEnds,
    edgeMiddle,
    GRID,
    HANDLES,
    isLineShape,
    overlaps,
    type Point,
    rectBetween,
    shapePath,
  } from './canvas/geometry'
  import { Contacts, hovering, penKind, Stylus } from './canvas/contacts'
  import { cursorFor, type Over } from './canvas/cursor'
  import { hand } from './canvas/hand.svelte'
  import { aimed, fading, latticeLayers, latticeLevel, settled, stepped } from './canvas/lattice'
  import { pens } from './canvas/pens.svelte'
  import { hitAt, HANDLE, PORT } from './canvas/hit'
  import { assisted, leadPoint, penFelt, tidyShape, transformed } from './canvas/ink'
  import { inkColour } from './canvas/paint'
  import { readPalette } from './canvas/palette'
  import {
    type Effect,
    type Hit,
    type Input,
    type Machine,
    NOTHING,
    puts,
    start,
    step,
  } from './canvas/pointer'
  import { NO_SNAP, snapMove, snapPoint, snapResize } from './canvas/snap'
  import { Trace } from './canvas/trace'
  import { isPicture } from './canvas/render'
  import { facingSide, SIDES, sidePoint } from './canvas/geometry'
  import { CanvasStore } from './canvas/store.svelte'
  import { tools } from './canvas/tools.svelte'
  import { dragged as draggedPaths, isTreeDrag } from './drag-paths'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { dur } from './motion'
  import { rooms } from './rooms.svelte'
  import { canWriteIn, trustsHtmlIn } from './sharing.svelte'
  import { pastesMarkup } from './trust'
  import { shortcuts } from './shortcuts.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace, type Tab } from './workspace.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  /** The plane this tab is showing. Built once from the tab it was given: the
   *  pane keys this component by tab, so a canvas surface and its tab live and
   *  die together and there is no second tab to follow. */
  const store = untrack(() => new CanvasStore(tab))

  /** How far beyond the edges of the view a card is still drawn, in plane units.
   *  A screenful of slack, so a pan crosses a whole viewport before the set of
   *  cards on the page changes at all. */
  const SLACK = 800

  /** How far the view has to move before which cards are on the page is worked
   *  out again, in plane units.
   *
   *  Without this the answer changes on every frame of a pan, and a new list of
   *  cards means the whole each block is walked and five hundred components are
   *  handed new props sixty times a second. With it a pan is a transform and
   *  nothing else until the view has really moved somewhere new, which is what
   *  keeps a plane of five hundred cards at sixty frames a second. */
  const QUANTUM = 400

  /** How long a pointer has to be still before it means something else: the menu
   *  under a finger, a tidied shape under a pen. */
  const HELD = 480

  /** A card that is not being dragged, so the each block below hands over the
   *  same object every frame rather than a fresh zero. */
  const STILL: Point = { x: 0, y: 0 }

  /** How much room the bar over a selection needs, in pixels: enough that it never
   *  hangs off an edge of the pane. */
  const ROOM = 72

  let host = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  // Raw: the machine is replaced whole by every event and never changed in
  // place, so there is nothing for a proxy to watch and a great deal for it to
  // wrap. See the note on the canvas in store.svelte.ts.
  let machine = $state.raw<Machine>(start())
  /** What the six presets are in this theme, for the ink layer, which paints on
   *  a 2d context and cannot read a custom property. */
  let palette = $state.raw<Record<string, string>>({})
  /** Whether the plane has been put in view yet; see `measure`. */
  let placed = false
  /** Where the pointer last was on the plane, so a paste and a new card land
   *  where the reader is looking. */
  let at: Point = { x: 0, y: 0 }
  /** Where the pointer is, for the other devices in the room. The same point as
   *  `at`, said as state, because what the other devices are shown is drawn from it
   *  while `at` is read by a paste rather than followed. Null once it has left. */
  let pointing = $state.raw<Point | null>(null)
  /** Everything but what is picked, faded back. What "narrow to selection" does:
   *  the rest of the plane is still there, it is just not what this is about. */
  let narrowed = $state(false)
  let finding = $state(false)

  const camera = $derived(store.camera)
  /** One screen pixel in plane units. The chrome is sized in these, so it comes
   *  out the same size on screen at every zoom. */
  const unit = $derived(1 / camera.scale)

  /** Where plane 0,0 sits on screen. The plane's transform and the pattern's offset
   *  are both this. */
  const originX = $derived(width / 2 - camera.x * camera.scale)
  const originY = $derived(height / 2 - camera.y * camera.scale)

  /** How long the points take to leave, and to come back. Fixed, and the whole of
   *  what the fade depends on: crossing a threshold starts it, and where the zoom is
   *  has nothing further to say. */
  const THINNING = 210

  /** Where the background pattern stands, between levels; see canvas/lattice.ts.
   *
   *  Not reactive, because it is stepped on a frame and read by the frame after: what
   *  the render follows is the one number it has reached. */
  let crossing = untrack(() => settled(latticeLevel(camera.scale)))
  let stands = $state(crossing.at)
  let thinning = 0
  let thinnedAt = 0

  /** The one or two tiles that draws, coarsest first. */
  const patterns = $derived(latticeLayers(stands, camera.scale))

  // A zoom that crosses a threshold starts a fade, or turns the one already running
  // round. A zoom that crosses nothing - which is nearly every zoom - leaves the
  // pattern alone, and leaves a fade already in flight to finish on its own time.
  $effect(() => {
    const want = latticeLevel(camera.scale, crossing.to)
    if (want === crossing.to) return

    crossing = aimed(crossing, want)

    // Asked for as little movement as possible: the pattern is simply the level the
    // zoom asks for, and there is no frame to ask for at all.
    if (!dur(THINNING)) {
      crossing = settled(want)
      stands = crossing.at
      return
    }

    const frame = (now: number) => {
      // A guess for the first frame, since no time has passed since the threshold
      // was crossed. Never capped: a frame the surface spent painting is a frame the
      // fade spent fading, or a stall would leave it hanging half done.
      const dt = thinnedAt ? now - thinnedAt : 16
      thinnedAt = now

      crossing = stepped(crossing, dt, dur(THINNING))
      stands = crossing.at
      thinning = fading(crossing) ? requestAnimationFrame(frame) : 0
    }

    // The loop is left running across a retarget: the fade is going somewhere, and
    // starting it again from this frame would stutter what is already moving.
    if (thinning) return

    thinnedAt = 0
    thinning = requestAnimationFrame(frame)
  })

  // The frame loop outlives a re-run of the effect above, so it is stopped here
  // instead: once, when the surface goes.
  $effect(() => () => cancelAnimationFrame(thinning))

  const gesture = $derived(machine.gesture)
  const drag = $derived(gesture?.kind === 'drag' ? gesture : null)
  const sizing = $derived(gesture?.kind === 'resize' ? gesture : null)
  const inking = $derived(gesture?.kind === 'ink' ? gesture : null)
  const pulling = $derived(gesture?.kind === 'pull' ? gesture : null)
  const rewiring = $derived(gesture?.kind === 'reconnect' ? gesture : null)

  /** Everything a snap could line the moving thing up with: what is on the plane
   *  and not going with it. */
  function bystanders(ids: readonly string[]) {
    const moving = new Set(ids)
    return store.canvas.nodes.filter((node) => !moving.has(node.id)).map(boxOf)
  }

  /** How far a drag has really gone, once the grid and the neighbours have had
   *  their say, and the lines that say why. */
  const dragSnap = $derived.by(() => {
    if (!drag) return NO_SNAP

    const box = pickedBox(store.canvas, drag.ids)
    if (!box) return NO_SNAP

    const snap = snapMove(
      { ...box, x: box.x + drag.dx, y: box.y + drag.dy },
      bystanders(drag.ids),
      GRID / 2,
    )

    return { dx: drag.dx + snap.dx, dy: drag.dy + snap.dy, guides: snap.guides }
  })

  const sizeSnap = $derived.by(() => {
    if (!sizing) return NO_SNAP

    const box = pickedBox(store.canvas, sizing.ids)
    if (!box) return NO_SNAP

    const now = {
      x: box.x + (sizing.handle.includes('w') ? sizing.dx : 0),
      y: box.y + (sizing.handle.includes('n') ? sizing.dy : 0),
      width: box.width + (sizing.handle.includes('e') ? sizing.dx : 0),
      height: box.height + (sizing.handle.includes('s') ? sizing.dy : 0),
    }

    // A resize that is holding the shape of the box has nothing to line up with:
    // obeying a guide on one axis would break the ratio the other one is keeping.
    if (sizing.aspect) return { dx: sizing.dx, dy: sizing.dy, guides: [] }

    const snap = snapResize(now, sizing.handle, bystanders(sizing.ids), GRID / 2)
    return { dx: sizing.dx + snap.dx, dy: sizing.dy + snap.dy, guides: snap.guides }
  })

  /** Whether the tool in hand is one of the three that becomes a connector when both
   *  of its ends land on a card. */
  const JOINS = new Set(['line', 'arrow', 'elbow'])

  /** The card and the anchor a connector being dragged out is about to attach to,
   *  while there is one. Shown, because a hand aiming a line at a card has to be told
   *  which side it will meet before it lets go. */
  const joining = $derived.by(() => {
    if (!pulling?.fromNode || !JOINS.has(pulling.tool)) return null

    const found = hitFor(pulling.to, false)
    if (!found.node || found.node === pulling.fromNode) return null

    const node = shown.nodes.find((one) => one.id === found.node)
    if (!node) return null

    const from = shown.nodes.find((one) => one.id === pulling.fromNode)
    const side = facingSide(boxOf(node), { ...pulling.from, width: 0, height: 0 })
    // Where the line will really leave the first card, so the dashed preview is the
    // connector it is about to become rather than a line from wherever the press
    // happened to land inside the card.
    const leaves = from
      ? sidePoint(boxOf(from), facingSide(boxOf(from), boxOf(node)))
      : pulling.from

    return { id: node.id, side, at: sidePoint(boxOf(node), side), leaves }
  })

  /** Where the far corner of something being pulled out has really got to, once the
   *  grid and the neighbours have had their say, and the lines that say why.
   *
   *  The same snap a drag gets, so a box dragged out beside a card comes out the
   *  width of the card and says so while it is being dragged rather than afterwards. */
  const pullSnap = $derived.by(() => {
    if (!pulling) return NO_SNAP
    // A line that is going to become a connector is aiming at a card's own anchor,
    // which is a stronger thing to land on than a grid step.
    if (joining) return NO_SNAP

    return snapPoint(pulling.to, store.canvas.nodes.map(boxOf), GRID / 2)
  })

  /** Where a pull actually reaches: the pointer, snapped, or the anchor of the card
   *  a connector is about to attach to. */
  const pullTo = $derived.by(() => {
    if (!pulling) return null
    if (joining) return joining.at

    return { x: pulling.to.x + pullSnap.dx, y: pulling.to.y + pullSnap.dy }
  })

  /** Where the end of a connector being moved has got to, and the card it will land
   *  on. Null while nothing is being moved. */
  const rewiredTo = $derived.by(() => {
    if (!rewiring) return null

    const found = hitFor(rewiring.to, false)
    const node = found.node ? shown.nodes.find((one) => one.id === found.node) : null
    if (!node) return { at: rewiring.to, onto: null }

    const other = shown.edges.find((one) => one.id === rewiring.edge)
    const far = other && (rewiring.end === 'from' ? other.toNode : other.fromNode)
    const anchor = shown.nodes.find((one) => one.id === far)
    const side = anchor ? facingSide(boxOf(node), boxOf(anchor)) : 'top'

    return { at: sidePoint(boxOf(node), side), onto: node.id }
  })

  /** How far the ink lasso has been dragged, scaled or turned so far. */
  let carriedInk = $state.raw<{
    dx: number
    dy: number
    scale: number
    turn: number
    about: Point
  }>({
    dx: 0,
    dy: 0,
    scale: 1,
    turn: 0,
    about: STILL,
  })

  /** The plane as it stands with the gesture applied but not committed.
   *
   *  The same pure functions the commit uses, so what is let go of is exactly
   *  what was on screen. Everything the gesture did not touch comes back as the
   *  very same object, so a drag of nine cards among five hundred redraws nine. */
  const shown = $derived.by((): Plane => {
    const base = store.canvas
    if (drag) return movedBy(base, drag.ids, dragSnap.dx, dragSnap.dy)
    if (sizing) {
      return resizedPick(base, sizing.ids, sizing.handle, sizeSnap.dx, sizeSnap.dy, sizing.aspect)
    }

    if (inking) {
      const moved = { ...carriedInk, sx: carriedInk.scale, sy: carriedInk.scale }
      const wanted = new Set(store.picked)
      return {
        ...base,
        ink: base.ink.map((stroke) =>
          wanted.has(stroke.id) ? transformed(stroke, moved) : stroke,
        ),
      }
    }

    return base
  })

  /** Where the view is, rounded. Numbers rather than a box, so that panning a
   *  few pixels does not count as a change at all; see QUANTUM. */
  const roughX = $derived(Math.round(camera.x / QUANTUM))
  const roughY = $derived(Math.round(camera.y / QUANTUM))
  /** The zoom in quarter octaves, so the set changes on a real change of scale
   *  rather than on every notch of a wheel. */
  const roughZoom = $derived(Math.round(Math.log2(camera.scale) * 4))

  /** The part of the plane worth drawing. */
  const inView = $derived.by(() => {
    const scale = 2 ** (roughZoom / 4)
    const across = width / scale + 2 * SLACK
    const down = height / scale + 2 * SLACK

    return {
      x: roughX * QUANTUM - across / 2,
      y: roughY * QUANTUM - down / 2,
      width: across,
      height: down,
    }
  })

  /** The cards on the page: what is in view, in the order the file holds them,
   *  which is the order they stack in. */
  const cards = $derived(shown.nodes.filter((node) => overlaps(boxOf(node), inView)))

  const picked = $derived(new Set(store.picked))

  /** Whether a resize holds the shape of the box without being asked: a picture under
   *  a thumb, where there is no Shift to hold and a stretched photograph is not the
   *  photograph. Shift says so as well, on every device; see pointer.ts. */
  const holdsShape = $derived(
    viewport.touch &&
      store.picked.length > 0 &&
      store.picked.every((id) => {
        const node = store.canvas.nodes.find((one) => one.id === id)
        return node?.type === 'file' && isPicture(node.file)
      }),
  )

  /** The box the handles are drawn on: everything picked, together. */
  const box = $derived(pickedBox(shown, store.picked))

  /** The ink on the plane by id. Off the canvas as it stands rather than off the
   *  preview: a gesture moves ink about and never renames it, so this is worked
   *  out when the drawing changes rather than on every pointer event. */
  const inked = $derived(new Set(store.canvas.ink.map((stroke) => stroke.id)))

  /** The one sentence a reader is given about the plane. The ink is drawn into a
   *  canvas element, which is a picture nothing can read, so what is said instead
   *  is what is on it; see the host element below. */
  const describes = $derived(
    t('Canvas: {cards} cards, {links} links, {drawings} drawings', {
      cards: store.canvas.nodes.length,
      links: store.canvas.edges.length,
      drawings: store.canvas.ink.length,
    }),
  )

  /** Whether what is picked is ink, which is what the turn handle belongs to. */
  const lassoed = $derived(store.picked.length > 0 && store.picked.every((id) => inked.has(id)))

  /** The card the four dots sit on: whatever is under the pointer, and nothing
   *  while a gesture is under way, a card is being written in, or the tool in
   *  hand is not the arrow. */
  const ported = $derived(
    gesture || store.editing !== null || tools.which !== 'select' ? null : machine.hovered,
  )

  const portedBox = $derived(shown.nodes.find((node) => node.id === ported) ?? null)

  /** The connector being drawn from a card's side, as a path. */
  const drawing = $derived.by(() => {
    if (gesture?.kind !== 'connect') return null

    const from = shown.nodes.find((node) => node.id === gesture.id)
    if (!from) return null

    return { from: sidePoint(boxOf(from), gesture.side), to: gesture.to, side: gesture.side }
  })

  const band = $derived(gesture?.kind === 'band' ? rectBetween(gesture.from, gesture.to) : null)
  const lasso = $derived(gesture?.kind === 'lasso' ? gesture.points : null)

  /** Where a pull begins: the press, or the anchor of the card a connector is about to
   *  leave. */
  const pullFrom = $derived(joining?.leaves ?? pulling?.from ?? null)

  /** The box something being pulled out of the bar will land in, snapped. */
  const pullBox = $derived(pullFrom && pullTo ? rectBetween(pullFrom, pullTo) : null)

  /** Which of the things a press puts down are drawn as a plain box while they are
   *  being pulled out. The rest are drawn as themselves; see pulledPath. */
  const PLAIN = new Set(['text', 'file', 'picture', 'link', 'group', 'rect', 'ellipse'])

  /** The shape being pulled out, as a path, through the same geometry the finished
   *  one is drawn from - so what is dragged out is exactly what lands. */
  function pulledPath(tool: string, from: Point, to: Point, box: Box): string {
    const line = isLineShape(tool as Shape)
    const points = shapePath({
      id: 'pulling',
      type: 'shape',
      shape: tool as Shape,
      ...box,
      ...(line && (to.y - from.y) * (to.x - from.x) < 0 ? { up: true } : {}),
    })

    const d = `M ${points.map((one) => `${Math.round(one.x)} ${Math.round(one.y)}`).join(' L ')}`
    return line ? d : `${d} Z`
  }

  /** How big the head on an arrow being dragged out is, in plane units. */
  const HEAD = 11

  /** The head on the end of an arrow being pulled out. An arrow without one is a line,
   *  and which of the two is being drawn is the whole question a preview answers. */
  const pullHead = $derived.by(() => {
    if (pulling?.tool !== 'arrow' || !pullFrom || !pullTo) return null

    const dx = pullTo.x - pullFrom.x
    const dy = pullTo.y - pullFrom.y
    const away = Math.hypot(dx, dy)
    if (away < 1) return null

    return {
      x: pullTo.x,
      y: pullTo.y,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      size: Math.min(HEAD, away / 3),
    }
  })

  /** The two ends of every picked connector, which is what an end is dragged by.
   *  Nothing at all while a gesture is under way: the handles are what start one. */
  const edgeHandles = $derived.by(() => {
    if (gesture) return []

    const out: { key: string; at: Point }[] = []
    for (const edge of shown.edges) {
      if (!store.isPicked(edge.id)) continue

      const from = shown.nodes.find((one) => one.id === edge.fromNode)
      const to = shown.nodes.find((one) => one.id === edge.toNode)
      if (!from || !to) continue

      const ends = edgeEnds(edge, boxOf(from), boxOf(to))
      out.push({ key: `${edge.id}:from`, at: ends.from }, { key: `${edge.id}:to`, at: ends.to })
    }

    return out
  })

  /** The stroke under the pen, with at most one step of the browser's guess at where
   *  the nib is going drawn on the end of it.
   *
   *  Held to one step and to the direction the hand is already going; see leadPoint
   *  in ink.ts. Drawn and never kept: it is there so the ink reaches the nib, and it
   *  is wrong by the next event. */
  let predicted = $state.raw<InkPoint[]>([])

  const live = $derived.by(() => {
    if (gesture?.kind !== 'draw') return null

    return {
      id: 'live',
      tool: gesture.stroke.tool,
      color: gesture.stroke.color,
      size: gesture.stroke.size,
      points: [...gesture.stroke.points, ...predicted],
    }
  })

  const guides = $derived(
    dragSnap.guides.length
      ? dragSnap.guides
      : sizeSnap.guides.length
        ? sizeSnap.guides
        : pullSnap.guides,
  )

  /** Where in its own tile the grid sits, which is all a repeating pattern needs
   *  to be moved by. Always positive, unlike the remainder operator. */
  function modulo(value: number, by: number): number {
    return by > 0 ? ((value % by) + by) % by : 0
  }

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // Words that changed under the surface: a version restored, a copy a sync
  // brought over, the file undo putting one back. A plane that had nothing on it
  // is framed the moment something arrives that way.
  $effect(() => {
    follows(tab.note.revision)
    if (store.follow() && !store.framed && width && height) store.fit(width, height)
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => measure(element))
    watcher.observe(element)
    measure(element)
    palette = readPalette(element)

    return () => watcher.disconnect()
  })

  // The theme's own colours, again, whenever the theme changes. The ink layer
  // paints on a 2d context, which has never heard of a custom property.
  $effect(() => {
    const element = host
    if (!element || typeof MutationObserver === 'undefined') return

    const watcher = new MutationObserver(() => (palette = readPalette(element)))
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })

    return () => watcher.disconnect()
  })

  // A space somebody shared to read holds planes to look at. The surface refuses
  // the edit rather than the gesture, so one rule covers every gesture there is;
  // see store.svelte.ts. The pane does the same for a note's editor.
  $effect(() => {
    store.readOnly = !canWriteIn(tab.note)
  })

  // This plane is one several devices may be drawing on, so the surface offers
  // itself to the room its file is in and takes it back when the tab goes. The
  // rooms store joins the two whichever of them arrives second.
  $effect(() => {
    rooms.drawing(tab.note.key, store)
    return () => {
      store.part()
      rooms.drawing(tab.note.key, null)
    }
  })

  // Where this hand is and what it is drawing, on its way to the other devices.
  // Read for their own sake: what travels is the pointer and the stroke under it.
  $effect(() => {
    const shared = store.shared
    if (!shared) return

    shared.hand(pointing, live)
  })

  // The pane being worked in takes the keyboard, so Delete and Ctrl+Z reach the
  // plane the way they reach an editor. Never while a card is being written in:
  // the keys are that card's.
  $effect(() => {
    if (focused && store.editing === null && !finding) host?.focus({ preventScroll: true })
  })

  // Zooming has to stop the page doing anything else with the scroll, and a
  // handler that says so cannot be a passive one.
  $effect(() => {
    const element = host
    if (!element) return

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  function measure(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    width = Math.round(rect.width)
    height = Math.round(rect.height)

    // A canvas opens with everything on it in view, and only then: the view is
    // the reader's from the first frame on, and a window being resized is no
    // reason at all to move the plane out from under them.
    if (placed) return
    placed = true

    // Unless the reader already has a view of their own. A canvas surface is torn
    // down and built again when its tab is switched away from and back, and when the
    // note is opened again, and the camera is kept across all of those - on the tab
    // for a switch, on this device for a reopen - so a plane that is already framed is
    // left exactly where the reading was. Fitting it here is what used to lose the
    // place on a switch back. See `framed`, and canvas/place.ts.
    if (!store.framed) store.fit(width, height)
  }

  function planeAt(event: { clientX: number; clientY: number }): Point {
    const element = host
    if (!element) return { x: 0, y: 0 }

    const rect = element.getBoundingClientRect()
    return graphPoint(camera, width, height, event.clientX - rect.left, event.clientY - rect.top)
  }

  function screenAt(event: { clientX: number; clientY: number }): Point {
    const rect = host?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  /** What the point is on, in the shape the machine wants it. */
  function hitFor(point: Point, coarse: boolean): Hit {
    return hitAt(
      {
        canvas: shown,
        picked: store.picked,
        box,
        scale: camera.scale,
        ported,
        coarse,
        lassoed,
      },
      point,
    )
  }

  /** A pen sample, in plane units, with everything the digitiser said about it.
   *
   *  What the pen said about itself goes through one normalisation on the way in, so
   *  a Pencil that reports its lean as an altitude and an azimuth, an S Pen that
   *  reports it as two tilts, and a USI pen that reports no pressure worth having all
   *  arrive as the same six numbers; see penFelt in canvas/ink.ts. */
  function sampleOf(event: PointerEvent, began: number): InkPoint {
    const point = planeAt(event)
    return {
      x: point.x,
      y: point.y,
      ...penFelt(event, stylus.traits),
      t: Math.max(0, Math.round(event.timeStamp - began)),
    }
  }

  /** When the stroke in hand began, so its samples carry small numbers. */
  let began = 0
  /** The timer a still pointer is running down, and where it went still. */
  let holding = 0
  let held: Point = { x: 0, y: 0 }

  /** How far a pointer may drift and still count as held, in pixels. */
  const A_TWITCH = 6

  function waitForHold(point: Point) {
    window.clearTimeout(holding)
    held = point
    holding = window.setTimeout(() => send({ kind: 'held', at: point }), HELD)
  }

  function stopHolding() {
    window.clearTimeout(holding)
    holding = 0
  }

  // A surface that has gone has no pointer being held on it: the timer would come
  // round after the tab closed and ask a plane nobody is looking at for a menu. The
  // same goes for a cancelled contact still being doubted.
  $effect(() => () => {
    stopHolding()
    stopDoubting()
  })

  /** Swallows the click that ends the very press that opened the menu.
   *
   *  A finger held down opens the menu while it is still on the glass, and the
   *  click it leaves behind on the way up is what everything else in the app
   *  uses to close a menu. Without this the menu would open and shut in the same
   *  gesture, which reads as nothing happening at all. */
  function swallowTheNextClick() {
    const stop = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
    }

    window.addEventListener('click', stop, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 900)
  }

  /** One event through the machine, and its effects carried out.
   *
   *  The plane as it stands is read before the machine moves on, because an
   *  effect that ends a gesture is the gesture's own last word: what is committed
   *  is what was on screen the instant before the pointer came up. */
  /** Which gesture is under way, counted. The eraser edits on every point of its
   *  drag, and the count is what tells the store that all of them are one thing
   *  somebody did; see `edit` in store.svelte.ts. */
  let gestures = 0
  /** The gesture a copy was left behind for, while one is being dragged off it, so
   *  the copy and the move are one step to take back. */
  let cloning: string | null = null

  /** What the surface has to say for something to be put on the plane: the colour
   *  the next one gets, and where this canvas lives, which is what a picture is
   *  stored beside. */
  function putting() {
    return { colour: tools.colour, path: tab.path }
  }

  function send(input: Input) {
    const preview = shown
    // Where a pull had really got to when the pointer came up, snapped and anchored,
    // read before the machine moves on: what lands is what was on screen.
    const aiming = pullTo
    const beginning = machine.gesture === null
    const next = step(machine, input, {
      tool: tools.which,
      picked: store.picked,
      editing: store.editing,
      scale: camera.scale,
      inkBox: box,
      pen: tools.ink,
      eraser: pens.eraser,
      lassoBox: pens.box,
      aspect: holdsShape,
      straighten: pens.straighten,
      penSeen: hand.penSeen,
      fingerDraws: hand.fingerDraws,
    })

    if (beginning && next.machine.gesture) gestures += 1

    machine = next.machine
    for (const effect of next.effects) apply(effect, preview, aiming)
  }

  function apply(effect: Effect, preview: Plane, aiming: Point | null) {
    switch (effect.do) {
      case 'pick':
        if (effect.ids.length === 1 && effect.ids[0]) store.pick(effect.ids[0], effect.adding)
        else store.pickAll(effect.ids, effect.adding)
        break
      case 'band':
        // What the box covers, worked out here because the machine has no plane
        // to ask. `was` is what was picked before the band began, so a band held
        // with the "as well as" key adds to it and a plain one replaces it.
        store.pickAll([
          ...effect.was,
          ...caught(preview.nodes, rectBetween(effect.from, effect.to)),
        ])
        break
      case 'clear':
        store.clearPicked()
        break
      case 'leave':
        if (store.editing !== null) store.editing = null
        break
      case 'edit':
        store.editing = effect.id
        break
      case 'move':
      case 'resize':
        // The preview is the answer: it is what was drawn, snapped and all. A drag
        // that left a copy behind names that copy's gesture, so the two are one
        // thing to take back.
        store.edit(preview, cloning ?? undefined)
        cloning = null
        break
      case 'ink': {
        carriedInk = {
          dx: effect.dx,
          dy: effect.dy,
          scale: effect.scale,
          turn: effect.turn,
          about: effect.about,
        }
        break
      }
      case 'connect':
        run.connect(store, effect.from, effect.fromSide, effect.to, effect.toSide, effect.head)
        tools.done()
        break
      case 'reconnect':
        run.reattach(store, effect.edge, effect.end, effect.to)
        break
      case 'clone':
        // The copy and the drag that follows it name the same gesture, so one press
        // of undo puts both back; see `edit` in store.svelte.ts.
        run.leaveCopy(store, `drag:${gestures}`)
        cloning = `drag:${gestures}`
        break
      case 'pull':
        // What was on screen while it was dragged, committed: the snap has already
        // been applied to `to`, so what lands is what was drawn.
        void pull(store, effect.tool, effect.from, aiming ?? effect.to, putting())
        tools.done()
        break
      case 'place':
        void place(store, effect.tool, effect.at, putting())
        tools.done()
        break
      case 'stroke':
        run.stroke(store, effect.stroke)
        predicted = []
        break
      case 'rub':
        run.rub(store, effect.ids, `rub:${gestures}`)
        break
      case 'cut':
        run.cut(store, effect.at, effect.reach, `rub:${gestures}`)
        break
      case 'catch':
        run.lasso(store, effect.lasso, pens.partly)
        break
      case 'pan':
        store.camera = {
          ...camera,
          x: camera.x - effect.dx / camera.scale,
          y: camera.y - effect.dy / camera.scale,
        }
        break
      case 'zoom':
        store.camera = zoomed(camera, width, height, effect.at.x, effect.at.y, effect.by)
        break
      case 'menu':
        // Only a hold leaves a click behind; the right button does not.
        if (holding) swallowTheNextClick()
        stopHolding()
        showMenu(effect.at)
        break
      case 'assist':
        assistShape()
        break
    }
  }

  /** A stroke held still at the end becomes what it was aiming at: a line, a
   *  ring or a box. The pen is still down, so what changes is the stroke in
   *  hand and nothing on the plane yet. */
  function assistShape() {
    const one = machine.gesture
    if (one?.kind !== 'draw') return

    const stroke = { id: 'live', ...one.stroke }
    const shape = assisted(stroke)
    if (!shape) return

    machine = {
      ...machine,
      gesture: { ...one, stroke: { ...one.stroke, points: tidyShape(stroke, shape).points } },
    }
    predicted = []
  }

  /** What kind of pointer this event really is, and whether it is rubbing out.
   *
   *  Three shapes of the same fact, all of them the same S Pen button; the rules and
   *  the reasons are in canvas/contacts.ts, where they are a test rather than a
   *  tablet. */
  function kindOf(event: PointerEvent) {
    return penKind(event, { penSeen: hand.penSeen, touch: viewport.touch })
  }

  /** What each pointer said about itself when it landed; see canvas/contacts.ts.
   *  Nothing on the page is drawn from it, so it is not state. */
  const contacts = new Contacts()

  /** Which of the pens out there this device has, and what the surface does
   *  differently for it; see canvas/contacts.ts. Read from the machine once, and
   *  settled the rest of the way by the first pen that touches the glass. */
  const stylus = new Stylus({
    agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    touch: typeof navigator === 'undefined' ? false : navigator.maxTouchPoints > 0,
    // Feature-detected rather than assumed: Safari has neither, and a stroke that
    // needed either of them would be a stroke that only draws properly on Chromium.
    coalesced: typeof PointerEvent === 'function' && 'getCoalescedEvents' in PointerEvent.prototype,
    predicted: typeof PointerEvent === 'function' && 'getPredictedEvents' in PointerEvent.prototype,
  })

  /** The last few pointer events, for a hidden element a drive and a person on a
   *  tablet can both read; see canvas/trace.ts. */
  const trace = new Trace()
  let traced = $state('')
  /** And what kind of pen the surface thinks it is holding, in the same element:
   *  everything the app decided about a device nobody here has, on one line. */
  let profile = $state(stylus.line)

  function note(what: string, event: PointerEvent) {
    if (stylus.saw(event)) profile = stylus.line

    if (
      trace.note({
        what,
        kind: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        id: event.pointerId,
      })
    ) {
      traced = trace.line
    }
  }

  /** Whether the last pointer on this glass was a pen, for the two events that
   *  carry no pointer of their own: the menu and a double press. */
  let lastPen = false

  /** A contact the browser took away that may not really be over.
   *
   *  Chrome on Android answers a stylus button with a context-menu gesture, and
   *  taking that gesture sends a `pointercancel` while the nib is still on the glass
   *  and still reporting. Ending the stroke there is what made the button "just not
   *  write any more". So a cancelled pen contact is given a moment: another event
   *  with the same id inside it means the contact never left, and only silence ends
   *  the gesture. */
  const GRACE = 160
  let doubting: { id: number; timer: number } | null = null

  function stopDoubting(id?: number) {
    if (!doubting || (id !== undefined && doubting.id !== id)) return

    window.clearTimeout(doubting.timer)
    doubting = null
  }

  /** The plane asking to be sent the rest of this contact wherever it goes.
   *
   *  Guarded, because it is allowed to fail: WebKit throws for a pointer it does not
   *  consider active, and a pen is exactly the pointer whose contact a browser can
   *  have taken away a frame before the surface asks. Not being sent the rest of a
   *  stroke is a stroke that ends at the edge of the pane; a stroke that ends in an
   *  exception is a plane that stops answering at all. */
  function capture(id: number) {
    try {
      host?.setPointerCapture(id)
    } catch {
      // Nothing to do and nothing to say: the events keep coming, they are simply
      // not promised to this element.
    }
  }

  function onPointerDown(event: PointerEvent) {
    const { kind, eraser } = kindOf(event)
    const pen = kind === 'pen'
    note('down', event)

    // The same nib arriving twice under two names, before anything is remembered
    // about it. Windows hands pen input to anything that does not ask for it as mouse
    // input, and a graphics tablet's driver will do it on any desktop if it is set up
    // to; a mouse contact while a nib is on the glass is that nib, and a second
    // contact would be a second gesture.
    if (contacts.echo(event)) return

    // Before the button below: a mouse pressing its right button is a mouse asking
    // for the menu, and it has to say so even when a pen was the last thing on the
    // glass.
    lastPen = pen

    // The right button on a mouse starts nothing; the menu is the browser's own
    // event. A pen holding its button is not a right button at all, it is the
    // eraser, and it has to reach the machine to be one.
    if (event.button === 2 && !pen) return

    const point = planeAt(event)
    at = point
    began = event.timeStamp

    const coarse = kind === 'touch'
    contacts.came(event.pointerId, { pen, eraser })

    // A pen on this glass is remembered for good: from now on the finger moves
    // the plane about rather than drawing on it. See canvas/hand.svelte.ts.
    if (pen) hand.sawPen()
    capture(event.pointerId)

    send({
      kind: 'down',
      id: event.pointerId,
      pointer: kind,
      at: point,
      screen: screenAt(event),
      time: event.timeStamp,
      button: event.button,
      shift: event.shiftKey,
      adds: event.ctrlKey || event.metaKey,
      alt: event.altKey,
      eraser,
      sample: sampleOf(event, began),
      hit: hitFor(point, coarse),
    })

    // Only a finger asks for the menu by staying still, and only while the pen is
    // off the glass: a hand resting beside a nib is not asking for anything.
    if (coarse && !machine.penDown) waitForHold(point)
  }

  /** A contact that has just turned out to be a pen, or a pen whose button was not
   *  down yet when it landed. Answered before the move itself, so the stroke begins
   *  where the nib touched down rather than where it has got to. */
  function repairPen(event: PointerEvent, point: Point) {
    const now = kindOf(event)
    const turned = contacts.turned(event.pointerId, {
      pen: now.kind === 'pen',
      eraser: now.eraser,
    })
    if (!turned) return

    lastPen = true
    if (turned.first) hand.sawPen()
    // A nib that has landed is not a finger waiting for a menu.
    stopHolding()
    began = event.timeStamp

    send({
      kind: 'penned',
      id: event.pointerId,
      at: point,
      sample: sampleOf(event, began),
      eraser: turned.eraser,
      hit: hitFor(point, false),
    })
  }

  function onPointerMove(event: PointerEvent) {
    note('move', event)

    /** Whether this is the pointer over the glass rather than on it: a hovering pen,
     *  or a mouse being moved with nothing held.
     *
     *  It is the whole of what makes a pen that hovers safe. Every pen on this list
     *  reports where it is on the way to the glass and again on the way off it - an
     *  Apple Pencil over an M2 iPad, a Surface Pen approaching the screen, a Wacom
     *  nib crossing the tablet - and a hovering pen that is allowed to lay down ink
     *  draws a line from wherever it was last seen to wherever it turns up next.
     *
     *  A contact the surface is not holding at all is the same thing: a pointer whose
     *  press it never heard has nothing on the plane to add to. */
    const floating = hovering(event) || !contacts.has(event.pointerId)

    // A contact the browser cancelled that is still reporting never really left; see
    // GRACE above. Only while the nib is still down: a hover after the cancel is the
    // pen off the glass, which is the one thing that must not keep the stroke alive.
    if (!floating) stopDoubting(event.pointerId)

    const point = planeAt(event)
    at = point
    if (store.shared) pointing = point
    const kind = kindOf(event).kind
    const coarse = kind === 'touch'
    // The last thing on the glass, so the two events that carry no pointer of their
    // own - the menu and a double press - know what it was. A pen that is only
    // hovering counts: Windows answers a barrel button held over the glass with a
    // context menu, and no menu belongs under a nib.
    lastPen = kind === 'pen'

    // Every sample since the last event, not just the one that was delivered: a
    // fast stroke is drawn through all of them rather than through a fifth of
    // them. Guarded, because the call is only there in a secure context and Safari
    // has never had it at all; the stroke is drawn as a curve through whatever
    // arrives, so a browser without it draws the same line. See smoothed in ink.ts.
    const samples =
      machine.gesture?.kind === 'draw' && !floating
        ? (typeof event.getCoalescedEvents === 'function'
            ? event.getCoalescedEvents()
            : [event]
          ).map((one) => sampleOf(one, began))
        : []

    if (machine.gesture?.kind === 'draw' && !floating) {
      const guessed =
        typeof event.getPredictedEvents === 'function'
          ? event.getPredictedEvents().map((one) => sampleOf(one, began))
          : []
      // At most one step, and only along the way the hand is already going: a fan of
      // guesses drawn whole is the flick past the nib that a turn used to leave
      // behind. See leadPoint in ink.ts. The last two points the pen really
      // reported, taken without walking the stroke: a long line is thousands of
      // points and this runs on every event.
      const laid = machine.gesture.stroke.points
      const nib = samples[samples.length - 1] ?? laid[laid.length - 1]
      const before =
        samples.length > 1
          ? samples[samples.length - 2]
          : laid[laid.length - (samples.length ? 1 : 2)]

      predicted = leadPoint(before, nib, guessed)
    }

    // After the samples above and before the move below: a stroke this event
    // begins takes its first point from here and not from the samples as well, and
    // the move that follows carries on from it. Never for a pen over the glass: a
    // hover has no contact to have been mistaken about.
    if (!floating) repairPen(event, point)

    // A pointer that is moving is not a pointer being held. Measured from where
    // it went still rather than from where it last was, which is this point.
    if (holding && Math.hypot(point.x - held.x, point.y - held.y) * camera.scale > A_TWITCH) {
      stopHolding()
    }

    // Asked for only when it is going to be read. Panning a plane of five
    // thousand strokes does not need to know what is under the pointer, and
    // asking sixty times a second is what a plane that big cannot afford.
    const wants =
      !machine.gesture || machine.gesture.kind === 'erase' || machine.gesture.kind === 'pull'
    const found = wants ? hitFor(point, coarse) : NOTHING

    // What the pointer wears, which is what is under it while nothing is being
    // dragged; see canvas/cursor.ts. Only while there is no gesture, so a drag keeps
    // the cursor it started with.
    if (!machine.gesture) over = overOf(found)
    // And where the eraser's own ring goes, for the hands that have no cursor.
    rubAt = machine.gesture?.kind === 'erase' ? point : null

    send({
      kind: 'move',
      id: event.pointerId,
      at: point,
      screen: screenAt(event),
      samples,
      hit: found,
    })

    // A pen that has stopped moving is a pen asking for its shape to be tidied.
    if (machine.gesture?.kind === 'draw') waitForHold(point)
  }

  function onPointerUp(event: PointerEvent) {
    note('up', event)
    stopHolding()
    rubAt = null
    stopDoubting(event.pointerId)
    contacts.went(event.pointerId)
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)

    const point = planeAt(event)
    const wasInk = machine.gesture?.kind === 'ink'

    send({
      kind: 'up',
      id: event.pointerId,
      at: point,
      screen: screenAt(event),
      hit: hitFor(point, event.pointerType === 'touch'),
    })

    if (wasInk) {
      const moved = carriedInk
      carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
      if (moved.dx || moved.dy || moved.scale !== 1 || moved.turn) {
        const wanted = new Set(store.picked)
        const turned = turnedInk(store.canvas, store.picked, moved.turn, moved.about)
        store.edit({
          ...turned,
          ink: turned.ink.map((stroke) =>
            wanted.has(stroke.id)
              ? transformed(stroke, {
                  dx: moved.dx,
                  dy: moved.dy,
                  sx: moved.scale,
                  sy: moved.scale,
                  turn: 0,
                  about: moved.about,
                })
              : stroke,
          ),
        })
      }
    }
  }

  function onPointerCancel(event: PointerEvent) {
    note('cancel', event)
    stopHolding()
    rubAt = null

    // A pen taken away mid-stroke may not have gone anywhere: Chrome on Android
    // cancels the contact to start its own context-menu gesture when the stylus
    // button goes down, and the nib is still on the glass and still reporting. So the
    // gesture is doubted rather than ended, and only silence ends it. See GRACE.
    const pen = machine.driver?.kind === 'pen' && machine.driver.id === event.pointerId
    if (pen && machine.gesture) {
      stopDoubting()
      const id = event.pointerId
      doubting = {
        id,
        timer: window.setTimeout(() => {
          doubting = null
          contacts.went(id)
          predicted = []
          carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
          send({ kind: 'cancel', id })
        }, GRACE),
      }
      return
    }

    contacts.went(event.pointerId)
    predicted = []
    carriedInk = { dx: 0, dy: 0, scale: 1, turn: 0, about: STILL }
    send({ kind: 'cancel', id: event.pointerId })
  }

  function onWheel(event: WheelEvent) {
    const element = host
    if (!element) return

    event.preventDefault()
    const rect = element.getBoundingClientRect()

    // Ctrl and the wheel is zoom, which is also what a trackpad pinch arrives as.
    // The wheel on its own moves the plane, which is what a wheel does everywhere.
    if (event.ctrlKey || event.metaKey) {
      store.camera = zoomed(
        camera,
        width,
        height,
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-event.deltaY * 0.0035),
      )
      return
    }

    store.camera = {
      ...camera,
      x: camera.x + event.deltaX / camera.scale,
      y: camera.y + event.deltaY / camera.scale,
    }
  }

  /** A double click on the plane makes a card and opens it; on a card it opens
   *  the card, and on a frame or a connector it asks for the words it wears.
   *
   *  Only with the arrow in hand. A tap with a pen in hand is a dot and two of them
   *  are two dots, and Chromium sends a dblclick for a pen tapped twice in one
   *  place: that is how a press with the pen used to put a card on the plane. */
  function onDoubleClick(event: MouseEvent) {
    if (tools.which !== 'select') return

    const point = planeAt(event)
    void run.open(store, hitFor(point, false), point)
  }

  function showMenu(point: Point) {
    const found = hitFor(point, viewport.touch)
    if (found.node && !store.isPicked(found.node)) store.pick(found.node)
    if (found.edge && !store.isPicked(found.edge)) store.pick(found.edge)
    if (found.stroke && !store.isPicked(found.stroke)) store.pick(found.stroke)

    const rect = host?.getBoundingClientRect()
    const screen = {
      clientX: (rect?.left ?? 0) + (point.x - camera.x) * camera.scale + width / 2,
      clientY: (rect?.top ?? 0) + (point.y - camera.y) * camera.scale + height / 2,
    }

    menu.show(
      new MouseEvent('contextmenu', screen),
      canvasMenu(store, point, {
        path: tab.path,
        name: tab.name,
        palette,
        width,
        height,
        narrowed,
        onnarrow: () => {
          narrowed = !narrowed
          if (narrowed) store.frame(width, height)
        },
        onfind: () => (finding = true),
      }),
      { title: t('Canvas'), near: viewport.touch },
    )
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault()
    // A pen holding its button is rubbing out, and Android reports that button as
    // the right one: without this the menu opens under the nib halfway through the
    // rub. The menu belongs to the mouse and to a finger held still.
    //
    // On a touch screen that has had a pen on it, nothing opens the menu this way at
    // all: the browser fires it for the stylus button whatever the pointer said it
    // was, and there the menu is what a finger held still opens.
    if (lastPen || (hand.penSeen && viewport.touch)) return

    showMenu(planeAt(event))
  }

  /** Whether the key was typed into something that takes words. The find bar
   *  and a card's editor are inside the plane, so their keystrokes bubble up to
   *  it, and the plane's own keys are bare letters: without this, typing "green"
   *  into the search would put a group, a rectangle and an ellipse on the
   *  plane. */
  function typing(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false

    return (
      target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
  }

  function onKeyDown(event: KeyboardEvent) {
    if (typing(event.target)) return

    if (event.key === ' ' && store.editing === null) {
      // Held rather than pressed: space is a way of holding the plane, not a
      // command, so nothing happens until the pointer moves as well.
      event.preventDefault()
      send({ kind: 'space', down: true })
      return
    }

    if (event.key === 'Escape') {
      if (store.editing !== null) store.editing = null
      else if (narrowed) narrowed = false
      else if (tools.which !== 'select') tools.choose('select')
      else store.clearPicked()
      return
    }

    if (store.editing !== null) return

    if (
      run.keys(store, event, {
        width,
        height,
        path: tab.path,
        name: tab.name,
        palette,
        onfind: () => (finding = true),
      })
    ) {
      event.preventDefault()
      return
    }

    if (shortcuts.pressed('edit.select-all', event)) {
      event.preventDefault()
      store.pickAll([
        ...store.canvas.nodes.map((node) => node.id),
        ...store.canvas.ink.map((stroke) => stroke.id),
      ])
      return
    }

    if (shortcuts.pressed('edit.undo', event)) {
      event.preventDefault()
      store.undo()
      return
    }

    if (shortcuts.pressed('edit.redo', event) || shortcuts.pressed('edit.redo.alt', event)) {
      event.preventDefault()
      store.redo()
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === ' ' && !typing(event.target)) send({ kind: 'space', down: false })
  }

  /** What is picked, as a canvas of its own, so it pastes into another canvas
   *  here or in Obsidian. */
  function onCopy(event: ClipboardEvent) {
    if (store.editing !== null || !store.picked.length) return

    event.preventDefault()
    event.clipboardData?.setData('text/plain', writeCanvas(subset(store.canvas, store.picked)))
  }

  function onCut(event: ClipboardEvent) {
    if (store.editing !== null || !store.picked.length) return

    onCopy(event)
    run.remove(store)
  }

  /** Cards from another canvas, a picture, an address, or some words: a paste is
   *  read as whichever of the four it turns out to be. */
  function onPaste(event: ClipboardEvent) {
    if (store.editing !== null) return

    const picture = [...(event.clipboardData?.items ?? [])].find((one) =>
      one.type.startsWith('image/'),
    )

    if (picture) {
      const file = picture.getAsFile()
      if (file) {
        event.preventDefault()
        void run.dropImage(store, file, at, tab.path)
        return
      }
    }

    const text = event.clipboardData?.getData('text/plain').trim()
    if (!text) return

    // Markup that arrived from outside the app is not this person's own writing,
    // so the plane's cards stop running their HTML; see trust.ts.
    const types = [...(event.clipboardData?.types ?? [])]
    if (pastesMarkup(types, text)) tab.note.pasted = true

    event.preventDefault()
    run.paste(store, readCanvas(text), text, at)
  }

  /** A note or a picture dragged out of the file list, or a file from the
   *  system, becomes a card where it was dropped. */
  function onDrop(event: DragEvent) {
    const point = planeAt(event)
    const paths = draggedPaths(event.dataTransfer)

    if (paths.length) {
      event.preventDefault()
      run.dropPaths(store, paths, point)
      return
    }

    const files = [...(event.dataTransfer?.files ?? [])].filter((one) =>
      one.type.startsWith('image/'),
    )
    if (!files.length) return

    event.preventDefault()
    for (const [index, file] of files.entries()) {
      void run.dropImage(store, file, { x: point.x, y: point.y + index * GRID * 10 }, tab.path)
    }
  }

  /** The colour what is picked wears, which is the first one's: a selection of
   *  nine cards in three colours has no one colour, and the bar shows the colour of
   *  the thing the hand grabbed. */
  const pickedColour = $derived.by(() => {
    const first = store.picked[0]
    if (!first) return null

    const node = store.canvas.nodes.find((one) => one.id === first)
    return node?.color ?? store.canvas.edges.find((one) => one.id === first)?.color ?? null
  })

  function colourPicked(colour: string | null) {
    store.edit(coloured(store.canvas, store.picked, colour))
    // The colour a card was given is the colour the next one gets. The one thing
    // on the plane that carries over, because drawing five red boxes should not be
    // five trips to the same dot.
    if (colour !== null) tools.colour = colour
  }

  /** What the bar over a selection is put on. Whatever is picked has a box, except
   *  a connector, which is a line between two cards: the middle of the line it draws
   *  stands in for one, so a connector can be coloured and copied like everything
   *  else. */
  const pickedSpan = $derived.by(() => {
    if (box) return box

    const edge = shown.edges.find((one) => store.isPicked(one.id))
    const from = edge && shown.nodes.find((one) => one.id === edge.fromNode)
    const to = edge && shown.nodes.find((one) => one.id === edge.toNode)
    if (!edge || !from || !to) return null

    const at = edgeMiddle(edgeEnds(edge, boxOf(from), boxOf(to)))
    return { x: at.x, y: at.y, width: 0, height: 0 }
  })

  /** Where the bar over what is picked goes: the middle of the top edge of it, on
   *  screen, and under it instead when the selection is against the top of the pane.
   *  Nothing at all while a gesture is under way or a card is being written in: the
   *  hand is busy, and a bar under the pointer would be in the way of it. */
  const overPicked = $derived.by(() => {
    const box = pickedSpan
    if (!box || gesture || store.editing !== null || !store.picked.length) return null

    const middle = originX + (box.x + box.width / 2) * camera.scale
    const above = originY + box.y * camera.scale
    const under = originY + (box.y + box.height) * camera.scale
    const below = above < ROOM

    return {
      at: {
        x: Math.min(Math.max(middle, ROOM), Math.max(ROOM, width - ROOM)),
        y: below ? under : above,
      },
      below,
    }
  })

  /** What is under the pointer, as far as the cursor cares. Kept so the pointer can
   *  say what a press would do before it is pressed; see canvas/cursor.ts. */
  let over = $state.raw<Over>(null)

  /** Where the eraser is on the plane while it is rubbing, and nothing otherwise.
   *  Written only during a rub, so an ordinary pan costs nothing. */
  let rubAt = $state.raw<Point | null>(null)

  function overOf(found: Hit): Over {
    if (found.handle) return found.handle
    if (found.ink === 'turn') return 'turn'
    if (found.ink === 'inside') return 'thing'
    if (found.ink) return found.ink
    if (found.port || found.endpoint) return 'port'
    if (found.node || found.edge || found.stroke) return 'thing'

    return null
  }

  /** Which of the six shapes of cursor the tool in hand asks for. */
  const inHand = $derived.by(() => {
    const which = tools.which
    if (which === 'hand' || which === 'draw' || which === 'erase' || which === 'lasso') return which
    if (puts(which)) return 'put' as const

    return 'select' as const
  })

  /** What the pointer looks like: the whole of what the bar is holding and what is
   *  under it, said in one value the plane wears.
   *
   *  A touch screen has no cursor and is given none, which also spares it the two
   *  drawn ones: the eraser shows its ring on the plane there instead. */
  const cursor = $derived.by(() => {
    if (viewport.touch) return undefined

    return cursorFor({
      tool: inHand,
      busy: gesture !== null,
      holding: machine.spacing,
      over,
      nib: {
        // The nib is in plane units and the cursor is in pixels, so the dot is the
        // width the pen will really draw at this zoom.
        size: pens.current.size * camera.scale,
        colour: inkColour(pens.current.colour, palette),
      },
      rub: { size: pens.rub, whole: pens.whole },
    })
  })

  /** Where the eraser's ring is drawn on the plane, and how wide, for a finger and a
   *  pen: there is no cursor under either, so the ring that says what will be rubbed
   *  out is drawn on the page while it is rubbing. */
  const rubbing = $derived.by(() => {
    if (gesture?.kind !== 'erase' || gesture.whole || !rubAt) return null

    return { at: rubAt, reach: pens.rub / camera.scale }
  })

  /** Whether a frame is among what is picked, which is what makes the bar's own
   *  button say "ungroup" rather than "group". */
  const onFrame = $derived(
    store.picked.some((id) =>
      store.canvas.nodes.some((node) => node.id === id && node.type === 'group'),
    ),
  )

  /** Whether the plane is empty, which is the one moment the surface says anything
   *  at all in words. */
  const bare = $derived(
    !store.canvas.nodes.length && !store.canvas.edges.length && !store.canvas.ink.length,
  )

  /** One notch of the zoom buttons, about the middle of the view. */
  function zoomBy(by: number) {
    store.camera = zoomed(camera, width, height, width / 2, height / 2, by)
  }
</script>

<!-- Named by what is on it rather than by what it is: the plane said the one word
     "Canvas" about a surface that might hold forty cards or nothing at all.
     `role="application"` is what lets the plane keep its own keyboard - one letter
     per tool - and it is also what stops a reader browsing the cards, so the
     sentence above is the whole of what is said about them. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="canvas nib-host"
  class:narrowed
  style:cursor
  bind:this={host}
  role="application"
  aria-roledescription={t('Canvas')}
  aria-label={describes}
  tabindex="-1"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onpointerleave={() => (pointing = null)}
  ondblclick={onDoubleClick}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  oncopy={onCopy}
  oncut={onCut}
  onpaste={onPaste}
  oncontextmenu={onContextMenu}
  ondragover={(event) => {
    if (isTreeDrag(event.dataTransfer) || event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
    }
  }}
  ondrop={onDrop}
>
  <!-- The pattern, on a layer of its own that is one tile bigger than the view all
       round and moved by a transform. Moving a repeating background by its own
       position repaints the whole view on every frame of a pan; moving a layer
       is composited and costs nothing.

       Half a tile off, because a tile carries its point in the middle: that puts
       every level's points on plane 0,0 and its multiples, which is what makes a
       coarser level a subset of a finer one rather than a second pattern between
       its points. -->
  {#each patterns as level (level.every)}
    <div
      class="dots"
      style:--dot-step="{level.step}px"
      style:opacity={level.showing}
      style:left="{-level.step}px"
      style:top="{-level.step}px"
      style:width="{width + 2 * level.step}px"
      style:height="{height + 2 * level.step}px"
      style:transform="translate({modulo(originX - level.step / 2, level.step)}px, {modulo(
        originY - level.step / 2,
        level.step,
      )}px)"
    ></div>
  {/each}

  <div class="plane" style:transform="translate({originX}px, {originY}px) scale({camera.scale})">
    <CanvasEdges
      edges={shown.edges}
      nodes={shown.nodes}
      picked={store.picked}
      provisional={drawing}
    />

    {#each cards as node (node.id)}
      <CanvasNode
        {node}
        canvasPath={tab.path}
        trusted={trustsHtmlIn(tab.note)}
        root={workspace.activeSpace?.root ?? null}
        picked={picked.has(node.id)}
        dimmed={narrowed && !picked.has(node.id)}
        editing={store.editing === node.id}
        offset={STILL}
        ontext={(text: string) => store.edit(withText(store.canvas, node.id, text))}
        onleave={() => (store.editing = null)}
        onfollow={(jump: NoteJump) => void workspace.followLink(jump)}
      />
    {/each}

    <!-- The four dots a connector is drawn from, on whichever card the pointer is
         over. Sized in plane units so they are the same size on screen at any
         zoom. -->
    {#if portedBox}
      <!-- The card's box once rather than once a side: which side a dot is on does
           not change the card it is on, and this is worked out again on every frame
           the pointer is over one. -->
      {@const ported = boxOf(portedBox)}
      {#each SIDES as side (side)}
        {@const point = sidePoint(ported, side)}
        <div
          class="port"
          style:left="{point.x}px"
          style:top="{point.y}px"
          style:width="{PORT * unit}px"
          style:height="{PORT * unit}px"
        ></div>
      {/each}
    {/if}

    <!-- What is picked, and the handles that resize it. -->
    {#if box}
      <div
        class="frame"
        style:left="{box.x}px"
        style:top="{box.y}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
        style:border-width="{unit}px"
      ></div>

      {#each HANDLES as handle (handle.id)}
        <div
          class="handle"
          style:left="{box.x + ((handle.x + 1) / 2) * box.width}px"
          style:top="{box.y + ((handle.y + 1) / 2) * box.height}px"
          style:width="{HANDLE * unit}px"
          style:height="{HANDLE * unit}px"
        ></div>
      {/each}

      {#if lassoed}
        <div
          class="turn"
          style:left="{box.x + box.width / 2}px"
          style:top="{box.y - HANDLE * 3.4 * unit}px"
          style:width="{HANDLE * 2 * unit}px"
          style:height="{HANDLE * 2 * unit}px"
        ></div>
      {/if}
    {/if}

    {#if band}
      <div
        class="band"
        style:left="{band.x}px"
        style:top="{band.y}px"
        style:width="{band.width}px"
        style:height="{band.height}px"
      ></div>
    {/if}

    <!-- What is being pulled out of the bar, drawn the whole way. Every one of them:
         a card, a frame, a picture, a body and a line alike, so nothing on the bar is
         invisible until it is let go of. -->
    {#if pulling && pullBox && pullTo && pullFrom}
      {#if PLAIN.has(pulling.tool)}
        <div
          class="band pulling"
          class:round={pulling.tool === 'ellipse'}
          class:framed={pulling.tool === 'group'}
          style:left="{pullBox.x}px"
          style:top="{pullBox.y}px"
          style:width="{pullBox.width}px"
          style:height="{pullBox.height}px"
          style:border-width="{Math.max(1, unit)}px"
        ></div>
      {:else}
        <svg class="drawing" aria-hidden="true" width="1" height="1" style:overflow="visible">
          <path
            d={pulledPath(pulling.tool, pullFrom, pullTo, pullBox)}
            style:stroke-width="{2 * unit}px"
            style:stroke-dasharray="{6 * unit}
            {5 * unit}"
          />
          <!-- An arrow wears its head while it is being dragged out: an arrow with no
               head on it is a line, and which of the two this is is the whole question
               a preview answers. -->
          {#if pullHead}
            <path
              class="point"
              d="M 0 0 L {-pullHead.size} {-pullHead.size * 0.5} L {-pullHead.size} {pullHead.size *
                0.5} Z"
              transform="translate({pullHead.x} {pullHead.y}) rotate({pullHead.angle})"
            />
          {/if}
        </svg>
      {/if}
    {/if}

    <!-- The anchor a connector being dragged out will attach to. Shown before it is
         let go, because a hand aiming a line at a card is asking which side. -->
    {#if joining}
      <div
        class="port aiming"
        style:left="{joining.at.x}px"
        style:top="{joining.at.y}px"
        style:width="{PORT * 1.6 * unit}px"
        style:height="{PORT * 1.6 * unit}px"
      ></div>
    {/if}

    <!-- An end of a picked connector being moved, and where it will land. -->
    {#if rewiring && rewiredTo}
      <div
        class="port aiming"
        class:loose={rewiredTo.onto === null}
        style:left="{rewiredTo.at.x}px"
        style:top="{rewiredTo.at.y}px"
        style:width="{PORT * 1.6 * unit}px"
        style:height="{PORT * 1.6 * unit}px"
      ></div>
    {/if}

    <!-- The two ends of a picked connector, which are dragged onto another card. -->
    {#each edgeHandles as end (end.key)}
      <div
        class="handle round"
        style:left="{end.at.x}px"
        style:top="{end.at.y}px"
        style:width="{HANDLE * unit}px"
        style:height="{HANDLE * unit}px"
      ></div>
    {/each}

    <!-- The eraser's own ring, for the hands that have no cursor: it is drawn on the
         page under the finger or the nib, at the width it is about to rub. -->
    {#if rubbing}
      <div
        class="rubbing"
        style:left="{rubbing.at.x}px"
        style:top="{rubbing.at.y}px"
        style:width="{rubbing.reach * 2}px"
        style:height="{rubbing.reach * 2}px"
        style:border-width="{1.5 * unit}px"
      ></div>
    {/if}

    <!-- The lines that say what a drag lined itself up with. -->
    {#each guides as guide, index (index)}
      <div
        class="guide"
        class:down={guide.axis === 'y'}
        style:left="{guide.axis === 'x' ? guide.at : guide.from}px"
        style:top="{guide.axis === 'y' ? guide.at : guide.from}px"
        style:width="{guide.axis === 'x' ? unit : guide.to - guide.from}px"
        style:height="{guide.axis === 'y' ? unit : guide.to - guide.from}px"
      ></div>
    {/each}

    {#if lasso && lasso.length > 1}
      <svg class="lasso" aria-hidden="true" width="1" height="1" style:overflow="visible">
        <path
          d="M {lasso
            .map((point) => `${Math.round(point.x)} ${Math.round(point.y)}`)
            .join(' L ')} Z"
          style:stroke-width="{1.5 * unit}px"
          style:stroke-dasharray="{5 * unit}
          {4 * unit}"
        />
      </svg>
    {/if}

    <!-- The other hands on the plane, over everything on it. Inside the plane, so
         a pointer somebody else is moving stays where they are pointing. -->
    <CanvasHands hands={store.hands} {unit} {palette} />
  </div>

  <CanvasInk ink={shown.ink} {live} {camera} {width} {height} {picked} {palette} />

  <!-- What an empty plane says, and the only thing it ever says. It goes the moment
       anything is on the plane, and it is one line rather than a lesson. -->
  {#if bare}
    <p class="hint" transition:fade={{ duration: dur(190) }}>
      {viewport.touch ? t('Double-tap to write') : t('Double-click to write')}
    </p>
  {/if}

  <!-- One bar, on every device: the same buttons in the same order, drawn at the
       touch scale where a thumb has to land on them. -->
  <CanvasBar
    canundo={store.canUndo}
    canredo={store.canRedo}
    zoom={camera.scale}
    onundo={() => store.undo()}
    onredo={() => store.redo()}
    onerase={() => run.eraseAll(store)}
    onzoom={zoomBy}
    onfit={() => store.fit(width, height)}
  />

  <!-- And a small one over what is picked, where the hand already is. -->
  {#if overPicked}
    <CanvasPicked
      at={overPicked.at}
      below={overPicked.below}
      colour={pickedColour}
      recent={pens.recent}
      grouping={onFrame ? 'ungroup' : store.picked.length > 1 ? 'group' : null}
      oncolour={colourPicked}
      onduplicate={() => run.duplicate(store)}
      ondelete={() => run.remove(store)}
      ongroup={() => (onFrame ? run.ungroup(store) : run.group(store))}
      onmore={() => {
        if (pickedSpan) showMenu({ x: pickedSpan.x + pickedSpan.width / 2, y: pickedSpan.y })
      }}
    />
  {/if}

  <!-- What kind of pen the surface thinks this device has, and the last few pointer
       events. Never shown and never read by the app: a drive reads it, and a person
       on a tablet can be asked what it says when a button does something no desktop
       can reproduce. See canvas/contacts.ts and canvas/trace.ts. -->
  <span class="unseen" data-pointer aria-hidden="true">{profile} // {traced}</span>

  {#if finding}
    <CanvasFind
      canvas={store.canvas}
      onpick={(id: string) => {
        store.pick(id)
        store.frame(width, height)
      }}
      onclose={() => {
        finding = false
        host?.focus({ preventScroll: true })
      }}
    />
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
    /* The plane is the thing being touched, so a drag on it must not start a
       text selection or the browser's own panning.

       `touch-action` is also what stops the two gestures a platform puts on top of a
       pen: Windows reads a nib held still as a right click and shows its own ring
       while it waits, and iPadOS reads a finger held still as a selection. Both of
       them arrive as a delay before the page hears anything, and there is no other
       way to turn either off.

       The three prefixed lines are Safari's alone, and each of them is a thing that
       happens on an iPad and nowhere else: a drag with a finger selects the page, a
       press with a finger opens the callout over whatever is under it, and a tap
       flashes a grey box the size of the plane. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    cursor: default;
  }

  /* The pattern, drawn on the view rather than on the plane: a repeating background
     costs one paint however far the plane reaches, and this layer is moved by a
     transform rather than by its own background position, so panning it is a
     composite and never a repaint. One of these is up at any moment, and two for a
     fifth of a second while a level is leaving or coming back. */
  .dots {
    position: absolute;
    pointer-events: none;
    background-image: radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1.2px);
    background-size: var(--dot-step) var(--dot-step);
    will-change: transform;
  }

  /* No size of its own: everything in it is absolute at its own plane
     coordinates, and this one transform is how the whole plane moves. */
  .plane {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }

  /* Centred on the point they mark, so the arithmetic above is about a point
     rather than about a corner. */
  .port,
  .handle,
  .turn {
    position: absolute;
    box-sizing: border-box;
    translate: -50% -50%;
    z-index: 5;
  }

  .port {
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--accent);
    opacity: 0.75;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .port:hover {
    opacity: 1;
  }

  /* The anchor a line being dragged out will attach to: the same dot, filled, so it
     reads as the one that has been chosen rather than as one more that has not. */
  .port.aiming {
    background: var(--accent);
    opacity: 1;
    z-index: 6;
  }

  /* An end of a connector that is over nothing: still there, still where the pointer
     is, and plainly not attached to anything. */
  .port.aiming.loose {
    background: var(--surface);
    border-style: dashed;
  }

  .handle {
    border-radius: 2px;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }

  /* The ends of a connector, round, because they move rather than resize. */
  .handle.round {
    border-radius: 50%;
  }

  /* The eraser at its real width, on the page, for the hands that have no cursor to
     put it on: a finger and a nib. */
  .rubbing {
    position: absolute;
    box-sizing: border-box;
    translate: -50% -50%;
    border-radius: 50%;
    border-style: solid;
    border-color: var(--muted-strong);
    background: color-mix(in srgb, var(--surface) 35%, transparent);
    pointer-events: none;
    z-index: 6;
  }

  /* The ring that turns what is picked, above it and clear of every corner. */
  .turn {
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }

  /* The outline round everything picked. Drawn even for one card, so a
     selection of one and a selection of nine read as the same thing. */
  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent);
    border-radius: 3px;
    pointer-events: none;
    z-index: 5;
  }

  .band {
    position: absolute;
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 2px;
    pointer-events: none;
    z-index: 5;
  }

  /* What is being pulled out of the bar, while it is being pulled: the box it will
     land in, dashed, so a card, a frame and a rectangle are all visible before they
     exist. */
  .band.pulling {
    background: none;
    border-style: dashed;
  }

  .band.pulling.round {
    border-radius: 50%;
  }

  .band.pulling.framed {
    border-radius: var(--radius-lg);
  }

  /* A line, an arrow, an elbow, a diamond or a triangle being pulled out, drawn from
     the same geometry the finished one is drawn from. */
  .drawing {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 5;
  }

  .drawing path {
    fill: none;
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The head is solid: a dashed triangle is a puzzle rather than an arrow. */
  .drawing path.point {
    fill: var(--accent);
    stroke: none;
    stroke-dasharray: none;
  }

  /* The line that says what a drag lined itself up with: the accent, and only
     while the pointer is down. */
  .guide {
    position: absolute;
    background: var(--accent);
    opacity: 0.7;
    pointer-events: none;
    z-index: 5;
  }

  .lasso {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 5;
  }

  .lasso path {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }

  /* The one line an empty plane says. In the middle of the pane and quiet enough
     that it reads as a note to the reader rather than as something on the page. */
  .hint {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: 0;
    translate: -50% -50%;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    text-align: center;
    pointer-events: none;
    user-select: none;
  }

  :global([data-touch]) .hint {
    font-size: var(--touch-text);
  }

  /* Nowhere anybody can see, and out of the way of everything: a record kept for a
     device nobody here has. Not `display: none`, which some browsers will not read
     the text of. */
  .unseen {
    position: absolute;
    left: -9999px;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    pointer-events: none;
  }
</style>
