<script lang="ts">
  /** A number set by dragging, or nudged one step at a time.
   *
   *  Every dial in the canvas panels is this one: the reading first so a column of
   *  them lines up, then a minus, the slider, and a plus. The two buttons are what
   *  a thumb uses when the slider is too fine to land on, which at a width of half
   *  a unit it is, and they are also the whole of how a dial is set without a
   *  pointing device at all. */

  import CanvasIcon from './CanvasIcon.svelte'
  import { MARKS } from './canvas/glyphs'
  import { t } from './i18n.svelte'

  const {
    value,
    least,
    most,
    step,
    label,
    reading,
    onvalue,
  }: {
    value: number
    least: number
    most: number
    step: number
    /** What the dial is, read out. */
    label: string
    /** The value in words, which is a width in units or an alpha in per cent. */
    reading: string
    onvalue: (value: number) => void
  } = $props()

  const fill = $derived(((value - least) / (most - least)) * 100)

  function by(steps: number) {
    onvalue(Math.min(most, Math.max(least, Math.round((value + steps * step) / step) * step)))
  }
</script>

<div class="dial">
  <span class="reading">{reading}</span>

  <button
    type="button"
    title={t('Less')}
    aria-label={t('Less')}
    disabled={value <= least}
    onclick={() => by(-1)}
  >
    <CanvasIcon node={MARKS.zoomOut} />
  </button>

  <input
    class="nib-slider"
    type="range"
    min={least}
    max={most}
    {step}
    {value}
    aria-label={label}
    style:--fill="{fill}%"
    oninput={(event) => onvalue(Number(event.currentTarget.value))}
  />

  <button
    type="button"
    title={t('More')}
    aria-label={t('More')}
    disabled={value >= most}
    onclick={() => by(1)}
  >
    <CanvasIcon node={MARKS.zoomIn} />
  </button>
</div>

<style>
  .dial {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* The number first, so a column of dials lines up down the left however wide
     the panel is. */
  .reading {
    flex: none;
    width: 3rem;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  input {
    flex: 1;
    min-width: 0;
  }

  button {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition: background var(--dur-instant) var(--ease-out);
  }

  button:active:not(:disabled) {
    background: var(--press);
  }

  :global([data-touch]) button {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
