<script lang="ts">
  /** A Lucide mark, stroked: what Icon.svelte draws for a fallback, without the three
   *  icon sets behind it, which the global quick add window has no use for and would
   *  carry into the one page that has to open in a blink. */
  import type { IconNode } from '../icons'

  const { icon }: { icon: IconNode } = $props()
</script>

<svg viewBox="0 0 24 24" aria-hidden="true">
  {#each icon as [tag, attrs] (JSON.stringify(attrs))}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  svg {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
