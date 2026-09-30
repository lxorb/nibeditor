<script lang="ts">
  /** What a pull looks like while it is happening: one quiet mark at the top of
   *  the surface that grows with the thumb and fills in when letting go would do
   *  something.
   *
   *  A mark rather than a word, because the gesture is not a sentence and the
   *  command's own name would be a label to read with a thumb over it. What it
   *  says it will do is said the only way a gesture ever says anything: by
   *  happening, which the reader sees the moment they let go.
   *
   *  Nothing moves by itself here. The mark's position is the distance the finger
   *  has pulled, so a reader who has asked for as little movement as possible
   *  still sees it follow their own hand - what `stillness` takes away is the
   *  growing, which is the part the app animates rather than the part the reader
   *  is doing. */
  import { pull, REACH } from './pull.svelte'
  import { stillness } from './motion'
  import { nameFor } from './toolbar.svelte'

  const at = $derived(pull.at)
  const ready = $derived(pull.ready)
  /** How far along the pull is, for the ring: one at the reach and no further. */
  const part = $derived(Math.min(1, at / REACH))
  const still = stillness()
</script>

{#if at > 0}
  <div
    class="pull"
    role="status"
    aria-label={nameFor(pull.id)}
    style:--at="{Math.round(at)}px"
    style:--part={still ? 1 : part}
    class:ready
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <!-- The ring fills as the pull reaches, drawn as one dash round a circle:
           the same trick the sync gear uses for a pass in flight. -->
      <circle class="track" cx="12" cy="12" r="10.5" />
      <circle class="filling" cx="12" cy="12" r="10.5" />
      <path class="arrow" d="M12 7.5v9M8.5 13l3.5 3.5 3.5-3.5" />
    </svg>
  </div>
{/if}

<style>
  /* At the top of the window, under the header, coming down with the finger. On
     the surface rather than over the note's first line: a mark in the middle of
     the words would be a mark on the words. */
  .pull {
    position: fixed;
    top: calc(var(--header-height) + var(--inset-top));
    left: 50%;
    translate: -50% calc(var(--at) - 50%);
    z-index: var(--z-float);
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--surface-3);
    box-shadow: var(--shadow-sm);
    pointer-events: none;
  }

  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    rotate: 0deg;
  }

  .track {
    stroke: var(--line-strong);
  }

  /* Drawn from the top, clockwise, as much of the circle as the pull has come. */
  .filling {
    stroke: var(--accent);
    stroke-dasharray: 66;
    stroke-dashoffset: calc(66 - 66 * var(--part));
    rotate: -90deg;
    transform-origin: 50% 50%;
  }

  .arrow {
    stroke: var(--muted-strong);
  }

  /* Far enough: the mark says so by filling rather than by growing, so the
     answer is the same for a reader who has asked for no movement. */
  .ready {
    background: var(--accent);
  }

  .ready .track,
  .ready .filling {
    stroke: transparent;
  }

  .ready .arrow {
    stroke: var(--accent-ink);
  }
</style>
