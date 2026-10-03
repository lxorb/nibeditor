<script lang="ts">
  /** The number each tab wears while Alt is held: a KeyTip at the trailing bottom corner
   *  of the tab's mark. It covers a corner of the mark and nothing of the name, so what a
   *  tab is can still be read with the numbers up. What is shown and when is
   *  numbers.svelte.ts; the look is `.nib-keytip`, which a space's number wears too.
   *
   *  Never read out: the keys are in the settings' list of shortcuts, and a screen
   *  reader announcing ten numbers on every Alt would be noise. */

  import { keytipIn, keytipOut } from '../keytip'
  import type { Worn } from './numbers.svelte'

  const { numbers }: { numbers: { readonly worn: readonly Worn[] } } = $props()
</script>

{#each numbers.worn as one (one.id)}
  <span
    class="nib-keytip numeral"
    style:translate="{one.x}px {one.y}px"
    aria-hidden="true"
    in:keytipIn
    out:keytipOut>{one.label}</span
  >
{/each}

<style>
  /* Placed by a translate at the corner of the mark, and pulled back over it by most of
     its own size, so its middle sits on the corner. */
  .numeral {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-popover);
    transform: translate(-60%, -60%);
  }

  :global(:root[dir='rtl']) .numeral {
    transform: translate(-40%, -60%);
  }
</style>
