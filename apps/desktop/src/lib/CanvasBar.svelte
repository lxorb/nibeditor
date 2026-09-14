<script lang="ts">
  /** The canvas bar: what your hand is holding, in one row, on every device.
   *
   *  There was a row of small glyphs for a mouse and a second, taller bar for a
   *  finger. Two bars is two designs and two places to fix anything, and what
   *  really differed between them was never the pointer but the size, which the
   *  touch scale already answers. So this is the one bar: the same buttons in the
   *  same order everywhere, drawn bigger where a thumb has to land on them.
   *
   *  Left to right it is arranging, then drawing, then what a press puts on the
   *  plane, then the colour in hand, then the two arrows, then the zoom. Pressing
   *  the tool you are already holding opens that tool's own panel and nothing else,
   *  which is the one gesture nobody has to be told, and the panel opens over the
   *  button that opened it rather than in the middle of the pane.
   *
   *  Three pens, always three. A pen is a thing you own rather than a setting you
   *  pick, so each slot is a whole pen: which nib, how wide, how much of the colour
   *  lands, which colour. Nothing to add and nothing to put away.
   *
   *  It stops every pointer at itself. The plane behind it treats a press as a
   *  gesture, and a bar that let one through would clear the selection its own
   *  buttons are for. */

  import { NOTCH } from './camera'
  import CanvasCatch from './CanvasCatch.svelte'
  import CanvasColours from './CanvasColours.svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import CanvasPen from './CanvasPen.svelte'
  import CanvasPlace from './CanvasPlace.svelte'
  import CanvasRub from './CanvasRub.svelte'
  import {
    ABOUT,
    hinted,
    MARKS,
    PEN_ICONS,
    PEN_NAMES,
    PLACING,
    RUBBING,
    type ToolMark,
  } from './canvas/glyphs'
  import { hand } from './canvas/hand.svelte'
  import { DEFAULT_INK, shownInk } from './canvas/palette'
  import { nearestDock, pens, upright } from './canvas/pens.svelte'
  import { type Tool } from './canvas/pointer'
  import { tick } from './canvas/tick'
  import { tools } from './canvas/tools.svelte'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { type MenuEntry, menu } from './menu.svelte'
  import { overlays } from './overlays'
  import { viewport } from './viewport.svelte'

  const {
    canundo,
    canredo,
    zoom,
    onundo,
    onredo,
    onerase,
    onzoom,
    onfit,
    zoomRows,
  }: {
    canundo: boolean
    canredo: boolean
    /** How far in the plane is, so the number on the bar is the one in the corner
     *  of every drawing program. */
    zoom: number
    onundo: () => void
    onredo: () => void
    /** Every stroke on the plane, gone, which is what the eraser's panel asks for. */
    onerase: () => void
    /** In or out about the middle of the view, by this much. */
    onzoom: (by: number) => void
    onfit: () => void
    /** What the percentage offers instead of simply fitting, for a surface with
     *  more than one answer to "fit". A page note has two - the width of the paper
     *  and the whole of the page - and one to one, which is the size it prints at;
     *  a plane has neither, so this is absent there and the number fits. */
    zoomRows?: (() => MenuEntry[]) | undefined
  } = $props()

  /** Which panel is open over the bar, if any. One at a time: two panels over a
   *  drawing is a dialog box, and this is a bar. */
  type Panel = 'pen' | 'rub' | 'catch' | 'put' | 'colour'
  let open = $state<Panel | null>(null)

  /** Where the panel points, in pixels from the left of the cluster: the middle of
   *  the button that opened it. */
  let popAt = $state(0)
  let cluster = $state<HTMLElement>()

  /** How far a press may drift and still be a press on the grip rather than a drag
   *  of the bar, in pixels. */
  const A_TWITCH = 12

  const nib = $derived(pens.current)
  const drawing = $derived(tools.which === 'draw')

  /** Which of the things a press puts on the plane is in hand, if one of them is. */
  const putting = $derived(PLACING.find((one) => one.id === tools.which))

  /** Whether the bar can be moved out from under a wrist. A question only a tablet
   *  has: a mouse has no wrist on the glass and a bar at the bottom of a phone is
   *  where a thumb already is. */
  const movable = $derived(viewport.touch || hand.penSeen)

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts. And Android's back, which is the same gesture on a phone.
  $effect(() => (open ? overlays.show(() => (open = null)) : undefined))
  $effect(() => closeOnBack(open !== null, () => (open = null)))

  function shut() {
    open = null
  }

  // A press anywhere but on this bar shuts whatever it has open.
  //
  // Caught on the way down, at the window, rather than waited for on the way up.
  // Everything else in the app closes a panel with the click that follows the press,
  // and the plane cannot use that: it reads a press as the start of a gesture, so a
  // panel that waited for the click stayed open through a whole stroke - and a panel
  // over the drawing is exactly what the drawing is under. Capture, so nothing
  // between here and the window can decide otherwise.
  $effect(() => {
    const away = (event: PointerEvent) => {
      if (!open) return

      const target = event.target
      if (target instanceof Node && cluster?.contains(target)) return

      open = null
    }

    window.addEventListener('pointerdown', away, { capture: true })
    return () => window.removeEventListener('pointerdown', away, { capture: true })
  })

  // And a tool taken with a key shuts it too: the panel was about the tool that is no
  // longer in hand.
  let was = tools.which
  $effect(() => {
    if (tools.which === was) return

    was = tools.which
    open = null
  })

  /** Where the button that was pressed is, so the panel opens over it. Along the bar,
   *  whichever way the bar runs: across it when it lies along an edge, down it when it
   *  stands on its end. */
  function anchor(event: Event) {
    const button = event.currentTarget
    const box = cluster?.getBoundingClientRect()
    if (!(button instanceof HTMLElement) || !box) return

    const own = button.getBoundingClientRect()
    popAt = upright(pens.dock)
      ? own.top + own.height / 2 - box.top
      : own.left + own.width / 2 - box.left
  }

  function toggle(panel: Panel, event: Event) {
    anchor(event)
    open = open === panel ? null : panel
  }

  /** Which tools have a panel of their own, which is also which of them answer a
   *  second press with one. */
  function panelFor(tool: Tool): Panel | null {
    if (tool === 'erase') return 'rub'
    if (tool === 'lasso') return 'catch'
    return null
  }

  /** A press on a tool: it comes out, and pressing the one that is already out
   *  opens its panel. */
  function pressTool(mark: ToolMark, event: Event) {
    tick()
    const panel = panelFor(mark.id)

    if (tools.which === mark.id && panel) {
      toggle(panel, event)
      return
    }

    open = null
    tools.choose(mark.id)
  }

  function pressPen(index: number, event: Event) {
    tick()

    if (drawing && pens.at === index) {
      toggle('pen', event)
      return
    }

    open = null
    tools.pickPen(index)
  }

  /** The grip: dragged, the bar comes with the finger and springs to whichever edge
   *  it was let go nearest; pressed, it folds away. Two answers from one control,
   *  because both are the same question about where the bar should be.
   *
   *  The bar follows the pointer rather than jumping between two places when it
   *  crosses the middle: a thing being moved should be under the hand moving it, and
   *  where it lands is answered when it is let go. Then it springs, which is what says
   *  the edge caught it. */
  let grabbed = $state(false)
  let carried = $state.raw<{ x: number; y: number } | null>(null)
  let from = { x: 0, y: 0 }

  function onGripDown(event: PointerEvent) {
    const grip = event.currentTarget
    if (!(grip instanceof HTMLElement)) return

    grabbed = true
    carried = { x: 0, y: 0 }
    from = { x: event.clientX, y: event.clientY }
    grip.setPointerCapture(event.pointerId)
  }

  function onGripMove(event: PointerEvent) {
    if (!grabbed) return

    carried = { x: event.clientX - from.x, y: event.clientY - from.y }
  }

  function onGripUp(event: PointerEvent) {
    if (!grabbed) return

    grabbed = false
    tick()

    const went = Math.hypot(event.clientX - from.x, event.clientY - from.y)
    // Let go where it was picked up: the press meant the other thing the grip does.
    if (went < A_TWITCH) {
      carried = null
      pens.fold(true)
      open = null
      return
    }

    // Where the bar itself ended up rather than where the finger did, so a bar
    // dragged by the corner of its grip still lands where it looks like it should.
    const box = cluster?.getBoundingClientRect()
    const middle = box
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: event.clientX, y: event.clientY }

    pens.dockTo(nearestDock(middle, window.innerWidth, window.innerHeight))
    // And the offset let go of, which is the spring: the bar is already at its new
    // edge, so easing the carry back to nothing is the movement that says so.
    carried = null
    open = null
  }

  function onGripLost() {
    grabbed = false
    carried = null
  }

  /** Whether the bar stands on its end, which is what the two side edges mean. */
  const standing = $derived(upright(pens.dock))

  /** The dot on the bar: the ink the pen in hand writes in. Always the pen, never
   *  what is picked: what is picked wears its colour on its own bar, over itself,
   *  and one question per surface is the whole of why that bar exists. */
  const swatch = $derived(shownInk(nib.colour))
