<script lang="ts">
  /** The other hands on the plane: what each is drawing, and where each one is.
   *
   *  A note draws a thin bar in the other device's colour where its caret is, with
   *  its name above it for a moment after it moves. A plane has no line of text to
   *  put a bar in, so the same fact is said the same way in the place a plane has:
   *  a small dot in that device's accent where its pointer is, its name beside it,
   *  and the stroke under its pen drawn as it is drawn.
   *
   *  One SVG layer for all of it, inside the plane, so a pan and a zoom are the
   *  plane's own transform and nothing here is touched. SVG rather than a third 2d
   *  canvas because this is a handful of shapes that change every frame and go
   *  away again: exactly what a retained-mode layer is for, and the outline comes
   *  from `ink.ts` like every other picture of a stroke, so what is drawn here and
   *  what lands when the pen lifts are the same shape.
   *
   *  A stroke here is nobody's object yet. It is not on the plane, not in the
   *  file, and not anybody's to pick or erase; it arrives over awareness and is
   *  gone the moment that device lifts its pen. The finished stroke comes the
   *  ordinary way, once, as one whole object in the room's document. */

  import { approach, arrived } from './canvas/ease'
  import { INK_STYLES, inkOpacity, inkPath, outlineOf } from './canvas/ink'
  import type { Palette } from './canvas/paint'
  import type { Hand } from './canvas/shared'
  import { stillness } from './motion'

  const {
    hands,
    unit,
    palette,
  }: {
    hands: readonly Hand[]
    /** One screen pixel in plane units, so the dot and the name are the same size
     *  on screen at every zoom. */
    unit: number
    /** What the six preset colours are, read off the theme. */
    palette: Palette
  } = $props()

  /** How long a name stays after the hand it belongs to has stopped moving. The
   *  same second and a half a caret's name is shown for. */
  const NAMED = 1500

  /** How big the pointer is and how far its name sits from it, in screen pixels. */
  const DOT = 4
  const GAP = 9
  const LABEL = 11

  let named = $state(true)
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // A hand that moved is a hand worth naming, and after a pause the name goes and
  // the dot stays, which is what a caret does.
  $effect(() => {
    for (const one of hands) follows(one.at)
    named = true

    clearTimeout(timer)
    timer = setTimeout(() => (named = false), NAMED)
    return () => clearTimeout(timer)
  })

  function inked(colour: string): string {
    return palette[colour] ?? colour
  }

  /** How long a hand takes to close most of the gap to where it now is, in
   *  milliseconds. Short enough that a pointer is where somebody is pointing, long
   *  enough that twenty packets a second read as one movement rather than twenty. */
  const CATCHING_UP = 70

  /** Where each hand is drawn, which is not quite where its last packet said.
   *
   *  Presence arrives in packets - twenty a second on a good line, fewer on a bad
   *  one - and drawing each one where it lands makes somebody else's pointer hop
   *  across the page. So the drawn point eases towards the reported one, critically
   *  damped and frame-rate independent; see canvas/ease.ts. A reader who has asked for
   *  as little movement as possible is given the packets as they come. */
  let eased = $state.raw<Record<number, { x: number; y: number }>>({})
  let frame = 0
  let last = 0

  $effect(() => {
    // Read for its own sake, so a hand arriving or leaving restarts the loop.
    for (const one of hands) follows(one.at)

    if (stillness() || !hands.length) {
      eased = Object.fromEntries(hands.map((one) => [one.id, one.at]))
      return
    }

    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16
      last = now

      const next: Record<number, { x: number; y: number }> = {}
      let moving = false

      for (const one of hands) {
        const was = eased[one.id]
        if (!was || arrived(was, one.at, unit)) {
          next[one.id] = one.at
          continue
        }

        next[one.id] = {
          x: approach(was.x, one.at.x, dt, CATCHING_UP),
          y: approach(was.y, one.at.y, dt, CATCHING_UP),
        }
        moving = true
      }

      eased = next
      if (moving) frame = requestAnimationFrame(tick)
      else frame = 0
    }

    last = 0
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
  })

  /** Each hand as it is drawn: where it has eased to, and everything else as it came. */
  const drawn = $derived(hands.map((one) => ({ one, at: eased[one.id] ?? one.at })))
</script>

{#if hands.length}
  <svg class="hands" aria-hidden="true" width="1" height="1" style:overflow="visible">
    {#each drawn as { one: hand, at } (hand.id)}
      {#if hand.stroke}
        <!-- Open ended, because the pen has not lifted: the same outline the ink
             layers fill, drawn the one way `ink.ts` describes it. The stroke is drawn
             where it was reported and never eased: ink is a shape somebody made, and
             a shape that catches up with itself is the wrong shape. -->
        <path
          d={inkPath(outlineOf(hand.stroke, false))}
          fill={inked(hand.stroke.color)}
          fill-opacity={inkOpacity(hand.stroke)}
          style:mix-blend-mode={INK_STYLES[hand.stroke.tool].multiply ? 'multiply' : 'normal'}
        />
      {/if}

      <circle cx={at.x} cy={at.y} r={DOT * unit} fill={hand.colour} />

      {#if named}
        <text
          x={at.x + GAP * unit}
          y={at.y - GAP * unit}
          fill={hand.colour}
          font-size="{LABEL * unit}px">{hand.name}</text
        >
      {/if}
    {/each}
  </svg>
{/if}

<style>
  /* Over the cards and the ink, because a hand is in front of the page it is
     drawing on, and out of the way of every pointer: the surface above owns them
     all. */
  .hands {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  /* A name beside somebody else's caret. The fade was written as `190ms ease`,
     which is the one kind of movement in the app a reader cannot turn off:
     `--dur-*` goes to zero under prefers-reduced-motion and a bare number does
     not. */
  text {
    font-family: var(--font-ui);
    font-weight: var(--weight-strong);
    transition: opacity var(--dur-base) var(--ease-out);
  }
</style>
