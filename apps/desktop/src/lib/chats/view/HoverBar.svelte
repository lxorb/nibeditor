<script lang="ts">
  /** The bar at the top right of the row under the pointer (docs/chats.md 4.15): the
   *  three reactions the reader gives most, the picker, Reply, Quote, and ⋯ for the
   *  rest, which is the row's own menu. One bar for the whole chat, moved to the row
   *  being pointed at, rather than one built into every row. */
  import type { Message } from '@nib/chats'
  import { fade } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { emojiRecent } from '../../emoji/recent.svelte'
  import Glyph from './Glyph.svelte'
  import { tip } from './tips.svelte'

  const {
    message,
    top,
    canPost,
    onreact,
    onpicker,
    onreply,
    onquote,
    onmenu,
  }: {
    message: Message
    top: number
    canPost: boolean
    onreact: (emoji: string) => void
    onpicker: (from: HTMLElement) => void
    onreply: () => void
    onquote: () => void
    onmenu: (event: MouseEvent) => void
  } = $props()
</script>

<div
  class="bar nib-layer"
  style:top="{top}px"
  role="toolbar"
  aria-label={message.body.slice(0, 40)}
  transition:fade={{ duration: dur(100) }}
>
  {#if canPost}
    {#each emojiRecent.first(3) as emoji (emoji)}
      <button type="button" class="one emoji" aria-label={emoji} onclick={() => onreact(emoji)}
        >{emoji}</button
      >
    {/each}
    <button
      type="button"
      class="one"
      aria-label={t('Add reaction')}
      use:tip={() => t('Add reaction')}
      onclick={(event) => onpicker(event.currentTarget)}><Glyph name="react" /></button
    >
    <button
      type="button"
      class="one"
      aria-label={t('Reply')}
      use:tip={() => t('Reply')}
      onclick={onreply}><Glyph name="reply" /></button
    >
    <button
      type="button"
      class="one"
      aria-label={t('Quote')}
      use:tip={() => t('Quote')}
      onclick={onquote}><Glyph name="quote" /></button
    >
  {/if}
  <button
    type="button"
    class="one"
    aria-label={t('More')}
    use:tip={() => t('More')}
    onclick={(event) => onmenu(event)}><Glyph name="more" /></button
  >
</div>

<style>
  .bar {
    position: absolute;
    right: var(--space-4);
    z-index: var(--z-lifted);
    display: flex;
    gap: 1px;
    padding: 2px;
    translate: 0 -55%;
  }

  .one {
    --glyph-size: 16px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  @media (hover: hover) {
    .one:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }

    .emoji:hover {
      transform: scale(1.15);
    }
  }

  .one:active {
    transform: scale(0.92);
  }

  .emoji {
    font-size: 16px;
    line-height: 1;
  }
</style>
