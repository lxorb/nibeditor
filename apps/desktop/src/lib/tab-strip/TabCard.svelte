<script lang="ts">
  /** The card under a tab the pointer rests on: its whole name, where it lives, and
   *  the page as it was left. What it says and when is hover-card.svelte.ts; this is
   *  how it looks, which is the bubble every sentence in the app appears in, at the
   *  width of Chrome's card - its standard tab.
   *
   *  Read and never pressed, and never read out: the tab under it already carries its
   *  name for a screen reader, which is why Chrome's card has no role either. */

  import { cubicOut } from 'svelte/easing'
  import { fade, fly } from 'svelte/transition'
  import { dur } from '../motion'
  import type { Shown } from './hover-card.svelte'

  const { hovering }: { hovering: { readonly card: Shown | null } } = $props()

  const card = $derived(hovering.card)
</script>

{#if card}
  <div
    class="nib-bubble card"
    class:sliding={card.sliding}
    style:translate="{card.x}px {card.y}px"
    aria-hidden="true"
    in:fly={{ y: -4, duration: dur(150), easing: cubicOut }}
    out:fade={{ duration: dur(120) }}
  >
    <!-- The words change as the card slides from one tab to the next, crossing
         over rather than jumping. -->
    {#key card.id}
      <div class="words" in:fade={{ duration: dur(120) }}>
        <strong class="name">{card.title}</strong>
        {#if card.where}<span class="where">{card.where}</span>{/if}
      </div>
    {/key}
    {#if card.still}
      <img class="still" src={card.still} alt="" draggable="false" />
    {/if}
  </div>
{/if}

<style>
  /* The card is `.nib-bubble`; what is here is where it hangs, how wide it is, and
     the still running to its edges. Placed by a translate so that sliding from one tab
     to the next is one eased movement, at Chrome's pace. */
  .card {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-popover);
    width: 16rem;
    overflow: hidden;
  }

  .card.sliding {
    transition: translate var(--dur-base) var(--ease-out);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  /* Two lines at most, as Chrome's: past that the name is not what is being read. */
  .name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    unicode-bidi: isolate;
  }

  .where {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  /* Sixteen by nine, from the top of the page, to the card's edges. */
  .still {
    display: block;
    width: calc(100% + 2 * var(--space-3));
    aspect-ratio: 16 / 9;
    margin: var(--space-2) calc(-1 * var(--space-3)) calc(-1 * var(--space-2));
    object-fit: cover;
    object-position: top;
    border-top: 1px solid var(--line-strong);
  }
</style>
