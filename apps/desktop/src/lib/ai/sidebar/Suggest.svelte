<script lang="ts">
  /** The list over the field that `@` and `/` open: the matches for what has been typed
   *  since, the first one lit, arrows to move, Enter or Tab to take one. The keys are
   *  the field's (Composer.svelte); this only draws and answers the pointer. A row that
   *  cannot be taken here is dim, with the reason on hover, rather than missing, so the
   *  list is the same whoever answers. */
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { dur } from '../../motion'
  import MentionMark from './MentionMark.svelte'
  import type { Row } from './mentions'

  const {
    rows,
    active,
    onpick,
    onlight,
  }: {
    rows: Row[]
    active: number
    onpick: (index: number) => void
    onlight: (index: number) => void
  } = $props()
</script>

<div
  class="suggest nib-layer"
  role="listbox"
  tabindex="-1"
  transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}
>
  {#each rows as row, index (row.key)}
    <button
      class="row"
      class:lit={index === active}
      class:dim={!!row.dim}
      role="option"
      aria-selected={index === active}
      title={row.dim}
      tabindex="-1"
      onpointerdown={(event) => event.preventDefault()}
      onpointermove={() => onlight(index)}
      onclick={() => onpick(index)}
    >
      {#if row.mark}<MentionMark kind={row.mark} />{/if}
      <span class="label">{row.label}</span>
      {#if row.hint}<span class="hint">{row.hint}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .suggest {
    position: absolute;
    inset-inline: 0;
    bottom: calc(100% + 4px);
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    max-height: 18rem;
    overflow-y: auto;
    padding: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
  }

  .row.lit {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .row.dim {
    opacity: 0.5;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
