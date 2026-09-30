<script lang="ts">
  /** The number each tab wears while Alt is held: a small quiet badge at the trailing
   *  bottom corner of the tab's mark, the way a KeyTip sits at a button's corner. It
   *  covers a corner of the mark and nothing of the name, so what a tab is can still be
   *  read with the numbers up. What is shown and when is numbers.svelte.ts.
   *
   *  Never read out: the keys are in the settings' list of shortcuts, and a screen
   *  reader announcing ten numbers on every Alt would be noise. */

  import { fade } from 'svelte/transition'
  import { dur } from '../motion'
  import type { Worn } from './numbers.svelte'

  const { numbers }: { numbers: { readonly worn: readonly Worn[] } } = $props()
</script>

{#each numbers.worn as one (one.id)}
  <span
    class="numeral"
    style:translate="{one.x}px {one.y}px"
    aria-hidden="true"
    in:fade={{ duration: dur(70) }}
    out:fade={{ duration: dur(70) }}>{one.label}</span
  >
{/each}

<style>
  /* Placed by a translate at the corner of the mark, and pulled back over it by most of
     its own size, so its middle sits on the corner. Quiet: the muted ink on the raised
     ground a bubble has, with the bubble's hairline. */
  .numeral {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-popover);
    display: grid;
    place-items: center;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    transform: translate(-60%, -60%);
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    box-shadow: 0 0 0 1px var(--line-strong);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    pointer-events: none;
  }

  :global(:root[dir='rtl']) .numeral {
    transform: translate(-40%, -60%);
  }
</style>
