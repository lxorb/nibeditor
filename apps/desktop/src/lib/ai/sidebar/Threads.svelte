<script lang="ts">
  /** The space's threads (docs/ai-sidebar.md 4.11), as Codex's task history: the search
   *  at the top (and New chat over it in a tab's rail), then the threads newest first,
   *  each its title and how long ago it moved, a ring on the ones still answering or
   *  with work running out of sight (a goal, a loop, a helper), and a "..." on the one
   *  pointed at for Rename, Archive and Delete. The archived ones are the list's last
   *  group, as Claude Code keeps them.
   *
   *  In the panel it takes the conversation's place (the list glyph, or Ctrl+Shift+A
   *  twice); in a tab of its own it is the rail down the left, always there.
   *
   *  Typing searches titles and words; arrows walk it, Enter opens, Delete archives (and
   *  an archived one comes back with Delete again), Shift+Delete deletes for good,
   *  Escape goes back to the open thread. */
  import { untrack } from 'svelte'
  import { agoShort } from '../../ago'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { i18n, t } from '../../i18n.svelte'
  import { menu } from '../../menu.svelte'
  import { dur } from '../../motion'
  import { scrollbar } from '../../scrollbar'
  import { shortcuts } from '../../shortcuts.svelte'
  import type { ThreadHead } from '../chat/types'
  import { tasks } from '../commands/tasks.svelte'
  import { chat } from './chat.svelte'

  const { rail = false }: { rail?: boolean } = $props()

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

  /** The one heading in the list, over its first archived thread. */
  const archivedFrom = $derived(rows.findIndex((one) => one.archived))

  $effect(() => {
    const last = Math.max(0, rows.length - 1)
    if (untrack(() => lit) > last) lit = last
  })

  // The panel's list takes the keyboard as it comes; the rail of a tab waits to be asked.
  $effect(() => {
    if (!rail) requestAnimationFrame(() => field?.focus())
  })

  function rowMenu(event: MouseEvent, one: ThreadHead) {
    menu.show(event, [
      { label: t('Rename'), asks: true, run: () => void chat.rename(undefined, one.id) },
      one.archived
        ? { label: t('Unarchive'), run: () => chat.unarchive(one.id) }
        : { label: t('Archive'), run: () => chat.archive(one.id) },
      { label: t('Delete'), danger: true, run: () => void chat.remove(one.id) },
    ])
  }

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

<div class="threads" in:fly={{ y: rail ? 0 : -6, duration: dur(150), easing: cubicOut }}>
  <div class="top">
    <!-- New chat heads a tab's rail, as New chat heads Codex's header; at a side it is already in
         the side's own row of tabs. -->
    {#if rail}
      <button
        class="new"
        title={shortcuts.tooltip(t('New chat'), 'ai.new')}
        onclick={() => chat.newThread()}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"
          ><path
            d="M10.9 6.9v3.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.1a1 1 0 0 1 1-1h3.1M9.3 1.8l1.9 1.9-4.6 4.6-2.5.6.6-2.5z"
          /></svg
        >
        <span>{t('New chat')}</span>
      </button>
    {/if}
    <div class="find nib-field">
      <svg class="nib-field-mark" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M5.8 2.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 1 0 0-7.2zM8.4 8.4l2.6 2.6" /></svg
      >
      <input
        bind:this={field}
        bind:value={chat.listQuery}
        placeholder={t('Search chats')}
        aria-label={t('Search chats')}
        onkeydown={onKey}
        oninput={() => (lit = 0)}
      />
    </div>
  </div>

  <ul class="list" role="listbox" use:scrollbar>
    {#each rows as one, index (one.id)}
      {#if index === archivedFrom}
        <li class="group archived" role="presentation">{t('Archived')}</li>
      {/if}
      <li class="item" role="presentation">
        <button
          class="row"
          class:lit={index === lit}
          class:open={one.id === chat.head?.id}
          class:archived={one.archived}
          role="option"
          aria-selected={index === lit}
          onpointermove={() => (lit = index)}
          onclick={() => void chat.openThread(one.id)}
          oncontextmenu={(event) => rowMenu(event, one)}
        >
          <span class="title">{one.title || t('Untitled')}</span>
          {#if chat.running.includes(one.id) || tasks.of(one.id).length}<span class="dot"
            ></span>{:else}<span class="when">{agoShort(one.updated, i18n.language)}</span>{/if}
        </button>
        <button
          class="nib-glyph more"
          title={t('More')}
          aria-label={t('More')}
          aria-haspopup="menu"
          onclick={(event) => rowMenu(event, one)}
        >
          <svg viewBox="0 0 13 13" aria-hidden="true"
            ><path d="M3 6.5h.01M6.5 6.5h.01M10 6.5h.01" /></svg
          >
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

  .top {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-1) var(--space-2);
  }

  /* New chat, a row of the list's own shape, and the search under it: the first things
     in it, as a rail of threads starts. */
  .new {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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

  @media (hover: hover) {
    .new:hover {
      background: var(--surface-hover);
    }
  }

  .new svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .find {
    margin-top: 2px;
  }

  .list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 var(--space-1) var(--space-2);
    overflow-y: auto;
    list-style: none;
  }

  .item {
    position: relative;
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

  .row.open {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .row.archived {
    color: var(--muted);
  }

  /* The "..." over the end of the row pointed at, Codex's: the row's menu without a
     column of glyphs down a list of titles. */
  .more {
    position: absolute;
    top: 50%;
    inset-inline-end: 2px;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    translate: 0 -50%;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .more svg {
    stroke-width: 2.2;
  }

  .item:hover .more,
  .more:focus-visible,
  :global([data-touch]) .more {
    opacity: 1;
  }

  .item:hover .row {
    padding-inline-end: calc(var(--row-height-sm) + 4px);
  }

  /* How long ago, at the end of the row where the "..." comes on the one pointed at. */
  .when {
    flex: none;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .item:hover .when {
    opacity: 0;
  }

  /* A ring rather than a dot: a dot in the accent is a tab saving, and this is a thread
     at work. */
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border: 1.5px solid var(--accent);
    border-radius: 50%;
    animation: breathe calc(var(--dur-slow) * 4) var(--ease-in-out) infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
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

  .group,
  .empty {
    padding: var(--space-3) var(--row-pad) var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .group:first-child {
    padding-top: var(--space-1);
  }
</style>
