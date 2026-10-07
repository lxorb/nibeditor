<script lang="ts">
  /** A message's reactions (docs/chats.md 3, #30, #31): each emoji with how many, the
   *  reader's own in the accent, a press to put one on or take it back, and who on the
   *  bubble. A new one pops in. The last chip opens the picker. */
  import type { Message } from '@nib/chats'
  import { scale } from 'svelte/transition'
  import { backOut } from 'svelte/easing'
  import { amount, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { ChatPage } from './chat.svelte'
  import Glyph from './Glyph.svelte'
  import { nameOf } from './people'
  import { tip } from './tips.svelte'

  const {
    message,
    page,
    space,
    canReact,
    onmore,
  }: {
    message: Message
    page: ChatPage
    space: string | null
    canReact: boolean
    onmore: (from: HTMLElement) => void
  } = $props()

  const list = $derived(Object.entries(message.reactions).filter(([, who]) => who.length))
  const named = (who: readonly Message['author'][]) =>
    who.map((one) => nameOf(one, page.members, space)).join(', ')
</script>

{#if list.length}
  <div class="reactions">
    {#each list as [emoji, who] (emoji)}
      <button
        type="button"
        class="chip"
        class:mine={page.me !== null && who.includes(page.me)}
        disabled={!canReact}
        aria-pressed={page.me !== null && who.includes(page.me)}
        aria-label={`${emoji} ${named(who)}`}
        use:tip={() => named(who)}
        onclick={() => page.react(message, emoji)}
        in:scale={{ start: 0.8, duration: dur(160), easing: backOut }}
      >
        <span class="emoji">{emoji}</span>
        <span class="count">{amount(who.length)}</span>
      </button>
    {/each}
    {#if canReact}
      <button
        type="button"
        class="chip more"
        aria-label={t('Add reaction')}
        use:tip={() => t('Add reaction')}
        onclick={(event) => onmore(event.currentTarget)}><Glyph name="react" /></button
      >
    {/if}
  </div>
{/if}

<style>
  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  @media (hover: hover) {
    .chip:hover:not(:disabled) {
      border-color: var(--line-strong);
      background: var(--surface-hover);
    }
  }

  .chip:active:not(:disabled) {
    transform: scale(0.94);
  }

  .chip.mine {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .emoji {
    font-size: 15px;
    line-height: 1;
  }

  .more {
    --glyph-size: 15px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  :global(.message:hover) .more,
  :global(.message:focus-within) .more,
  :global([data-touch]) .more {
    opacity: 1;
  }
</style>
