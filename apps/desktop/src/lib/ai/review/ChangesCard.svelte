<script lang="ts">
  /** What the thread changed and the reader has not kept, as a card at the end of the
   *  conversation (docs/ai-sidebar.md 4.1, 4.5): Codex's "files changed" under the turn
   *  that made them. Its head says how many notes, by how many lines, with Undo and Keep
   *  for all of it; under it each note with its own pair, and pressed (or `/diff`) every
   *  change of every note, each with its pair too.
   *
   *  Drawn only once the answer is done, so nothing moves under a press while the agent
   *  works (Cursor's readers' complaint): the edit rows say what is changing meanwhile. */
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { plural, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { Thread } from '../chat/types'
  import Changes from './Changes.svelte'
  import { review } from './review.svelte'
  import Tally from './Tally.svelte'

  const { thread }: { thread: Thread } = $props()

  const notes = $derived(review.notes(thread))
  const all = $derived(notes.flatMap((note) => note.changes))
  const files = $derived(review.files(thread))
  const waiting = $derived(all.length + files.length)
  const added = $derived(notes.reduce((sum, note) => sum + note.added, 0))
  const removed = $derived(notes.reduce((sum, note) => sum + note.removed, 0))
  const listing = $derived(review.listing === thread.id && waiting > 0)

  function toggle() {
    review.listing = listing ? null : thread.id
  }
</script>

{#if waiting}
  <div class="card" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    <div class="bar">
      <button class="nib-row is-short what" aria-expanded={listing} onclick={toggle}>
        <span class="nib-row-label"
          >{review.said ??
            plural(notes.length + files.length, {
              one: '{count} note',
              other: '{count} notes',
            })}</span
        >
        <Tally {added} {removed} />
      </button>
      <button
        class="nib-chip is-quiet"
        onclick={() => {
          void review.undo(all)
          void review.undoFiles(thread, files)
        }}>{t('Undo')}</button
      >
      <button
        class="nib-chip"
        onclick={() => {
          review.keep(all)
          review.keepFiles(files)
        }}>{t('Keep')}</button
      >
    </div>
    <Changes {notes} {files} {thread} open={listing} />
  </div>
{/if}

<style>
  /* Codex's card: a hairline round the head and its notes, the head on the panel's
     second ground. */
  /* Its own height in the conversation's column: clipped round its corners, it would
     otherwise be squeezed as the thread outgrows the room. */
  .card {
    flex: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--surface-2);
  }

  .what {
    flex: 1;
    width: auto;
    min-width: 0;
  }
</style>
