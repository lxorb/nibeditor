<script lang="ts">
  /** An agent's mark: the spark every assistant in nib wears, filled with the agent's
   *  own colour, which is its caret's and its frame's too. Turning while it acts,
   *  still and muted while it is paused; see marks.ts for which is which. */
  import { ASK_MARK } from '../../panel-marks'

  const {
    colour,
    turning = false,
    paused = false,
  }: { colour: string; turning?: boolean; paused?: boolean } = $props()
</script>

<svg
  class="spark"
  class:turning={turning && !paused}
  class:paused
  viewBox="0 0 13 13"
  style:--spark={colour}
  aria-hidden="true"
>
  <path d={ASK_MARK} />
</svg>

<style>
  .spark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    fill: var(--spark);
    stroke: var(--spark);
    stroke-width: 0.6;
    stroke-linejoin: round;
    transition:
      fill var(--dur-base) var(--ease-out),
      stroke var(--dur-base) var(--ease-out);
  }

  .paused {
    fill: var(--muted);
    stroke: var(--muted);
  }

  /* The loading mark's own turn, a turn a second, so an agent at work reads as the
     same kind of waiting a page on its way does. */
  .turning {
    animation: turn 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .turning {
      animation: none;
    }
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
</style>
