<script lang="ts">
  /** The sheet that is not there yet: where the next page would go, at the end of
   *  the column.
   *
   *  It is one shape in three states and never three shapes. At rest it sits after
   *  the last page, quiet, a dashed outline with a plus in it - which is what makes
   *  adding a page something a reader finds rather than something they are told.
   *  While a pull is under way it is the same outline coming up out from under the
   *  last sheet, filling in as it reaches. Past the threshold it is solid and the
   *  colour of paper, which is the page it is about to be: letting go changes
   *  nothing on screen but the dashes, because the real sheet lands in exactly this
   *  box. See `slot` in pages/store.svelte.ts, which is where that box comes from,
   *  and pull.ts for the arithmetic.
   *
   *  Nothing here handles a pointer. The surface above owns every gesture on a page
   *  note - a press on this box is read there, beside the press that lands on a
   *  sheet - so the whole silhouette is inert and can never be in the way of a
   *  stroke. The same rule PagesPage.svelte follows.
   *
   *  Everything drawn in it is sized in plane units off `unit`, so the outline, the
   *  plus and the words are the same size on screen at every zoom: this is a thing
   *  to press rather than something printed on the paper. */

  import { t } from './i18n.svelte'

  const {
    box,
    unit,
    rise,
    reach,
    pulling,
  }: {
    /** Where the next sheet would go, in plane units. */
    box: { x: number; y: number; width: number; height: number }
    /** One screen pixel in plane units, so what is drawn on this keeps its size. */
    unit: number
    /** How far the pull has brought it up, in screen pixels. Nought at rest. */
    rise: number
    /** How far it has to come before letting go makes a page, in screen pixels. */
    reach: number
    /** Whether a pull is under way at all, which is what turns the words from an
     *  offer into an instruction. */
    pulling: boolean
  } = $props()

  /** How much of the band at the top of the silhouette is in reach at rest, in
   *  screen pixels. The same number the view's own stop is worked out from, so the
   *  words and the plus are exactly what the end of the column shows. */
  const BAND = 88

  /** How far along the pull is, for the fill and the plus: one at the threshold
   *  and no further. */
  const part = $derived(reach > 0 ? Math.min(1, rise / reach) : 0)
  const ready = $derived(rise >= reach && reach > 0)

  /** What it says. An offer at rest, and while the reader is pulling the one thing
   *  they need to know: how much further, and then that it is far enough. */
  const words = $derived(
    !pulling ? t('Add a page') : ready ? t('Release to add a page') : t('Pull to add a page'),
  )
</script>

<div
  class="slot"
  class:pulling
  class:ready
  style:left="{box.x}px"
  style:top="{box.y}px"
  style:width="{box.width}px"
  style:height="{box.height}px"
  style:--unit={unit}
  style:--part={part}
  style:--band="{Math.min(BAND * unit, box.height)}px"
  aria-hidden="true"
>
  <div class="mark">
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    <span>{words}</span>
  </div>
</div>

<style>
  /* The same box the real sheet will have, drawn as an outline rather than as
     paper. The border and the radius are in plane units so the dashes are the
     same dashes at every zoom, and the fill arrives with the pull. */
  .slot {
    position: absolute;
    border: calc(1px * var(--unit)) dashed var(--line-strong);
    border-radius: calc(3px * var(--unit));
    background: color-mix(in srgb, var(--surface) calc(var(--part) * 100%), transparent);
    opacity: calc(0.45 + 0.55 * var(--part));
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }

  /* Far enough: solid, and the colour of paper. The border stops being a
     suggestion, which is the whole of what "let go now" looks like. */
  .slot.ready {
    border-style: solid;
    border-color: var(--accent);
    background: var(--surface);
    opacity: 1;
  }

  /* The plus and the words, in the band the end of the column shows: at the top of
     the silhouette rather than in the middle of it, because at rest the top is all
     there is to see. */
  .mark {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(6px * var(--unit));
    height: var(--band);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: calc(12px * var(--unit));
    line-height: 1.2;
    text-align: center;
    user-select: none;
  }

  .slot.ready .mark {
    color: var(--accent);
  }

  /* Small at rest and full size by the threshold, which is the one thing on here
     that says how far the pull has come without a number. */
  .mark svg {
    width: calc(20px * var(--unit));
    height: calc(20px * var(--unit));
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
    stroke-linecap: round;
    scale: calc(0.62 + 0.38 * var(--part));
    transition: scale var(--dur-fast) var(--ease-out);
  }

  .slot.ready .mark svg {
    scale: 1;
    transition: scale var(--dur-base) var(--ease-spring);
  }
</style>