</script>

<svelte:window onblur={shut} />

<!-- Every pointer stops here. See the note at the top of the file. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cluster"
  class:top={pens.dock === 'top'}
  class:left={pens.dock === 'left'}
  class:right={pens.dock === 'right'}
  class:standing
  class:carrying={carried !== null}
  style:translate={carried ? `${carried.x}px ${carried.y}px` : undefined}
  bind:this={cluster}
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.stopPropagation()}
>
  {#if pens.shut}
    <!-- Folded away: the pen you were holding, and nothing else. A landscape
         tablet gets its whole page back and the way in is still in your hand. -->
    <button
      type="button"
      class="tab"
      title={t('The pens')}
      aria-label={t('The pens')}
      onclick={() => {
        tick()
        pens.fold(false)
      }}
    >
      <CanvasIcon node={PEN_ICONS[nib.tool]} />
    </button>
  {:else}
    {#if open}
      <div class="nib-layer panel" style:--pop="{popAt}px">
        {#if open === 'pen'}
          <CanvasPen {nib} />
        {:else if open === 'rub'}
          <CanvasRub {onerase} />
        {:else if open === 'catch'}
          <CanvasCatch />
        {:else if open === 'put'}
          <CanvasPlace
            onchoose={(tool: Tool) => {
              tools.choose(tool)
              shut()
            }}
          />
        {:else}
          <!-- The bare dot is the ink the page itself is written in, which is what a
               pen with no colour of its own writes and the way back to it. Drawn in
               that ink, so it never reads as a colour it is not. -->
          <CanvasColours
            colour={nib.colour === DEFAULT_INK ? null : nib.colour}
            recent={pens.recent}
            bare={{ css: 'var(--text-strong)', title: t('The ink of the page') }}
            oncolour={(colour: string | null) => pens.set({ colour: colour ?? DEFAULT_INK })}
          />
        {/if}
      </div>
    {/if}

    <div class="bar">
      {#if movable}
        <span
          class="grip"
          class:grabbed
          role="separator"
          aria-label={t('Move the bar')}
          title={t('Move the bar')}
          onpointerdown={onGripDown}
          onpointermove={onGripMove}
          onpointerup={onGripUp}
          onpointercancel={onGripLost}
        >
          <CanvasIcon node={MARKS.grip} />
        </span>
      {/if}

      <div class="scroller">
        {#snippet holding(mark: ToolMark)}
          <button
            type="button"
            class:on={tools.which === mark.id}
            class:deeper={tools.which === mark.id && panelFor(mark.id) !== null}
            title={hinted(mark)}
            aria-label={mark.title()}
            aria-pressed={tools.which === mark.id}
            onclick={(event) => pressTool(mark, event)}
          >
            <CanvasIcon node={mark.icon} />
          </button>
        {/snippet}

        {#each ABOUT as one (one.id)}
          {@render holding(one)}
        {/each}

        <span class="split"></span>

        <!-- The three pens. Each is the instrument it is, with the ink it writes
             in under it, and the one in hand is the tinted one. -->
        {#each pens.list as one, index (index)}
          {@const out = drawing && pens.at === index}
          <button
            type="button"
            class="pen"
            class:on={out}
            class:deeper={out}
            title={out
              ? hinted({ title: PEN_NAMES[one.tool], key: 'canvas.tool.draw' })
              : PEN_NAMES[one.tool]()}
            aria-label={PEN_NAMES[one.tool]()}
            aria-pressed={out}
            style:--ink={shownInk(one.colour)}
            onclick={(event) => pressPen(index, event)}
          >
            <CanvasIcon node={PEN_ICONS[one.tool]} />
          </button>
        {/each}

        {#each RUBBING as one (one.id)}
          {@render holding(one)}
        {/each}

        <span class="split"></span>

        <!-- What a press puts on the plane. While one of them is in hand it is that
             one, drawn on the button, so the bar says what a press is about to do
             and pressing it again opens the grid again. -->
        <button
          type="button"
          class:on={open === 'put' || putting !== undefined}
          class:deeper={putting !== undefined}
          title={putting ? hinted(putting) : t('Add')}
          aria-label={putting ? putting.title() : t('Add')}
          aria-pressed={open === 'put'}
          onclick={(event) => {
            tick()
            toggle('put', event)
          }}
        >
          <CanvasIcon node={putting?.icon ?? MARKS.put} />
        </button>

        <button
          type="button"
          class="swatch"
          class:on={open === 'colour'}
          title={t('Colour')}
          aria-label={t('Colour')}
          aria-pressed={open === 'colour'}
          style:--dot={swatch}
          onclick={(event) => {
            tick()
            toggle('colour', event)
          }}
        ></button>

        <span class="split"></span>

        <button
          type="button"
          title={t('Undo')}
          aria-label={t('Undo')}
          disabled={!canundo}
          onclick={() => {
            tick()
            onundo()
          }}
        >
          <CanvasIcon node={MARKS.undo} />
        </button>

        <button
          type="button"
          title={t('Redo')}
          aria-label={t('Redo')}
          disabled={!canredo}
          onclick={() => {
            tick()
            onredo()
          }}
        >
          <CanvasIcon node={MARKS.redo} />
        </button>

        <span class="split"></span>

        <button
          type="button"
          title={t('Zoom out')}
          aria-label={t('Zoom out')}
          onclick={() => {
            tick()
            onzoom(1 / NOTCH)
          }}
        >
          <CanvasIcon node={MARKS.zoomOut} />
        </button>

        <!-- The number is the button that puts the whole plane in the pane, which
             is the only other thing anybody asks of a zoom on a plane. On paper it
             opens the rows instead: there is more than one way to fit a sheet. -->
        <button
          type="button"
          class="how-far"
          title={zoomRows ? t('Zoom') : t('Show the whole canvas')}
          aria-label={zoomRows ? t('Zoom') : t('Show the whole canvas')}
          onclick={(event) => {
            tick()
            const rows = zoomRows
            if (rows) menu.show(event, rows(), { title: t('Zoom') })
            else onfit()
          }}
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          type="button"
          title={t('Zoom in')}
          aria-label={t('Zoom in')}
          onclick={() => {
            tick()
            onzoom(NOTCH)
          }}
        >
          <CanvasIcon node={MARKS.zoomIn} />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Against one edge of the pane and across it, clear of whatever the system puts
     in the corners. */
  .cluster {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: calc(var(--space-2) + var(--inset-bottom));
    z-index: 6;
    display: flex;
    flex-direction: column;
    /* The bar is as wide as what is on it and no wider, centred in the pane, so a
       tablet in landscape gets a bar and not a shelf. A phone runs out of room and
       the same rule makes it the full width, scrolling. */
    align-items: center;
    gap: var(--space-2);
    animation: rise var(--dur-stage) var(--ease-out);
  }

  .cluster.top {
    bottom: auto;
    top: calc(var(--space-2) + var(--inset-top));
    flex-direction: column-reverse;
    animation: fall var(--dur-stage) var(--ease-out);
  }

  /* Against a side, standing on its end. The pane's own height rather than its
     width, and the bar and its panel side by side instead of stacked. */
  .cluster.left,
  .cluster.right {
    left: auto;
    right: auto;
    top: calc(var(--space-2) + var(--inset-top));
    bottom: calc(var(--space-2) + var(--inset-bottom));
    justify-content: center;
    animation: none;
  }

  .cluster.left {
    left: calc(var(--space-2) + var(--inset-left, 0px));
    flex-direction: row;
  }

  .cluster.right {
    right: calc(var(--space-2) + var(--inset-right, 0px));
    flex-direction: row-reverse;
  }

  /* Let go, the bar is already at its edge and the offset it was carried by eases
     back to nothing: that is the spring. While it is being carried there is no
     easing at all, because it is under a finger. */
  .cluster {
    transition: translate var(--dur-slow) var(--ease-spring);
  }

  .cluster.carrying {
    transition: none;
    cursor: grabbing;
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 10px;
    }
  }

  @keyframes fall {
    from {
      opacity: 0;
      translate: 0 -10px;
    }
  }

  /* A phone keeps the app's own round button in the bottom right corner clear. */
  :global([data-device='phone']) .cluster:not(.top) {
    right: calc(var(--space-2) + 60px);
  }

  /* A small bar over the plane, which is level 2 of the elevation model: the
     surface, the hairline and the shadow the format bar over a selection wears,
     and the corner that goes with them. It was drawn at `--radius-lg` - the
     corner a surface that *replaces* part of the screen takes - which put a
     shadow from one level and a corner from another on one box. See
     docs/design.md. */
  .bar {
    max-width: 100%;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  /* Standing on its end: the same buttons in the same order, down instead of
     across. One bar, one order, one design; only the axis turns. */
  .cluster.standing .bar {
    flex-direction: column;
    /* As tall as the pane and no taller: a bar of fifteen buttons on a short screen
       scrolls inside itself rather than off the end of it. */
    max-width: none;
    max-height: 100%;
  }

  .cluster.standing .scroller {
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  .cluster.standing .split {
    width: 20px;
    height: 1px;
    margin: 5px 0;
  }

  .cluster.standing .grip {
    width: auto;
    height: 22px;
  }

  .cluster.standing .grip :global(svg) {
    rotate: 90deg;
  }

  /* Beside the bar rather than over it, and never off the top or the bottom of the
     pane: a flyout belongs next to the tool that opened it whichever way the bar
     runs. */
  .cluster.standing .panel {
    align-self: flex-start;
    width: min(21rem, 60vw);
    margin-left: 0;
    margin-top: clamp(0px, calc(var(--pop) - 6rem), max(0px, calc(100% - 12rem)));
  }

  .cluster.standing .tab {
    margin-left: 0;
    margin-top: var(--space-5);
  }

  :global([data-touch]) .cluster.standing .grip {
    width: auto;
    height: 30px;
  }

  /* One row that scrolls sideways rather than a bar that hides half of itself
     behind a menu, which is what a phone needs and a tablet in portrait wants. */
  .scroller {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: stretch;
    gap: 1px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .scroller::-webkit-scrollbar {
    display: none;
  }

  button {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  /* Where there is a pointer, the bar answers it. Fifteen buttons over the plane
     and none of them said the pointer was there: the tool in hand was tinted and
     a press went to `--press`, so a hand moving across the bar looking for the
     eraser got nothing back until it clicked. Every other bar, row and button in
     the app lights on hover; this was the one that did not. */
  @media (hover: hover) {
    button:hover:not(:disabled):not(.on) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  button:active:not(:disabled) {
    background: var(--surface-press);
  }

  /* The tool in hand is tinted rather than raised: one look says which one it is,
     at a glance, from across a table. */
  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* What a button that cannot be pressed looks like is the one fade in
     base.css, not a third number here: this said 0.3 where the app says 0.4 and
     the panel's foot said 0.5. */

  .split {
    flex: none;
    width: 1px;
    align-self: center;
    height: 20px;
    margin: 0 var(--space-1);
    background: var(--line-strong);
  }

  /* A tool in hand that has a panel of its own wears a corner, so that pressing it
     again is something to be seen rather than something to be told. */
  .deeper::before {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    border: 3px solid transparent;
    border-right-color: currentColor;
    border-bottom-color: currentColor;
    border-radius: 1px;
  }

  /* A pen wears the ink it writes in as a line under it, so the row answers "which
     one is the yellow highlighter" without being opened. The hairline round it is the
     page's own ink at a whisper, so a pen writing in white is a white line on a light
     bar rather than nothing at all. */
  .pen::after {
    content: '';
    position: absolute;
    left: 20%;
    right: 20%;
    bottom: 4px;
    height: 2.5px;
    border-radius: 2px;
    background: var(--ink);
    box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--text) 30%, transparent);
  }

  /* The colour in hand, drawn as the dot it is. */
  .swatch::after {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:active::after {
    scale: 1.08;
  }

  .how-far {
    padding: 0 var(--space-2);
  }

  /* Two lines, the way a thing that moves is drawn everywhere. */
  .grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    align-self: stretch;
    border-radius: var(--radius-md);
    color: var(--muted);
    touch-action: none;
    transition: background-color var(--dur-instant) var(--ease-out);
  }

  .grip.grabbed {
    background-color: var(--accent-soft);
    color: var(--accent);
  }

  /* Folded: one pen against the edge, in from the corner so a thumb resting there
     does not open it. */
  .tab {
    align-self: flex-start;
    min-width: 58px;
    margin-left: var(--space-5);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-bottom: none;
    box-shadow: var(--shadow-md);
  }

  .cluster.top .tab {
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    border-bottom: 1px solid var(--line-strong);
    border-top: none;
  }

  /* The panel over the button that opened it, and never off the side of the pane:
     a flyout beside its own tool says what it belongs to, and the middle of the
     screen says nothing. */
  /* The shape is `.nib-layer` in the themes package, the same as the graph's own
     card and the two menus; what is here is where it pops out. */
  .panel {
    box-sizing: border-box;
    align-self: flex-start;
    width: min(21rem, 100%);
    margin-left: clamp(0px, calc(var(--pop) - 10.5rem), calc(100% - 21rem));
    padding: var(--space-2);
    animation: lift var(--dur-fast) var(--ease-out);
  }

  @keyframes lift {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }

  .cluster.top .panel {
    animation-name: sink;
  }

  @keyframes sink {
    from {
      opacity: 0;
      translate: 0 -6px;
    }
  }

  /* One scale for a finger, from the tokens, and the same bar. */
  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-width: var(--touch-target);
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .swatch::after {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  :global([data-touch]) .grip {
    --mark: var(--touch-icon);

    width: 30px;
  }

  :global([data-touch]) .tab {
    min-height: var(--touch-target);
  }
</style>
