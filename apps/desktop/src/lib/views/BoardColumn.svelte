<script lang="ts">
  /** One column's cards, scrolling on their own, with only the cards on screen mounted:
   *  every card is one height, so where one sits is arithmetic (row-window.ts) and a
   *  column of two thousand costs the dozen a reader can see. */
  import { type Row, rowId } from '@nib/bases'
  import { untrack, type Snippet } from 'svelte'
  import { windowFor } from '../row-window'
  import { ListView } from '../row-window.svelte'

  const {
    rows,
    height,
    card,
  }: {
    rows: readonly Row[]
    /** One card's height, gap included. */
    height: number
    card: Snippet<[Row]>
  } = $props()

  let list = $state<HTMLElement>()
  const win = new ListView()
  $effect(() => {
    const box = list
    if (!box) return
    const tall = height
    return untrack(() => win.follow(box, () => tall))
  })

  const shown = $derived(
    windowFor({ count: rows.length, height, top: win.top, room: win.room || 800, overscan: 4 }),
  )
</script>

<div class="scroll">
  <div
    class="cards"
    bind:this={list}
    style:padding-top="{shown.above}px"
    style:padding-bottom="{shown.below}px"
    style:--card={`${height}px`}
  >
    {#each rows.slice(shown.first, shown.last + 1) as row (`${row.space}:${rowId(row)}`)}
      <div class="slot">{@render card(row)}</div>
    {/each}
  </div>
</div>

<style>
  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--space-2);
  }

  .cards {
    min-height: var(--row-height);
  }

  .slot {
    height: var(--card);
  }
</style>
