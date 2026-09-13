<script lang="ts">
  /** The ink on the plane, on two 2d canvases.
   *
   *  Two, because they change at different rates. The lower one holds everything
   *  already written; the upper one holds the one stroke under the pen and is
   *  cleared and redrawn on every pointer event. A pen event therefore costs one
   *  stroke's outline, whether the plane carries five strokes or five thousand,
   *  and the first pixel lands in the same frame as the event.
   *
   *  The lower one is not redrawn while the plane is being moved. A pan and a
   *  zoom are the same picture seen from somewhere else, so the pixels already
   *  there are moved with a transform - which costs nothing, being composited -
   *  and the strokes are rasterised again once the view settles. It is painted
   *  with a margin all round, so a pan uncovers ink that was already drawn rather
   *  than an empty edge. Five thousand strokes is a sixth of a second of
   *  rasterising; doing it sixty times a second is a plane nobody can pan.
   *
   *  The upper one is asked for a desynchronised context, which is a hint the
   *  browser may take or leave; where it is taken, the ink lands under the nib
   *  rather than a frame behind it. The lower one never asks. A desynchronised
   *  layer has to be the topmost thing on the page to keep its alpha, and this
   *  one has the other layer over it; nor has it anything to gain, being drawn
   *  when the view settles rather than under the pen. Whether the upper one is
   *  given the hint is not this file's to decide: `canvas/backing.ts` says why.
   *
   *  Nothing here handles a pointer. The surface above owns every gesture and
   *  hands this component the stroke to draw, which is why these two elements can
   *  be `pointer-events: none` and never be in the way of a click. */

  import { untrack } from 'svelte'
  import type { Camera } from './camera'
  import type { InkStroke } from './canvas/format'
  import { type InkMode, inkLayer, wantedInkMode } from './canvas/backing'
  import {
    GATHERED_A_FRAME,
    inkPending,
    type Palette,
    paintInk,
    paintLive,
    type View,
  } from './canvas/paint'

  const {
    ink,
    live = null,
    camera,
    width,
    height,
    picked,
    palette,
  }: {
    ink: readonly InkStroke[]
    /** The stroke being drawn, while one is. */
    live?: InkStroke | null
    camera: Camera
    width: number
    height: number
    picked: ReadonlySet<string>
    /** What the six preset colours are, read off the theme. */
    palette: Palette
  } = $props()

  /** How far beyond the view the settled layer is painted, in pixels.
   *
   *  A pan of up to this much uncovers ink that was already drawn rather than an
   *  empty edge. Bigger is fewer rasters and a bigger texture to move every
   *  frame; this is far enough that a flick of a finger stays inside it. */
  const MARGIN = 240

  /** How far the view may be moved by a transform alone before the ink has to be
   *  drawn again whatever the hand is doing: the edge of the margin, and a zoom
   *  of half or double, past which the pixels would show. */
  const NEAREST = 0.55
  const FURTHEST = 1.8

  let below = $state<HTMLCanvasElement>()
  let above = $state<HTMLCanvasElement>()

  const ratio = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)

  /** The size of the settled layer, which is the view plus the margin. */
  const wide = $derived(Math.max(1, width + 2 * MARGIN))
  const tall = $derived(Math.max(1, height + 2 * MARGIN))

  /** The camera the settled layer was last rasterised for. */
  let painted = $state.raw<Camera | null>(null)

  /** How to move the pixels that are already there so they line up with the view
   *  as it now is. Exact for a pan, and a scale for a zoom. */
  const shift = $derived.by(() => {
    if (!painted) return { x: 0, y: 0, k: 1 }

    const k = camera.scale / painted.scale
    return {
      x: (painted.x - camera.x) * camera.scale,
      y: (painted.y - camera.y) * camera.scale,
      k,
    }
  })

  /** Which backing the live layer is drawn on. Decided before it exists, from
   *  the platform, and narrowed if the context it gets says the backing is not
   *  the one that was asked for. */
  let mode = $state<InkMode>(wantedInkMode())

  /** One context per element, kept: the attributes cannot be changed after the
   *  first call, so asking twice would silently hand back the first answer
   *  anyway. */
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D | null>()

  /** The context for a layer, in the mode wanted for it or else in the plain
   *  one. An element that answered in another mode, or with no context at all,
   *  can never answer differently, so the mode drops and the live element is
   *  keyed on it: a new element, and a new context to ask. */
  function contextOf(element: HTMLCanvasElement, wanted: InkMode): CanvasRenderingContext2D | null {
    const held = contexts.get(element)
    if (held !== undefined) return held

    const layer = inkLayer(element, wanted)
    const context = layer?.context ?? null
    contexts.set(element, context)

    // Only a layer that asked for the hint can be let down by it: the plain
    // backing is the one every browser has.
    if (wanted === 'latency' && layer?.mode !== 'latency') mode = 'plain'
    return context
  }

  /** Everything already written, drawn again for where the view is now.
   *
   *  Nothing it reads is followed: which effect asked for a raster is the
   *  question, and an effect that followed the camera through here would
   *  rasterise on every frame of a pan, which is the whole thing this avoids. */
  function rasterise() {
    untrack(() => {
      const element = below
      if (!element || !width || !height) return

      const context = contextOf(element, 'plain')
      if (!context) return

      // The layer is the view plus a margin all round, and its middle is the
      // view's middle, so the transform above works from the same point.
      const view: View = { camera, width: wide, height: tall, ratio }
      paintInk(context, ink, view, palette, picked, GATHERED_A_FRAME)
      painted = { ...camera }

      // A plane too big to gather in one frame is carried on next frame, so the
      // cards are on screen for the first of them and the ink fills in behind.
      // Everything else on the surface - the pen, a pan, a card picked up - works
      // while this is going on, because each of these frames is a short one.
      if (inkPending(ink)) {
        stillAt = moves
        filling ||= requestAnimationFrame(fill)
      }
    })
  }

  /** The frame the rest of the ink is waiting on, or nought, and what `moves` read
   *  when it was asked for. */
  let filling = 0
  let stillAt = 0

  /** The next slice of a plane that is still arriving.
   *
   *  Not while the view is moving. A pan is a transform over the pixels already
   *  there and costs nothing; gathering on the same frames put a slice of the plane
   *  into every one of them and took the worst frame of a drag from eighteen
   *  milliseconds to thirty-six. So the hand is asked rather than the clock: `moves`
   *  is what the camera effect counts, and a fill whose turn comes up while it is
   *  still climbing waits for the next frame instead. The raster `settle` runs when
   *  the hand stops carries the gather on from where this left it, so nothing is
   *  lost by waiting - and somebody dragging the plane about is not looking at the
   *  ink they have not reached yet. */
  function fill() {
    filling = 0
    if (moves !== stillAt) {
      stillAt = moves
      filling = requestAnimationFrame(fill)
      return
    }

    rasterise()
  }

  /** How many times the view has moved, and whether a frame is being waited on.
   *
   *  Counted in frames rather than in milliseconds on purpose. A clock would
   *  have to guess how long a frame is, and on the plane where this matters most
   *  the frames are exactly the ones that are too long: a timer short enough to
   *  feel instant would fire in the middle of every pan and rasterise on every
   *  frame, which is what it was there to avoid. */
  let moves = 0
  let looking = 0

  function settle() {
    moves += 1
    if (looking) return

    const look = () => {
      const seen = moves
      looking = requestAnimationFrame(() => {
        if (moves !== seen) {
          look()
          return
        }

        looking = 0
        rasterise()
      })
    }

    look()
  }

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  /** Whether this plane has been rasterised once.
   *
   *  A surface's effects flush in the task that mounted it, so a raster here is a
   *  raster inside the mount - and the first raster of a plane of ten thousand
   *  strokes is a gather. So the first one is put off to the next frame, which is
   *  the frame the plane's cards and its paper are already on screen for.
   *
   *  Only the first. A pan that reaches plane nobody has gathered yet rasterises in
   *  the frame it happens in, as it always did, or the ink would blink on every
   *  drag. */
  let everDrawn = false

  // What there is to draw changed, so it is drawn. Never waits after the first: an
  // edit has to show at once.
  $effect(() => {
    follows(ink)
    follows(picked)
    follows(palette)
    follows(wide)
    follows(tall)

    if (everDrawn) {
      rasterise()
      return
    }

    everDrawn = true
    filling ||= requestAnimationFrame(fill)
  })

  // The view moved. The pixels move with it and are drawn again once it has
  // settled, or at once when a transform alone would start to show.
  $effect(() => {
    const now = camera
    const was = untrack(() => painted)

    if (!was) {
      rasterise()
      return
    }

    const k = now.scale / was.scale
    const dx = (was.x - now.x) * now.scale
    const dy = (was.y - now.y) * now.scale

    if (Math.abs(dx) > MARGIN || Math.abs(dy) > MARGIN || k < NEAREST || k > FURTHEST) {
      cancelAnimationFrame(looking)
      looking = 0
      rasterise()
      return
    }

    // Already exactly where the pixels are: nothing to draw and nothing to wait
    // for, which is also what stops a raster from asking for another one.
    if (!dx && !dy && k === 1) return

    settle()
  })

  $effect(() => () => {
    cancelAnimationFrame(looking)
    cancelAnimationFrame(filling)
  })

  /** Whether the upper layer has anything on it. An empty one is left alone
   *  rather than cleared: clearing it is a whole texture handed to the compositor
   *  again, and doing that on every frame of a pan costs as much as the ink it
   *  was there to keep cheap. */
  let inked = false

  $effect(() => {
    const element = above
    const one = live
    // Read before the camera, so a layer with nothing on it does not follow it.
    if (!element || (!one && !inked)) return

    const context = contextOf(element, mode)
    if (!context) return

    paintLive(context, one, { camera, width, height, ratio }, palette)
    inked = one !== null
  })
