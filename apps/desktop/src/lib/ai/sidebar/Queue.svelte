<script lang="ts">
  /** What waits behind a running answer (Enter while it runs), Copilot's and Cursor's
   *  queue: each message a row over the field, sent in order when the answer is done.
   *  Dragged to reorder; pressed to take it back into the field and change it; its arrow
   *  sends it into the running answer now (Steer); its cross takes it away. A stop
   *  pauses the queue rather than emptying it. */
  import { cubicOut } from 'svelte/easing'
  import { flip } from 'svelte/animate'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { chat } from './chat.svelte'

  const queue = $derived(chat.queue)
  let dragging = $state<number | null>(null)

  function onDrop(event: DragEvent, to: number) {
    event.preventDefault()
    if (dragging !== null && dragging !== to) chat.moveQueued(dragging, to)
    dragging = null
  }
</script>

{#if queue.length}
  <ol class="queue">
    {#each queue as one, index (one.id)}
      <li
        class="queued"
        class:dragging={dragging === index}
        draggable="true"
        ondragstart={() => (dragging = index)}
        ondragend={() => (dragging = null)}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => onDrop(event, index)}
        animate:flip={{ duration: dur(150) }}
        transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
      >
        <svg class="grip" viewBox="0 0 13 13" aria-hidden="true"
          ><path d="M3.5 4h6M3.5 6.5h6M3.5 9h6" /></svg
        >
        <button class="words" title={t('Edit')} onclick={() => chat.editQueued(one.id)}
          >{one.text}</button
        >
        <button
          class="nib-glyph small"
          title={t('Send into the running answer')}
          aria-label={t('Send into the running answer')}
          onclick={() => chat.steerQueued(one.id)}
        >
          <svg viewBox="0 0 13 13"><path d="M6.5 10.6V2.6M3.2 5.9l3.3-3.3 3.3 3.3" /></svg>
        </button>
        <button
          class="nib-glyph small"
          title={t('Remove')}
          aria-label={t('Remove')}
          onclick={() => chat.unqueue(one.id)}
        >
          <svg viewBox="0 0 13 13"><path d="M3.5 3.5l6 6M9.5 3.5l-6 6" /></svg>
        </button>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .queue {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .queued {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding-inline-start: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .queued.dragging {
    opacity: 0.4;
  }

  .grip {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: var(--faint);
    stroke-width: 1.3;
    stroke-linecap: round;
  }

  .words {
    flex: 1;
    min-width: 0;
    padding: 3px 4px;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .small {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .small svg {
    stroke-width: 1.3;
  }
</style>
