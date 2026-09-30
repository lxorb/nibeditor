<script lang="ts">
  /** A row of colours as dots, the way GNOME and a Mac offer an accent: in Settings
   *  wherever a theme offers a colour, and at the foot of the theme picker. One row
   *  everywhere, so the dots are the same size, the same ring and the same order
   *  wherever a colour is chosen.
   *
   *  Each dot is drawn in the shade the scheme on screen needs, which the caller has
   *  already picked. `onpoint` is the picker's: a dot under the pointer is tried on
   *  the whole app, and null gives the kept one back. */
  import type { SwatchOption } from './preferences'

  const {
    options,
    label,
    chosen,
    onchoose,
    onpoint,
  }: {
    options: SwatchOption[]
    label: string
    chosen: string
    onchoose: (value: string) => void
    onpoint?: ((value: string | null) => void) | undefined
  } = $props()
</script>

<div class="swatches" role="group" aria-label={label} onpointerleave={() => onpoint?.(null)}>
  {#each options as one (one.value)}
    <button
      type="button"
      class="swatch"
      class:active={chosen === one.value}
      title={one.label}
      aria-label={one.label}
      aria-pressed={chosen === one.value}
      style:--swatch={one.colour}
      onpointermove={() => onpoint?.(one.value)}
      onclick={() => onchoose(one.value)}
    ></button>
  {/each}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    cursor: default;
    /* Only the swatch under the pointer moves, and it moves plainly. The ring
       marking the chosen one is a state rather than a movement, so it is left
       out of the transition: it should appear, not grow. */
    transition: transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .swatch:hover {
      transform: scale(1.12);
    }
  }

  /* A ring rather than a tick: the colour is the whole point of the control. */
  .swatch.active {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--swatch);
  }

  /* A thumb's worth each, on a touch screen. */
  :global([data-touch]) .swatches {
    gap: 12px;
  }

  :global([data-touch]) .swatch {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
