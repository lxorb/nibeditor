<script lang="ts">
  /** The card that follows the pointer while a row is carried: its words, lifted with
   *  the canvas's shadow and tilted a little, the way a card picked up off a board is.
   *  One for the whole window, wherever the row was picked up. */
  import { scale } from 'svelte/transition'
  import { dur } from '../motion'
  import { dragging } from './drag.svelte'
</script>

{#if dragging.row}
  <div
    class="ghost"
    style:translate={`${dragging.x + 12}px ${dragging.y + 8}px`}
    transition:scale={{ start: 0.94, duration: dur(130) }}
    aria-hidden="true"
  >
    {dragging.label}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-carried);
    max-width: 280px;
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    text-overflow: ellipsis;
    white-space: nowrap;
    rotate: 1.5deg;
    pointer-events: none;
  }
</style>
