<script lang="ts">
  /** Every change the thread made that the reader has not kept (`/diff`, or the bar
   *  pressed): each note with its changes, each with Keep and Undo, and the note's
   *  own pair for all of its changes. A row pressed shows the change in its note.
   *
   *  Keys, Claude Code's and Cursor's: J and K (or the arrows) walk the changes, Y
   *  keeps the lit one, N undoes it, Enter shows it, Escape puts the list away. */
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { Change, NoteChanges } from './changes'
  import { review } from './review.svelte'
  import Tally from './Tally.svelte'
  import { snippetOf, titleOf } from './words'

  const { notes }: { notes: NoteChanges[] } = $props()

  const rows = $derived(notes.flatMap((note) => note.changes))
  let lit = $state(0)
  let list = $state<HTMLElement>()

  $effect(() => {
    if (lit >= rows.length) lit = Math.max(0, rows.length - 1)
  })

  onMount(() => list?.focus())

  function keys(event: KeyboardEvent) {
    const change = rows[lit]
    const key = event.key.toLowerCase()
    if (key === 'j' || key === 'arrowdown') lit = Math.min(rows.length - 1, lit + 1)
    else if (key === 'k' || key === 'arrowup') lit = Math.max(0, lit - 1)
    else if (key === 'y' && change) review.keep([change])
    else if (key === 'n' && change) void review.undo([change])
    else if (key === 'enter' && change) void review.show(change)
    else if (key === 'escape') review.listing = null
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  function litOf(change: Change): boolean {
    return rows[lit]?.id === change.id
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div
  class="changes"
  role="list"
  tabindex="0"
  bind:this={list}
  onkeydown={keys}
  transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
>
  {#each notes as note (`${note.agent}\n${note.path}`)}
    <div class="note" role="listitem">
      <div class="line">
        <button
          class="nib-row is-short name"
          onclick={() => note.changes[0] && void review.show(note.changes[0])}
        >
          <span class="nib-row-label">{titleOf(note.path)}</span>
          <Tally added={note.added} removed={note.removed} />
        </button>
        <button class="nib-row is-short act" onclick={() => void review.undo(note.changes)}
          >{t('Undo')}</button
        >
        <button class="nib-row is-short act keep" onclick={() => review.keep(note.changes)}
          >{t('Keep')}</button
        >
      </div>
      {#each note.changes as change (change.id)}
        <div class="line change">
          <button
            class="nib-row is-short name"
            class:is-on={litOf(change)}
            onclick={() => {
              lit = rows.indexOf(change)
              void review.show(change)
            }}
          >
            <span class="nib-row-label" class:is-gone={!change.spots.some((one) => one.inserted)}
              >{snippetOf(change)}</span
            >
            <Tally added={change.added} removed={change.removed} />
          </button>
          <button class="nib-row is-short act" onclick={() => void review.undo([change])}
            >{t('Undo')}</button
          >
          <button class="nib-row is-short act keep" onclick={() => review.keep([change])}
            >{t('Keep')}</button
          >
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .changes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 40vh;
    overflow: auto;
    margin-block-end: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .change .name {
    padding-inline-start: var(--row-indent);
  }

  .name {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .act {
    flex: none;
    width: auto;
  }

  .keep {
    color: var(--success);
  }

  .is-gone {
    color: var(--danger);
    text-decoration: line-through;
  }
</style>
