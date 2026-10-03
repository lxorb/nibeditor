<script lang="ts">
  /** The space's threads (docs/ai-sidebar.md 4.11): newest first, each its title, its
   *  model and its age, a dot on the ones still answering. Typing searches titles and
   *  words; arrows walk it, Enter opens, Delete archives (and an archived one comes back
   *  with Delete again), Shift+Delete deletes for good, Escape goes back to the open
   *  thread. The archived ones are the list's last group, as Claude Code keeps them. */
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { scrollbar } from '../../scrollbar'
  import { when } from '../../when'
  import type { ThreadHead } from '../chat/types'
  import { chat } from './chat.svelte'

  let field = $state<HTMLInputElement>()
  let lit = $state(0)

  function matches(one: ThreadHead, words: string[]): boolean {
    const text = `${one.title} ${one.words} ${one.model}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }

  const rows = $derived.by(() => {
    const words = chat.listQuery.toLowerCase().split(/\s+/).filter(Boolean)
    const found = chat.heads.filter((one) => matches(one, words))
    return [...found.filter((one) => !one.archived), ...found.filter((one) => one.archived)]
  })
  const firstArchived = $derived(rows.findIndex((one) => one.archived))

  $effect(() => {
    const last = Math.max(0, rows.length - 1)
    if (untrack(() => lit) > last) lit = last
  })

  $effect(() => {
    requestAnimationFrame(() => field?.focus())
  })

  function onKey(event: KeyboardEvent) {
    const one = rows[lit]
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      lit = (lit + step + rows.length) % Math.max(1, rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (one) void chat.openThread(one.id)
    } else if (event.key === 'Delete' && one) {
      event.preventDefault()
      if (event.shiftKey) void chat.remove(one.id)
      else if (one.archived) chat.unarchive(one.id)
      else chat.archive(one.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      chat.listing = false
      chat.focus()
    }
  }
</script>

<div class="threads" in:fly={{ y: -6, duration: dur(150), easing: cubicOut }}>
  <div class="find">
    <input
      class="nib-field"
      bind:this={field}
      bind:value={chat.listQuery}
      placeholder={t('Search chats')}
      aria-label={t('Search chats')}
      onkeydown={onKey}
      oninput={() => (lit = 0)}
    />
  </div>

  <ul class="list" role="listbox" use:scrollbar>
    {#each rows as one, index (one.id)}
      {#if index === firstArchived}
        <li class="group" role="presentation">{t('Archived')}</li>
      {/if}
      <li role="presentation">
        <button
          class="row"
          class:lit={index === lit}
          class:open={one.id === chat.head?.id}
          class:archived={one.archived}
          role="option"
          aria-selected={index === lit}
          onpointermove={() => (lit = index)}
          onclick={() => void chat.openThread(one.id)}
        >
          {#if chat.running.includes(one.id)}<span class="dot"></span>{/if}
          <span class="title">{one.title || t('Untitled')}</span>
          <span class="meta">{one.model}</span>
          <span class="age">{when(one.updated, 'short')}</span>
        </button>
      </li>
    {:else}
      <li class="empty" role="presentation">
        {chat.listQuery ? t('No matches') : t('No chats yet')}
      </li>
    {/each}
  </ul>
</div>

<style>
  .threads {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .find {
    flex: none;
    padding: var(--space-1) var(--space-1) var(--space-2);
  }

  .list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 var(--space-1) var(--space-2);
    overflow-y: auto;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
    border: 0;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .row.lit {
    background: var(--surface-hover);
  }

  .row.open .title {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .row.archived {
    color: var(--muted);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: breathe calc(var(--dur-slow) * 4) var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.35;
    }
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta,
  .age {
    flex: none;
    max-width: 30%;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group,
  .empty {
    padding: var(--space-3) var(--row-pad) var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }
</style>
