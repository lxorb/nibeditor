<script lang="ts">
  /** The Chats panel (docs/chats.md 4.15): navigation, as the Tasks panel is. A field
   *  that narrows the list, Activity (mentions of the reader, newest first) and Saved,
   *  then every chat the account reaches in Discord's three states: read is quiet,
   *  unread is bright with a count, a mention is a badge in the accent; a muted one is
   *  quieter still. The plus makes a chat in the space in front. A press opens the chat
   *  in a tab. */
  import { onMount } from 'svelte'
  import { amount, t } from '../../i18n.svelte'
  import { workspace } from '../../workspace.svelte'
  import type { ChatEntry, Hit } from '../api'
  import ChatMark from './ChatMark.svelte'
  import Glyph from './Glyph.svelte'
  import { makeChat, openChat } from './open'
  import type { Who } from '@nib/chats'
  import Avatar from '../../people/Avatar.svelte'
  import { firstLine } from './body'
  import { faceOf, nameOf } from './people'
  import { saved } from './saved.svelte'
  import { store } from './source.svelte'

  let query = $state('')
  let showing = $state<'chats' | 'activity' | 'saved'>('chats')
  let activity = $state.raw<Hit[]>([])

  const chats = $derived(
    store()
      .list.filter((one) => (one.name ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)),
  )
  const mentions = $derived(store().list.reduce((sum, one) => sum + one.mentions, 0))
  const now = Date.now()

  /** Mentions of the reader, newest first: what Activity lists (4.11). */
  async function lookActive() {
    activity = await store().search('mentions:me')
  }

  onMount(() => void lookActive())

  function open(chat: ChatEntry | undefined, message?: string) {
    if (chat?.path) openChat(chat.path, {}, message)
  }

  const chatOf = (id: string) => store().list.find((one) => one.id === id)
</script>

{#snippet found(chatId: string, message: string, author: Who, line: string)}
  {@const chat = chatOf(chatId)}
  <button
    type="button"
    class="nib-row"
    aria-label={`${nameOf(author, [], chat?.space ?? null)}: ${line}`}
    onclick={() => open(chat, message)}
  >
    <span class="nib-row-mark"
      ><Avatar face={faceOf(author, [], chat?.space ?? null)} size={20} /></span
    >
    <span class="nib-row-label">{line}</span>
    <span class="nib-row-meta">{chat?.name ?? ''}</span>
  </button>
{/snippet}

<div class="chats">
  <label class="nib-field find">
    <Glyph name="hash" />
    <input bind:value={query} type="search" aria-label={t('Search')} placeholder={t('Search')} />
  </label>

  {#if showing === 'chats'}
    <button
      type="button"
      class="nib-row"
      onclick={() => {
        showing = 'activity'
        void lookActive()
      }}
    >
      <span class="nib-row-mark"><Glyph name="mention" /></span>
      <span class="nib-row-label">{t('Activity')}</span>
      {#if mentions}<span class="badge">{amount(mentions)}</span>{/if}
    </button>
    <button type="button" class="nib-row" onclick={() => (showing = 'saved')}>
      <span class="nib-row-mark"><Glyph name="saved" /></span>
      <span class="nib-row-label">{t('Saved')}</span>
      {#if saved.list.length}<span class="nib-row-meta">{amount(saved.list.length)}</span>{/if}
    </button>

    <div class="section">
      <p class="nib-section">{t('Chats')}</p>
      {#if workspace.activeSpace}
        <button
          type="button"
          class="nib-glyph add"
          aria-label={t('New chat')}
          title={t('New chat')}
          onclick={() => void makeChat()}><Glyph name="attach" /></button
        >
      {/if}
    </div>
    {#each chats as chat (chat.id)}
      {@const muted = chat.mutedUntil !== null && chat.mutedUntil > now}
      {@const unread = chat.unread > 0 && !muted}
      <button
        type="button"
        class="nib-row entry"
        class:unread
        class:muted
        class:is-on={workspace.active?.path === chat.path && chat.path !== null}
        disabled={!chat.path}
        onclick={() => open(chat)}
      >
        <span class="nib-row-mark"><ChatMark path={chat.path} /></span>
        <span class="nib-row-label">{chat.name}</span>
        {#if chat.mentions && !muted}
          <span class="badge">{amount(chat.mentions)}</span>
        {:else if unread}
          <span class="nib-row-meta count">{amount(chat.unread)}</span>
        {/if}
      </button>
    {/each}
  {:else}
    <button type="button" class="nib-row back" onclick={() => (showing = 'chats')}>
      <span class="nib-row-mark"><Glyph name="left" /></span>
      <span class="nib-row-label">{showing === 'activity' ? t('Activity') : t('Saved')}</span>
    </button>
    {#if showing === 'activity'}
      {#each activity as one (`${one.chat}:${one.message.id}`)}
        {@render found(one.chat, one.message.id, one.message.author, firstLine(one.message.body))}
      {:else}
        <p class="empty"><Glyph name="mention" /></p>
      {/each}
    {:else}
      {#each saved.list as one (`${one.chat}:${one.message}`)}
        {@render found(one.chat, one.message, one.author, one.line)}
      {:else}
        <p class="empty"><Glyph name="saved" /></p>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .chats {
    --glyph-size: var(--icon-md);
    display: flex;
    flex-direction: column;
  }

  .find {
    --glyph-size: 14px;
    margin: 0 0 var(--space-2);
    color: var(--muted);
  }

  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .add {
    --glyph-size: 15px;
    width: 24px;
    height: 24px;
  }

  .entry {
    color: var(--muted);
  }

  .entry.unread {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .entry.muted {
    opacity: 0.55;
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  .badge {
    flex: none;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .back {
    color: var(--muted-strong);
  }

  .empty {
    --glyph-size: 20px;
    display: grid;
    place-items: center;
    margin: var(--space-5) 0;
    color: var(--muted);
    opacity: 0.5;
  }
</style>