</script>

<canvas
  class="ink settled"
  bind:this={below}
  width={Math.round(wide * ratio)}
  height={Math.round(tall * ratio)}
  style:left="{-MARGIN}px"
  style:top="{-MARGIN}px"
  style:width="{wide}px"
  style:height="{tall}px"
  style:transform={shift.k === 1
    ? `translate(${shift.x}px, ${shift.y}px)`
    : `translate(${shift.x}px, ${shift.y}px) scale(${shift.k})`}
  aria-hidden="true"
></canvas>

<!-- Keyed on the backing, because an element keeps the context it was first
     given: the only way to ask for another one is another element. -->
{#key mode}
  <canvas
    class="ink live"
    bind:this={above}
    width={Math.max(1, Math.round(width * ratio))}
    height={Math.max(1, Math.round(height * ratio))}
    style:width="{width}px"
    style:height="{height}px"
    aria-hidden="true"
  ></canvas>
{/key}

<style>
  /* Over the cards, because writing on a page goes on top of what is printed
     there, and out of the way of every pointer, because the surface above owns
     them all. */
  .ink {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 3;
  }

  /* Its own layer, so moving it while the plane is panned is a composite and
     never a repaint. */
  .settled {
    transform-origin: center;
    will-change: transform;
  }

  .live {
    z-index: 4;
  }
</style>
