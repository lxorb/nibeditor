<script lang="ts">
  /** A page note: sheets of paper in a column, written on with the pen.
   *
   *  Everything here is the canvas's. The bar is `CanvasBar`, the ink is
   *  `CanvasInk` on its two 2d layers, a card is `CanvasNode`, another device's hand
   *  is `CanvasHands`, the pen in your hand is the same `pens` and the same `tools`,
   *  a stroke is built by the same `penFelt` and drawn by the same paint, and a
   *  palm is turned away by the same `Contacts`. There is one ink engine in this app
   *  and this is it, on paper. What this file adds is the paper: where the pages
   *  are, which one a press lands on, and how the view moves over them.
   *
   *  The view is the canvas's camera with two things taken away. A page note is
   *  read by scrolling, so the zoom starts at whatever fits the widest page across
   *  the pane and the pan is held to the column: you cannot lose your pages off the
   *  side of a note of pages, which is the one thing an endless plane lets you do.
   *  Zooming in frees the horizontal pan, because then there is something to the
   *  side to see.
   *
   *  Ink, cards and pictures all belong to a page. A press in a gutter does
   *  nothing: there is no paper there. A stroke that runs off the bottom of a page
   *  belongs to the page the pen went down on, which is what `onPage` answers for
   *  the surface, the export and the merge alike.
   *
   *  One transform for the whole column, as on a canvas: the pages are elements at
   *  their own coordinates, the ink is two canvases over them, and a scroll moves
   *  the transform rather than anything in it. */

  import { untrack } from 'svelte'
  import CanvasBar from './CanvasBar.svelte'
  import CanvasHands from './CanvasHands.svelte'
  import CanvasInk from './CanvasInk.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import PagesPage from './PagesPage.svelte'
  import { graphPoint } from './camera'
  import { toolPressed } from './canvas/actions'
  import { movedBy, removed, withText } from './canvas/edits'
  import { freshId, type InkPoint, type InkStroke } from './canvas/format'
  import { Contacts, hovering, penKind, Stylus } from './canvas/contacts'
  import { hand } from './canvas/hand.svelte'
  import { erased, leadPoint, penFelt, strokesInLasso, tidied } from './canvas/ink'
  import { readPalette } from './canvas/palette'
  import { pens } from './canvas/pens.svelte'
  import { inks, type Tool } from './canvas/pointer'
  import { tools } from './canvas/tools.svelte'
  import { type Point } from './canvas/geometry'
  import { pageAt } from '@nib/markdown/pages'
  import { forgetPaper } from './pages/paper'
  import { PagesStore } from './pages/store.svelte'
  import { t } from './i18n.svelte'
  import { rooms } from './rooms.svelte'
  import { canWriteIn, trustsHtmlIn } from './sharing.svelte'
  import { shortcuts } from './shortcuts.svelte'

  import { pages as pagesState } from './pages/showing.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace, type Tab } from './workspace.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  /** The note this tab is showing. Built once from the tab it was given, exactly as
   *  a canvas's surface is: the pane keys this component by tab. */
  const store = untrack(() => new PagesStore(tab))

  /** How far a pointer may drift and still count as a tap rather than a drag. */
  const A_TWITCH = 6

  /** The tools that put ink down, which are the ones a palm may not have. */
  const INKING: ReadonlySet<Tool> = new Set<Tool>(['draw', 'erase', 'lasso'])

  /** The tools a page note has. The five that mean something on paper; a connector and
   *  a frame are a plane's, and there is nothing on a sheet to join. */
  const PAPER_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['select', 'hand', 'draw', 'erase', 'lasso'])

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  let host = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  let palette = $state<Record<string, string>>({})

  const pages = $derived(store.pages)
  const canvas = $derived(store.canvas)
  const camera = $derived(store.camera)
  const showing = $derived(store.showing)

  /** One screen pixel in plane units, which is what a dot, a handle and a name are
   *  sized in so they are the same size on screen at every zoom. */
  const unit = $derived(1 / camera.scale)

  const writable = $derived(!store.readOnly)
  /** Whether the HTML in a card on these pages is markup rather than the characters
   *  it is made of. The same one question a canvas card asks, of the same note; see
   *  trust.ts. */
  const trusted = $derived(trustsHtmlIn(tab.note))

  /** The cards and pictures, which are everything on the plane that is not a page
   *  and not ink. Pages draw themselves; see PagesPage.svelte. */
  const cards = $derived(canvas.nodes.filter((node) => node.type !== 'page'))

  /** How big the pane is, which every sum about the view needs and only a component can
   *  measure. The paper stays fitted across it until the reader zooms: the sidebar
   *  opening must not push the page off the side of the pane. See `measured`. */
  $effect(() => {
    store.measured(width, height)
  })

  /** The status bar's counter and the outline panel's thumbnails are elsewhere in the
   *  window, so this surface says it is the one in front and they read the rest off its
   *  store. Once, on the way in and on the way out: the store is the same store all the
   *  way through, and saying so per scroll would be a write into state the bar has
   *  already read. See pages/showing.svelte.ts. */
  $effect(() => {
    pagesState.arrived(tab.note.key, store)
    return () => pagesState.gone(tab.note.key)
  })

  /** The view fitted across the widest page, once, the first time there is anything
   *  to fit. A page note opens at the top of its first page, which is where somebody
   *  left off writing or is about to start. */
  $effect(() => {
    if (store.framed || !width || !height || !store.widest) return

    store.fitWidth(false)
  })

  // Words that changed under the surface: a version restored, a copy a sync brought
  // over, the file undo putting one back. The same one line a canvas has.
  $effect(() => {
    follows(tab.note.revision)
    store.follow()
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => {
      width = element.clientWidth
      height = element.clientHeight
    })
    watcher.observe(element)
    width = element.clientWidth
    height = element.clientHeight
    palette = readPalette(element)

    return () => watcher.disconnect()
  })

  // The theme's own colours again whenever the theme changes: the ink layer paints
  // on a 2d context, which has never heard of a custom property.
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

  // A space somebody shared to read holds notes to look at, and the surface refuses
  // the edit rather than the gesture, which is one rule for every gesture there is.
  $effect(() => {
    store.readOnly = !canWriteIn(tab.note)
  })

  // Several devices may be writing on these pages, so the surface offers itself to
  // the room its file is in and takes it back when the tab goes. A page note's room
  // is a plane's room, and the same one; see rooms/kind.ts.
  $effect(() => {
    rooms.drawing(tab.note.key, store)
    return () => {
      store.part()
      rooms.drawing(tab.note.key, null)
    }
  })

  // Where this hand is and what it is drawing, on its way to the other devices.
  $effect(() => {
    store.shared?.hand(pointing, live)
  })

  // The papers these pages are pages of, let go of when the tab goes: a PDF open for a
  // note nobody is looking at is a worker and a pile of bitmaps that nothing will ever
  // ask for again. Read once, on the way out, so a page added or removed while the tab
  // is open does not tear the paper down under it.
  $effect(() => {
    const note = tab.note.path
    const root = workspace.activeSpace?.root ?? null

    return () => {
      for (const file of new Set(pages.map((page) => page.file).filter(Boolean))) {
        if (file) forgetPaper({ file, note, root })
      }
    }
  })

  // The pane being worked in takes the keyboard, so Delete and Ctrl+Z reach the
  // pages the way they reach an editor. Never while a card is being written in.
  $effect(() => {
    if (focused && store.editing === null) host?.focus({ preventScroll: true })
  })

  /** A point in the pane, in plane units. */
  function planeAt(event: { clientX: number; clientY: number }): Point {
    const box = host?.getBoundingClientRect()
    return graphPoint(
      camera,
      width,
      height,
      event.clientX - (box?.left ?? 0),
      event.clientY - (box?.top ?? 0),
    )
  }

  /** What each pointer said about itself when it landed, which is how a palm is
   *  turned away and how a nib arriving twice under two names is read as one; the
   *  reasons are in canvas/contacts.ts, where they are a test rather than something
   *  to try with a hand. The same object the canvas uses, and the same rules. */
  const contacts = new Contacts()

  /** What kind of pointer this really is, and whether it is rubbing out. The same
   *  one line the canvas asks, of the same glass. */
  function kindOf(event: PointerEvent) {
    return penKind(event, { penSeen: hand.penSeen, touch: viewport.touch })
  }

  /** What kind of pen this is, so pressure and lean are read the way this device
   *  reports them. */
  const stylus = new Stylus({
    agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    touch: viewport.touch,
    coalesced:
      typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype,
    predicted:
      typeof PointerEvent !== 'undefined' && 'getPredictedEvents' in PointerEvent.prototype,
  })

  /** The gesture under way, if any. Four, which is all a page of paper needs: a
   *  stroke, a rub, a lasso, and moving the paper about. */
  type Gesture =
    | { kind: 'draw'; id: number; page: string; stroke: InkStroke; began: number }
    | { kind: 'erase'; id: number; run: string }
    | { kind: 'lasso'; id: number; points: Point[] }
    | { kind: 'pan'; id: number; from: Point; at: Point }
    | { kind: 'drag'; id: number; from: Point; offset: Point; moved: boolean }

  let gesture = $state.raw<Gesture | null>(null)
  let predicted = $state.raw<InkPoint[]>([])
  let pointing = $state.raw<Point | null>(null)

  /** The stroke under the pen, with at most one step of the browser's guess at
   *  where the nib is going on the end of it; see leadPoint in canvas/ink.ts. */
  const live = $derived.by(() => {
    if (gesture?.kind !== 'draw') return null
    return { ...gesture.stroke, points: [...gesture.stroke.points, ...predicted] }
  })

  /** What is picked, dragged by however far the drag has carried it. */
  const dragging = $derived(gesture?.kind === 'drag' ? gesture.offset : { x: 0, y: 0 })

  /** A pen sample, in plane units, with everything the digitiser said about it. The
   *  same normalisation the canvas does, so an S Pen, a Pencil and a USI pen all
   *  arrive as the same six numbers. */
  function sampleOf(event: PointerEvent, began: number): InkPoint {
    const point = planeAt(event)
    return {
      x: point.x,
      y: point.y,
      ...penFelt(event, stylus.traits),
      t: Math.max(0, Math.round(event.timeStamp - began)),
    }
  }

  function onpointerdown(event: PointerEvent) {
    // The same nib arriving twice under two names: Windows hands pen input to
    // anything that does not ask for it as mouse input, and a mouse contact while a
    // nib is on the glass is that nib, not a second hand.
    if (contacts.echo(event)) return

    // The right button on a mouse starts nothing; the menu is the browser's own
    // event. A pen holding its button is the eraser and not a right button at all.
    const { kind, eraser } = kindOf(event)
    const pen = kind === 'pen'
    if (event.button === 2 && !pen) return

    contacts.came(event.pointerId, { pen, eraser })
    stylus.saw(event)
    // A pen on this glass is remembered for good: from now on the finger moves the
    // paper about rather than writing on it. See canvas/hand.svelte.ts.
    if (pen) hand.sawPen()

    // A finger that landed while a nib is down is the hand the page is being held
    // with. It does nothing at all - not even a pan, which would drag the paper out
    // from under the pen.
    if (kind === 'touch' && contacts.penned) return

    host?.setPointerCapture(event.pointerId)
    const point = planeAt(event)
    const page = pageAt(pages, point)

    // Whether this contact may lay ink down: the canvas's own rule, out of the
    // canvas's own machine, so a palm on paper and a palm on a plane are turned away
    // by the same line. See `inks` in canvas/pointer.ts.
    const drawing = inks(kind, { penSeen: hand.penSeen, fingerDraws: hand.fingerDraws })
    const asked = eraser ? 'erase' : tools.which
    const tool = drawing || !INKING.has(asked) ? asked : 'select'

    // A press in a gutter moves the paper: there is nothing there to write on, and
    // scrolling with a finger is what somebody is doing there.
    if (tool === 'hand' || !page) {
      gesture = { kind: 'pan', id: event.pointerId, from: point, at: point }
      return
    }

    if (!writable) return

    if (tool === 'draw') {
      const nib = tools.ink
      gesture = {
        kind: 'draw',
        id: event.pointerId,
        page: page.id,
        began: event.timeStamp,
        stroke: {
          id: freshId(),
          tool: nib.tool,
          color: nib.color,
          size: nib.size,
          opacity: nib.opacity,
          points: [sampleOf(event, event.timeStamp)],
        },
      }
      return
    }

    if (tool === 'erase') {
      gesture = { kind: 'erase', id: event.pointerId, run: freshId() }
      rub(point, gesture.run)
      return
    }

    if (tool === 'lasso') {
      gesture = { kind: 'lasso', id: event.pointerId, points: [point] }
      return
    }

    // The arrow. A press on something picks it and begins a drag; a press on bare
    // paper clears what was picked.
    const hit = cards.find(
      (node) =>
        point.x >= node.x &&
        point.x <= node.x + node.width &&
        point.y >= node.y &&
        point.y <= node.y + node.height,
    )

    if (!hit) {
      store.clearPicked()
      gesture = { kind: 'pan', id: event.pointerId, from: point, at: point }
      return
    }

    if (!store.isPicked(hit.id)) store.pick(hit.id, event.shiftKey || event.ctrlKey)
    gesture = {
      kind: 'drag',
      id: event.pointerId,
      from: point,
      offset: { x: 0, y: 0 },
      moved: false,
    }
  }

  function onpointermove(event: PointerEvent) {
    pointing = planeAt(event)

    const one = gesture
    if (one?.id !== event.pointerId) return

    // A pen lifted off the glass while the button was still reported down: the one
    // thing that must not keep a stroke alive.
    if (one.kind === 'draw' && (hovering(event) || !contacts.has(event.pointerId))) {
      finish()
      return
    }

    const point = planeAt(event)

    if (one.kind === 'pan') {
      store.camera = store.held({
        ...camera,
        x: camera.x - (point.x - one.from.x),
        y: camera.y - (point.y - one.from.y),
      })
      return
    }

    if (one.kind === 'draw') {
      // Every sample the browser held back, so a fast line is the line the hand
      // drew and not the four points that reached the page.
      const events = 'getCoalescedEvents' in event ? event.getCoalescedEvents() : []
      const samples = (events.length ? events : [event]).map((one) =>
        sampleOf(one, gesture?.kind === 'draw' ? gesture.began : event.timeStamp),
      )
      const points = [...one.stroke.points, ...samples]
      gesture = { ...one, stroke: { ...one.stroke, points } }

      const guessed =
        'getPredictedEvents' in event
          ? event
              .getPredictedEvents()
              .map((one) =>
                sampleOf(one, gesture?.kind === 'draw' ? gesture.began : event.timeStamp),
              )
          : []
      predicted = leadPoint(points[points.length - 2], points[points.length - 1], guessed)
      return
    }

    if (one.kind === 'erase') {
      rub(point, one.run)
      return
    }

    if (one.kind === 'lasso') {
      gesture = { ...one, points: [...one.points, point] }
      return
    }

    const offset = { x: point.x - one.from.x, y: point.y - one.from.y }
    const moved = one.moved || Math.hypot(offset.x, offset.y) * camera.scale > A_TWITCH
    gesture = { ...one, offset, moved }
  }

  function onpointerup(event: PointerEvent) {
    contacts.went(event.pointerId)
    if (gesture?.id === event.pointerId) finish()
  }

  function onpointercancel(event: PointerEvent) {
    contacts.went(event.pointerId)
    if (gesture?.id !== event.pointerId) return

    gesture = null
    predicted = []
  }

  /** The gesture, ended: one edit, or none. */
  function finish() {
    const one = gesture
    gesture = null
    predicted = []
    if (!one) return

    if (one.kind === 'draw') {
      // Tidied the way the canvas tidies a finished stroke: the samples simplified
      // to what the line actually is, which is what keeps a page of handwriting
      // kilobytes rather than megabytes.
      const stroke = tidied(one.stroke)
      if (stroke.points.length) store.edit({ ...canvas, ink: [...canvas.ink, stroke] })
      tools.done()
      return
    }

    if (one.kind === 'lasso') {
      store.pickAll(strokesInLasso(canvas.ink, one.points))
      return
    }

    if (one.kind === 'drag' && one.moved) {
      store.edit(movedBy(canvas, store.picked, one.offset.x, one.offset.y))
    }
  }

  /** One point of a rub: every stroke it touched, cut. The eraser answers under the
   *  nib, so this edits on every point of the drag and names the drag, which is how
   *  the whole rub is one undo step and one write; see store.svelte.ts. */
  function rub(at: Point, run: string) {
    const reach = pens.rub * unit
    let changed = false
    const ink: InkStroke[] = []

    for (const stroke of canvas.ink) {
      const left = erased(stroke, at, reach)
      if (left.length === 1 && left[0] === stroke) {
        ink.push(stroke)
        continue
      }

      changed = true
      ink.push(...left)
    }

    if (changed) store.edit({ ...canvas, ink }, run)
  }

  function onwheel(event: WheelEvent) {
    event.preventDefault()

    // Ctrl or the pinch a trackpad reports as one: the zoom. Everything else is a
    // scroll down the column, which is how a page note is read.
    if (event.ctrlKey || event.metaKey) {
      const box = host?.getBoundingClientRect()
      const x = event.clientX - (box?.left ?? 0)
      const y = event.clientY - (box?.top ?? 0)
      store.zoomAt({ x, y }, Math.exp(-event.deltaY / 400))
      return
    }

    store.camera = store.held({
      ...camera,
      x: camera.x + event.deltaX / camera.scale,
      y: camera.y + event.deltaY / camera.scale,
    })
  }

  function onkeydown(event: KeyboardEvent) {
    if (store.editing !== null) return

    // The bar teaches the keyboard, and it is one bar: the five tools that mean
    // something on paper answer the very same keys they answer on a plane, off the same
    // table and so off the same rebinding. The rest are a canvas's - there is nothing to
    // connect on a page - and are left for whatever else wants them.
    const wanted = toolPressed(event)
    if (wanted && PAPER_TOOLS.has(wanted)) {
      event.preventDefault()
      tools.choose(wanted)
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
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!store.picked.length || !writable) return

      event.preventDefault()
      // Never a page, whatever the arrow caught: a page is taken away from the
      // navigator, where the gesture says which sheet and not "this and everything on
      // it". See PagesNavigator.svelte.
      const going = store.picked.filter((id) => !pages.some((page) => page.id === id))
      if (going.length) store.edit(removed(canvas, going))
      return
    }

    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      store.turnTo(showing + (event.key === 'PageDown' ? 1 : -1))
      return
    }

    if (event.key === 'Escape') store.clearPicked()
  }
