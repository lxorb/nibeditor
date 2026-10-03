<script lang="ts">
  /** The changes bar over the field (docs/ai-sidebar.md 4.1, 4.5): how many notes the
   *  thread changed that the reader has not kept, by how many lines, and Undo and Keep
   *  for all of it. Pressed, the list of every change opens over it. Nothing at all
   *  while nothing waits, and the two buttons never move while the agent works, so a
   *  press meant for one cannot land on the other (Cursor's readers' complaint).
   *
   *  Also where the rewind sheet is drawn for the thread, and where Redo waits after
   *  a rewind until the next message. The panel draws this with the open thread, the
   *  live one the engine writes into, and itself (lib/ai/sidebar/seams.ts). */
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { plural, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { Thread } from '../chat/types'
  import Changes from './Changes.svelte'
  import Rewind from './Rewind.svelte'
  import { review, type ReviewPanel } from './review.svelte'
  import Tally from './Tally.svelte'

  const { thread, panel = null }: { thread: Thread; panel?: ReviewPanel | null } = $props()

  const notes = $derived(review.notes(thread))
  const all = $derived(notes.flatMap((note) => note.changes))
  const added = $derived(notes.reduce((sum, note) => sum + note.added, 0))
  const removed = $derived(notes.reduce((sum, note) => sum + note.removed, 0))
  const listing = $derived(review.listing === thread.id && all.length > 0)
  const sheet = $derived(review.sheet?.thread.id === thread.id ? review.sheet : null)
  const redo = $derived(review.canRedo(thread))

  function toggle() {
    review.listing = listing ? null : thread.id
  }
</script>

{#if sheet}
  <Rewind {sheet} />
{:else if listing}
  <Changes {notes} />
{/if}

{#if all.length || redo}
  <div class="bar" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    {#if all.length}
      <button class="nib-row is-short what" aria-expanded={listing} onclick={toggle}>
        <svg class="mark" viewBox="0 0 13 13" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4.6" />
          <path d="M6.5 1.9a4.6 4.6 0 0 1 0 9.2z" />
        </svg>
        <span class="nib-row-label"
          >{review.said ??
            plural(notes.length, { one: '{count} note', other: '{count} notes' })}</span
        >
        <Tally {added} {removed} />
      </button>
      <button class="nib-chip is-quiet" onclick={() => void review.undo(all)}>{t('Undo')}</button>
      <button class="nib-chip" onclick={() => review.keep(all)}>{t('Keep')}</button>
    {:else}
      <span class="what"></span>
    {/if}
    {#if redo}
      <button class="nib-chip is-quiet" onclick={() => void review.putBack(thread, panel)}
        >{t('Redo')}</button
      >
    {/if}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .what {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .mark {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: var(--success);
    stroke-width: 1.3;
  }

  .mark path {
    fill: var(--success);
    stroke: none;
  }
</style>
