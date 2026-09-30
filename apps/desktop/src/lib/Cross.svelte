<script lang="ts">
  /** The cross that shuts something or takes it away: a sheet, a bar, a tab, an item
   *  out of a list.
   *
   *  One drawing per size it is seen at, drawn here and nowhere else. Seven components
   *  drew their own, in five view boxes - 16, 14, 13, 10 and 8 - with the arms reaching
   *  anywhere from 43 to 75 per cent of the box, so the cross on a sheet was heavier
   *  than the one on the theme store beside it and the find bar's was smaller than
   *  both. The glyph is the one a button is: arms across half its box, which at the
   *  size of `--icon-lg` is Lucide's own `x`. The small one is for a cross inside
   *  something small - a tab, a chip - where half of an 8px box would be a dot, so its
   *  arms reach across three quarters of it.
   *
   *  How big it is and how heavy its line is are the button's, as they are for every
   *  other mark in a button; `.nib-glyph` answers both for the buttons that are only a
   *  mark. The window's own close button is not this: it is the platform's caption
   *  glyph, drawn in the platform's box beside the other two (see Titlebar.svelte). */
  const { small = false }: { small?: boolean } = $props()
</script>

{#if small}
  <svg class="nib-cross" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" /></svg>
{:else}
  <svg class="nib-cross" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg
  >
{/if}

<style>
  /* What every cross is drawn with, wherever it is. Its size and the weight of its
     line are the caller's. */
  .nib-cross {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