</script>

<!-- Named by how much paper is on it rather than by what it is, the way the canvas is
     named by what is on the plane: "Pages" alone says nothing a reader could act on.
     `role="application"` is what lets the paper keep its own keyboard - one letter per
     tool, Page up and Page down to turn - and it is also what stops a reader browsing
     the sheets, so the label is the whole of what is said about them. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="pages"
  bind:this={host}
  tabindex="0"
  role="application"
  aria-roledescription={t('Pages')}
  aria-label={t('{count} pages', { count: pages.length })}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
  {onwheel}
  {onkeydown}
>
  <!-- The column, moved by one transform: the pages are elements at their own
       coordinates and a scroll is composited, whether there are two pages or four
       hundred. -->
  <div
    class="column"
    style:transform="translate({width / 2 - camera.x * camera.scale}px, {height / 2 -
      camera.y * camera.scale}px) scale({camera.scale})"
  >
    {#each pages as page, at (page.id)}
      <!-- The note and the space, so a page can find the paper its `file` names: the
           same two the cards below are given, for the same reason. -->
      <PagesPage
        {page}
        number={at + 1}
        notePath={tab.note.path}
        root={workspace.activeSpace?.root ?? null}
      />
    {/each}

    {#each cards as node (node.id)}
      <CanvasNode
        {node}
        canvasPath={tab.note.path}
        {trusted}
        root={workspace.activeSpace?.root ?? null}
        picked={store.isPicked(node.id)}
        editing={store.editing === node.id}
        offset={store.isPicked(node.id) ? dragging : { x: 0, y: 0 }}
        ontext={(text: string) => store.edit(withText(canvas, node.id, text))}
        onleave={() => (store.editing = null)}
      />
    {/each}

    {#if store.hands.length}
      <CanvasHands hands={store.hands} {unit} {palette} />
    {/if}
  </div>

  <!-- The ink, on the canvas's own two layers: everything already written below,
       the stroke under the pen above. The very same component a canvas draws with,
       so a stroke means the same thing on paper as on a plane. -->
  <CanvasInk
    ink={canvas.ink}
    {live}
    {camera}
    {width}
    {height}
    picked={new Set(store.picked)}
    {palette}
  />

  <CanvasBar
    canundo={store.canUndo}
    canredo={store.canRedo}
    zoom={camera.scale}
    onundo={() => store.undo()}
    onredo={() => store.redo()}
    onerase={() => store.edit({ ...canvas, ink: [] })}
    onzoom={(by: number) => store.zoomBy(by)}
    onfit={() => store.fitAgain()}
  />
</div>

<style>
  .pages {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--surface-2);
    touch-action: none;
    outline: none;
  }

  /* The column's origin is the plane's origin, and the transform above does the
     rest. Nothing in here is laid out: every page and every card is absolute. */
  .column {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }
</style>
