<script lang="ts">
  /** The arrow a swipe brings in from the side of a pane: Chrome's, in nib's own
   *  colours. A circle with an arrow in it slides in with the fingers, 146 pixels by the
   *  time letting go would go and a little further past that, eased so it stops. A ring
   *  round its edge fills with the accent as the fingers go, so how far is left is in
   *  sight; full, the circle fills with it, the arrow in it gives one small push, and
   *  letting go goes. It bursts once and goes when the swipe goes, and slides back out
   *  when it stays. Between two steps it glides the shortest of the app's moves, so a
   *  page's steps, which come across the engine a frame apart and not always evenly,
   *  read as one movement. See swipes.ts, and gesture_nav_simple.cc in Chromium for the
   *  numbers.
   *
   *  Over a web tab the page is a webview drawn above every pixel of the window, so the
   *  circle is cut out of the page in its own shape (`nib-swipe` is one of the shapes
   *  covers.ts looks for) and the page stays where it is round it. */
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import { swiping } from './shown.svelte'

  /** How far the circle has come in at the moment letting go would go, and how much
   *  further it may go past that. */
  const TRAVEL = 146
  const EXTRA = 72
  /** The circle's diameter. */
  const SIZE = 40

  /** Chrome's fast-out-slow-in, for the stretch past the threshold. */
  const eased = (t: number) => 1 - (1 - t) ** 3

  /** How far in from the side the circle's leading edge is. */
  const reach = $derived.by(() => {
    const progress = Math.max(0, swiping.progress)
    if (swiping.stage === 'stayed') return 0
    if (progress <= 1) return progress * TRAVEL
    return TRAVEL + EXTRA * eased(Math.min(1, progress - 1))
  })

  const shift = $derived(
    swiping.side === 'left' ? reach - SIZE : (swiping.room?.width ?? 0) - reach,
  )

  /** Faded in over the first third of the way, and out as it plays out. */
  const shade = $derived(swiping.stage === 'tracking' ? Math.min(1, swiping.progress * 3) : 0)

  /** How much of the ring is filled: the way to where letting go goes. */
  const filled = $derived(Math.min(1, Math.max(0, swiping.progress)))
</script>

{#if swiping.room}
  <div
    class="track"
    style:left="{swiping.room.x}px"
    style:top="{swiping.room.y}px"
    style:width="{swiping.room.width}px"
    style:height="{swiping.room.height}px"
    aria-hidden="true"
  >
    <div
      class="nib-swipe"
      class:armed={swiping.progress >= 1 || swiping.stage === 'went'}
      class:went={swiping.stage === 'went'}
      class:stayed={swiping.stage === 'stayed'}
      class:right={swiping.side === 'right'}
      style:transform="translate({shift}px, -50%)"
      style:opacity={shade}
    >
      <svg class="ring" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" pathLength="1" style:stroke-dashoffset={1 - filled} />
      </svg>
      <svg class="arrow" viewBox="0 0 24 24">
        {#each ArrowLeft as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    </div>
  </div>
{/if}

<style>
  /* The pane's content, which the circle is clipped to: it comes in from beyond the
     side, never from over the file list. */
  .track {
    position: fixed;
    z-index: var(--z-float);
    overflow: hidden;
    pointer-events: none;
  }

  /* Chrome's forty pixels. The corner is half of it in pixels rather than a
     percentage, because it is also the shape the page is cut in; see covers.ts. */
  .nib-swipe {
    --size: 40px;
    position: absolute;
    top: 50%;
    left: 0;
    display: grid;
    place-items: center;
    width: var(--size);
    height: var(--size);
    border: 1px solid var(--line-strong);
    border-radius: calc(var(--size) / 2);
    background: var(--surface-3);
    box-shadow: var(--shadow-md);
    color: var(--accent);
    transition:
      transform var(--dur-instant) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .arrow {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .nib-swipe.right .arrow {
    transform: scaleX(-1);
  }

  /* The way to where letting go goes, filled from the top towards the side the arrow
     points. Inside the circle, so the shape a page is cut in stays the circle's. */
  .ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg) scaleY(-1);
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 1;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .nib-swipe.right .ring {
    transform: rotate(-90deg);
  }

  .armed .ring {
    opacity: 0;
  }

  .armed .arrow {
    scale: 1.15;
  }

  /* Past the point where letting go goes: the circle takes the accent, as Chrome's
     turns blue. */
  .nib-swipe.armed {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* Gone: one burst, and out. */
  .nib-swipe.went {
    scale: 1.2;
    transition:
      opacity var(--dur-base) var(--ease-out),
      scale var(--dur-base) var(--ease-out);
  }

  /* Stayed: back out the way it came. */
  .nib-swipe.stayed {
    transition:
      transform var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }
</style>
