<script lang="ts">
  /** A graph of notes on a canvas: the same surface for the whole space and for
   *  one note's neighbourhood, since the only difference between them is which
   *  graph they are handed.
   *
   *  Everything that moves is driven from one frame loop rather than from the
   *  reactive graph: the arrangement settles over about half a second, and after
   *  that a frame is asked for only when something happens - a pointer moving, a
   *  scroll, a theme changing, the notes arriving in order while the time is being
   *  played. A graph nobody is touching costs nothing.
   *
   *  What the reader asks for divides in two, and the division is the whole of why
   *  a filter is cheap. Spread and gather change where the notes go, so they build
   *  the arrangement again. Everything else - the filter, the orphans, the colours,
   *  the arrows, the sizes, the time being scrubbed to - changes only what is
   *  painted, and costs one frame however many notes there are. */

  import { onDestroy, untrack } from 'svelte'
  import GraphControls from './GraphControls.svelte'
  import { type NoteGraph, neighbours, signature } from './graph'
  import { graphFilter, type Keeps } from './graph-filter'
  import { Layout } from './graph-layout'
  import { type Camera, framing, graphPoint, nodeAt, zoomed } from './camera'
  import { type GraphColours, paint, radiusOf } from './graph-paint'
  import { t } from './i18n.svelte'
  import { stillness } from './motion'
  import { parseQuery } from './search/query'
  import { relativeTo } from './space-paths'
  import { theme } from './theme.svelte'
  import { workspace } from './workspace.svelte'
  import { MOST_GROUPS } from './workspace/graph-settings.svelte'

  const {
    graph,
    current = null,
    whole = false,
    onopen,
    onescape,
  }: {
    graph: NoteGraph
    /** The id of the note being read, so it can be marked. */
    current?: string | null
    /** Whether this is the picture of the whole space rather than the notes around
     *  one of them. The card in the corner, the filter it holds and the time being
     *  played are about a space; a neighbourhood is already the answer to a
     *  question, and narrowing it further would be asking the same thing twice. */
    whole?: boolean
    /** A node was clicked: opened as a preview, or kept on a double click, the
     *  way a row in the file list opens. */
    onopen?: ((path: string, keep: boolean) => void) | undefined
    onescape?: (() => void) | undefined
  } = $props()

  /** How long a frame may spend settling the arrangement, in milliseconds. A
   *  count of ticks would be wrong on one machine or the other: a tick over ten
   *  notes is nothing and a tick over two thousand is a millisecond or two. So
   *  the frame takes as many as fit and no more, which keeps a small graph
   *  settled by the second frame and a large one at sixty frames a second while
   *  it finds its shape. Six leaves the rest of the frame for the drawing. */
  const A_FRAME = 6

  /** And how long a frame may spend on it while nothing is being drawn, which is what
   *  a reader who asked for less movement gets. More than the above because there is
   *  no drawing to leave room for and the picture is not on screen yet.
   *
   *  What this trades: reaching the arrangement in one go was a second and a half of a
   *  thread that answered nothing at all on a space of five thousand notes. A frame at
   *  a time it takes longer in total - the same work at ten milliseconds a frame is
   *  about two seconds of a picture that is not there yet - but every one of those
   *  frames takes a keystroke, a click and a scroll. Which is the right way round: a
   *  reader who asked not to watch things move did not ask for the app to stop. */
  const A_SETTLE = 10

  /** How far a pointer may travel and still count as a click rather than a
   *  drag. */
  const A_CLICK = 3

  /** Room left around the graph when it is framed. */
  const PADDING = 24

  /** How long the whole space takes to arrive, in milliseconds, when the time is
   *  played. Long enough to watch a shape form, short enough to watch twice. */
  const A_LAPSE = 6000

  let host = $state<HTMLElement>()
  let canvas = $state<HTMLCanvasElement>()

  let layout: Layout | null = null
  let radii = new Float64Array(0)
  let lit = new Uint8Array(0)
  /** One byte per node: whether it is being shown. See `shown` in graph-paint.ts,
   *  which is where hiding a note stops and re-arranging one would begin. */
  let hiding = new Uint8Array(0)
  let tint = new Int8Array(0)
  let camera: Camera = { x: 0, y: 0, scale: 1 }
  let colours: GraphColours | null = null
  let width = 0
  let height = 0
  /** How many of the screen's pixels one of the page's is worth. Read when the
   *  surface is sized, since that is what it is sized by, and handed to the drawing:
   *  a link is a hairline in the screen's pixels rather than in the page's, and the
   *  difference is sixty frames a second against two. See EDGE_PIXELS. */
  let ratio = 1
  let hovered = -1

  let frame = 0
  /** Whether the reader has moved the view themselves. Until they have, the view
   *  keeps the whole graph framed as it settles, so the picture arrives already
   *  in view rather than needing to be found. The moment it is panned, zoomed or
   *  a note is dragged, the view is theirs and nothing moves it again. */
  let touched = false
  /** Whether a drag is moving the view. State, because the cursor says so. */
  let panning = $state(false)
  let holding = -1
  /** The note the last click opened. A second click keeps it, the way a second
   *  click on a row in the file list does - and it has to be remembered rather
   *  than looked up again, because the first click has already opened a note and
   *  the picture may be a different one by the time the second arrives. */
  let clicked: string | null = null
  let lastX = 0
  let lastY = 0
  let travelled = 0

  /** Which card the corner is showing, if any. A gesture rather than a setting: a
   *  card left open is not something another machine should inherit. */
  let carding = $state(false)
  /** The moment the picture is showing, in milliseconds, or null for all of it.
   *  Notes made after it are not drawn. */
  let at = $state<number | null>(null)
  let playing = $state(false)
  /** When the playing started, and where the scrub bar was then. */
  let started = 0
  let startedAt = 0

  const settings = $derived(workspace.graphSettings.here)

  /** What the filter reads, as the reader wrote it. Its own step, so the predicate
   *  below is built again when the words change rather than every time anything
   *  about the picture does. */
  const asked = $derived(whole ? settings.filter.trim() : '')

  /** What the filter keeps, compiled once per query rather than per note. Only the
   *  whole space's picture has one. */
  const filter = $derived<Keeps | null>(asked ? graphFilter(parseQuery(asked)) : null)

  /** Each colour group as the colour it paints, counting from zero, and what it
   *  keeps. A note is in the first group that keeps it, so two overlapping queries
   *  read top down like the rows they are written in. */
  const groups = $derived(
    settings.groups
      .filter((group) => group.query.trim())
      .map((group) => ({
        colour: Math.min(MOST_GROUPS, Math.max(1, Math.round(group.colour))) - 1,
        keeps: graphFilter(parseQuery(group.query)),
      })),
  )

  /** When each note in the space was made, by the path the graph names it with.
   *  From the file list, which has read it already: the link index reads what notes
   *  say and a creation time is what the disk says. */
  const madeAt = $derived.by((): Map<string, number> => {
    const root = whole ? (workspace.activeSpace?.root ?? null) : null
    if (root === null) return new Map()

    return new Map(
      workspace.files
        .filter((file) => file.created > 0)
        .map((file) => [relativeTo(root, file.path), file.created]),
    )
  })

  /** The first and last note of the space, or null where nothing has a time to
   *  play - a browser store with no dates, or a picture of one note's
   *  neighbourhood. */
  const span = $derived.by((): { from: number; to: number } | null => {
    let from = Infinity
    let to = -Infinity

    for (const node of graph.nodes) {
      const made = node.path === null ? 0 : (madeAt.get(node.path) ?? 0)
      if (!made) continue
      if (made < from) from = made
      if (made > to) to = made
    }

    return from <= to && from !== to ? { from, to } : null
  })

  /** The shape of the graph, as one number. The panel is handed a fresh graph
   *  object whenever anything in the space is saved, and laying the arrangement
   *  out again then would make the picture jump every time the typing pauses.
   *  This is what says whether it is really another graph.
   *
   *  The graph itself works it out where it is built, which is the one place that
   *  already walks every node and every edge; see `signature` in graph.ts. It used
   *  to be every id and every pair joined into one string - three hundred kilobytes
   *  built and compared per save over five thousand notes, to find out that nothing
   *  had changed.
   *
   *  The filter is deliberately not in it. A note the filter takes out is hidden
   *  rather than removed, so the notes that stay do not move; that is what lets a
   *  switch in the card cost one frame in a space of five thousand notes. */
  const shape = $derived(signature(graph))

  const currentAt = $derived(
    current === null ? -1 : graph.nodes.findIndex((node) => node.id === current),
  )

  /** What the arrangement is of: the graph itself, and the two forces that decide
   *  where a note goes.
   *
   *  As one string, and that is the point of it. The settings are one object behind
   *  one getter, so reading `spread` off it makes the effect that reads it follow
   *  every setting there is - and an effect that laid five thousand notes out again
   *  because an arrowhead was switched on is four seconds of the picture unforming
   *  and forming. A derived that answers the same string wakes nothing. */
  const arrangedBy = $derived([settings.spread, settings.gather, shape].join('\n'))

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // A different graph is a different arrangement, framed afresh. The same graph
  // handed over again is not, so the view stays where the reader left it. And the
  // two forces are in the string it follows because they are the only things the
  // reader can ask for that change where a note goes.
  $effect(() => {
    follows(arrangedBy)
    // Untracked, and that is the whole of the guard: `rebuild` reads the graph and
    // both forces itself, so an effect that simply called it would follow every one
    // of them - the graph is handed over afresh whenever anything in the space is
    // saved, and the settings are one object, so a note being written or an
    // arrowhead being switched on would each lay five thousand notes out again. The
    // string above is what says the arrangement is really a different one.
    untrack(rebuild)
  })

  // What is shown, what colour it is, and how big. None of these move anything, so
  // none of them lay the arrangement out again: they fill in the two masks the
  // drawing reads and ask for one frame.
  $effect(() => {
    follows(filter)
    follows(groups)
    follows(settings.orphans)
    follows(settings.sized)
    follows(madeAt)
    follows(at)
    // Untracked for the reason above: what this follows is the list written out
    // here, not everything one pass over five thousand notes happens to read.
    untrack(remask)
    schedule()
  })

  // An arrowhead and the width of a link change what is drawn and nothing else, so
  // they ask for a frame and nothing more.
  $effect(() => {
    follows(settings.arrows)
    follows(settings.lines)
    schedule()
  })

  // The note being read, and the theme, change what is drawn but not where
  // anything is.
  $effect(() => {
    follows(currentAt)
    follows(theme.current)
    follows(theme.accent)
    colours = null
    schedule()
  })

  $effect(() => {
    const element = host
    if (!element) return

    const watcher = new ResizeObserver(() => resize())
    watcher.observe(element)
    resize()

    return () => watcher.disconnect()
  })

  // Zooming has to stop the page from doing anything else with the scroll, and a
  // handler that says so cannot be a passive one.
  $effect(() => {
    const element = canvas
    if (!element) return

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  function rebuild() {
    layout = new Layout(graph, { spread: settings.spread, gather: settings.gather })
    lit = new Uint8Array(graph.nodes.length)
    hovered = -1
    remask()

    // A reader who has asked for less movement gets the arrangement it arrives at,
    // without watching it get there: `run` keeps ticking without drawing until it
    // has, a frame at a time. It used to be one loop with no way out of it, which on
    // five thousand notes meant the readers who asked for less movement were the
    // only ones the picture froze for.
    settling = stillness()

    touched = false
    frameGraph()
    schedule()
  }

  /** Whether the arrangement is being reached without being shown, which is what a
   *  reader who asked for less movement gets. Nothing is drawn while this is true. */
  let settling = false

  /** Which notes are drawn, in what colour, and how big - the three things that
   *  change without anything moving. One pass over the nodes for all three. */
  function remask() {
    // Read once, here, and not inside the loop. Every one of these is a derived,
    // and reading one is a walk of whatever it depends on to find out whether it
    // has changed: five thousand nodes times five of them was 1.6 seconds inside
    // Svelte's own dirtiness check, which was more than half of what opening the
    // picture of a space cost.
    const nodes = graph.nodes
    const edges = graph.edges
    const dates = madeAt
    const colours = groups
    const keeps = filter
    const sized = settings.sized

    const count = nodes.length
    if (hiding.length !== count) hiding = new Uint8Array(count)
    if (tint.length !== count) tint = new Int8Array(count)
    if (radii.length !== count) radii = new Float64Array(count)

    const cut = at
    const orphans = !whole || settings.orphans

    for (let one = 0; one < count; one++) {
      const node = nodes[one]
      if (!node) continue

      const made = node.path === null ? 0 : (dates.get(node.path) ?? 0)

      // A note the space does not hold has no date of its own; it appears with the
      // first note that asks for it, which is what its edges already say.
      const yet = cut === null || made === 0 || made <= cut
      const kept = !keeps || keeps(node)
      hiding[one] = yet && kept && (orphans || node.degree > 0) ? 1 : 0

      radii[one] = radiusOf(sized ? node.degree : 0)

      let colour = -1
      for (const group of colours) {
        if (!group.keeps(node)) continue
        colour = group.colour
        break
      }
      tint[one] = colour
    }

    // A note the space does not hold is a hole rather than a note, and a hole
    // belongs to whatever asks for it: it is shown where something asking is shown
    // and nowhere else. So it answers to its neighbours rather than to the filter -
    // it has no name worth filtering and no tags at all, and a filter that took
    // every hole out of the picture would be a picture that could never say what
    // these notes are missing. Without this, a filter and a time being played each
    // leave hollow rings standing on their own.
    for (let one = 0; one < count; one++) {
      if (nodes[one]?.path === null) hiding[one] = 0
    }

    for (const edge of edges) {
      if (nodes[edge.a]?.path === null && hiding[edge.b]) hiding[edge.a] = 1
      if (nodes[edge.b]?.path === null && hiding[edge.a]) hiding[edge.b] = 1
    }
  }

  /** Puts the whole graph in view. */
  function frameGraph() {
    if (!layout) return
    camera = framing(layout.x, layout.y, graph.nodes.length, width, height, PADDING, hiding)
  }

  function resize() {
    const element = host
    const surface = canvas
    if (!element || !surface) return

    const box = element.getBoundingClientRect()
    ratio = window.devicePixelRatio || 1
    const next = { width: Math.round(box.width), height: Math.round(box.height) }
    if (!next.width || !next.height) return

    width = next.width
    height = next.height
    surface.width = Math.round(width * ratio)
    surface.height = Math.round(height * ratio)

    // Setting the size clears the canvas and its transform, so the scale that
    // makes one unit a css pixel goes on again here.
    surface.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)

    if (!touched) frameGraph()
    schedule()
  }

  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(run)
  }

  function run() {
    frame = 0
    const arrangement = layout
    if (!arrangement) return

    // Reaching the arrangement without showing it get there: as much of it as a
    // frame can hold, and nothing drawn until it has arrived. A frame's worth at a
    // time rather than all of it, so the thread still answers a keystroke and a
    // click while the picture is being worked out.
    if (settling) {
      if (!arrangement.settle(A_SETTLE)) {
        schedule()
        return
      }

      settling = false
      if (!touched) frameGraph()
      draw()
      return
    }

    // As many ticks as the frame has room for. Another frame is asked for only
    // while there is still settling to do, so an arrangement that has arrived
    // costs one draw and nothing after it - or while the time is being played,
    // which is the one thing that moves without anything settling.
    const until = performance.now() + A_FRAME
    while (!arrangement.settled && performance.now() < until) arrangement.tick()
    if (playing) step()
    if (!arrangement.settled || playing) schedule()

    // The arrangement spreads out as it settles, so the view follows it until it
    // has arrived - or until the reader takes the view over.
    if (!touched) frameGraph()
    draw()
  }

  /** Where the playing has got to. The wall clock rather than a count of frames,
   *  so a space arrives over the same six seconds on every machine. */
  function step() {
    const one = span
    if (!one) {
      playing = false
      return
    }

    const gone = (performance.now() - started) / A_LAPSE
    const next = startedAt + (one.to - one.from) * gone

    if (next >= one.to) {
      at = null
      playing = false
      return
    }

    at = next
  }

  /** Plays the space from where the scrub bar stands, or from the beginning once it
   *  has run out.
   *
   *  It moves even for a reader who has asked for as little movement as possible,
   *  because they asked for this one by pressing it - and the scrub bar beside it is
   *  the same thing held still. */
  function play() {
    const one = span
    if (!one) return

    if (playing) {
      playing = false
      return
    }

    startedAt = at ?? one.from
    started = performance.now()
    playing = true
    schedule()
  }

  function scrub(moment: number) {
    playing = false
    at = moment >= (span?.to ?? 0) ? null : moment
    schedule()
  }

  /** The colours the graph is drawn in, read from the stylesheet so a theme
   *  change is all it takes. Read once and again whenever the theme moves. */
  function palette(element: HTMLElement): GraphColours {
    const style = getComputedStyle(element)
    const token = (name: string) => style.getPropertyValue(name).trim()

    return {
      edge: token('--line-strong'),
      litEdge: token('--accent'),
      node: token('--muted'),
      hollow: token('--muted'),
      current: token('--accent'),
      label: token('--muted-strong'),
      font: token('--font-ui') || 'sans-serif',
      // The six the theme names, resolved here for the same reason the rest are: a
      // 2d context cannot look a custom property up.
      groups: Array.from({ length: MOST_GROUPS }, (_one, index) => {
        return token(`--canvas-${index + 1}`) || '#888888'
      }),
    }
  }

  function draw() {
    const surface = canvas
    const element = host
    if (!surface || !element || !layout) return

    const context = surface.getContext('2d')
    if (!context) return

    colours ??= palette(element)
    context.clearRect(0, 0, width, height)

    paint(context, {
      graph,
      x: layout.x,
      y: layout.y,
      radii,
      camera,
      width,
      height,
      colours,
      current: currentAt,
      hovered,
      lit,
      shown: hiding,
      tint,
      arrows: settings.arrows,
      lines: settings.lines,
      ratio,
    })
  }

  /** Which nodes belong to what is being pointed at: the node itself, and
   *  everything one link from it. Everything else is drawn faint. */
  function relight(node: number) {
    lit.fill(0)
    if (node < 0) return

    lit[node] = 2
    // The node's own neighbours, out of the list the graph keeps per node, rather
    // than every edge in the space: this runs whenever the pointer moves onto
    // another note, and a space of five thousand notes has ten thousand edges.
    for (const near of neighbours(graph, node)) lit[near] ||= 1
  }

  function nodeUnder(event: PointerEvent | MouseEvent): number {
    const surface = canvas
    if (!surface || !layout) return -1

    const box = surface.getBoundingClientRect()
    const found = nodeAt(
      layout.x,
      layout.y,
      radii,
      camera,
      width,
      height,
      event.clientX - box.left,
      event.clientY - box.top,
    )

    // A note that is not being drawn is not under the pointer either.
    return found >= 0 && hiding[found] ? found : -1
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return

    canvas?.setPointerCapture(event.pointerId)
    lastX = event.clientX
    lastY = event.clientY
    travelled = 0

    const node = nodeUnder(event)
    if (node >= 0) holding = node
    else panning = true
  }

  function onPointerMove(event: PointerEvent) {
    const surface = canvas
    if (!surface) return

    if (holding >= 0 && layout) {
      travelled += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY

      // Only once it is a drag rather than a click, so a click does not nudge
      // the node it lands on.
      if (travelled > A_CLICK) {
        touched = true
        const box = surface.getBoundingClientRect()
        const point = graphPoint(
          camera,
          width,
          height,
          event.clientX - box.left,
          event.clientY - box.top,
        )
        layout.hold(holding, point.x, point.y)
        schedule()
      }
      return
    }

    if (panning) {
      touched = true
      camera = {
        x: camera.x - (event.clientX - lastX) / camera.scale,
        y: camera.y - (event.clientY - lastY) / camera.scale,
        scale: camera.scale,
      }
      travelled += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY
      schedule()
      return
    }

    const node = nodeUnder(event)
    if (node === hovered) return

    hovered = node
    relight(node)
    schedule()
  }

  function onPointerUp(event: PointerEvent) {
    const wasHolding = holding
    const wasClick = travelled <= A_CLICK

    holding = -1
    panning = false
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

    if (wasHolding >= 0 && wasClick) open(wasHolding, false)
  }

  function onDoubleClick() {
    if (clicked) onopen?.(clicked, true)
  }

  function open(node: number, keep: boolean) {
    // A node standing for a note the space does not hold has nothing to open.
    const path = graph.nodes[node]?.path
    if (!path) return

    clicked = path
    onopen?.(path, keep)
  }

  function onWheel(event: WheelEvent) {
    const surface = canvas
    if (!surface) return

    event.preventDefault()
    touched = true
    const box = surface.getBoundingClientRect()
    camera = zoomed(
      camera,
      width,
      height,
      event.clientX - box.left,
      event.clientY - box.top,
      Math.exp(-event.deltaY * 0.0015),
    )
    schedule()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !onescape) return

    // Only one graph is on screen at a time - the panel shows its lists while a
    // graph tab is open, having no note to be about - so this is the only thing
    // Escape can mean, except where there is text being typed: the palette and
    // every sheet close on Escape from their own field. The card in the corner is
    // an overlay and gets the press first; see overlays.ts.
    const focused = document.activeElement
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
    if (focused instanceof HTMLElement && focused.isContentEditable) return

    onescape()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- A picture, and one that answers the pointer: there is nothing inside a canvas
     to hang an element on, so the interaction lives on the canvas itself. -->
<div class="graph" bind:this={host}>
  <canvas
    bind:this={canvas}
    class:panning
    aria-label={t('Graph')}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => {
      if (hovered < 0) return
      hovered = -1
      relight(-1)
      schedule()
    }}
    ondblclick={onDoubleClick}
  ></canvas>

  {#if whole}
    <GraphControls
      open={carding}
      {span}
      at={at ?? span?.to ?? 0}
      {playing}
      onopen={(next: boolean) => (carding = next)}
      onplay={play}
      onscrub={scrub}
    />
  {/if}
</div>

<style>
  .graph {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* The picture is the thing being touched, so a drag on it must not start a
       text selection or the browser's own panning. */
    touch-action: none;
    user-select: none;
    cursor: default;
  }

  canvas.panning {
    cursor: grabbing;
  }
</style>
