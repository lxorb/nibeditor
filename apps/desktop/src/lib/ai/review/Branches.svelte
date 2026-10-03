<script lang="ts">
  /** The arrows under a message that was edited and sent again (claude.ai's way): the
   *  branch shown, of how many, and a step either way. Only the conversation moves;
   *  the notes stay as they are. The panel draws this under each of the reader's
   *  messages, with the live thread and itself; it draws nothing where the message
   *  was never edited. */
  import { t } from '../../i18n.svelte'
  import type { Thread } from '../chat/types'
  import { forkAt, switchBranch } from './branches'
  import type { ReviewPanel } from './review.svelte'

  const {
    thread,
    turn,
    panel = null,
  }: { thread: Thread; turn: string; panel?: ReviewPanel | null } = $props()

  // Asked again whenever the panel draws the message, which it does after a switch.
  const fork = $derived(forkAt(thread, turn))

  function step(by: number) {
    if (switchBranch(thread, turn, by)) panel?.touched?.(thread)
  }
</script>

{#if fork}
  <span class="branches">
    <button
      class="nib-glyph"
      disabled={fork.at === 0}
      title={t('Previous')}
      aria-label={t('Previous')}
      onclick={() => step(-1)}
    >
      <svg class="nib-mirror" viewBox="0 0 13 13"><path d="M8 3.2L4.7 6.5 8 9.8" /></svg>
    </button>
    <span class="count">{fork.at + 1}/{fork.count}</span>
    <button
      class="nib-glyph"
      disabled={fork.at === fork.count - 1}
      title={t('Next')}
      aria-label={t('Next')}
      onclick={() => step(1)}
    >
      <svg class="nib-mirror" viewBox="0 0 13 13"><path d="M5 3.2l3.3 3.3L5 9.8" /></svg>
    </button>
  </span>
{/if}

<style>
  .branches {
    display: inline-flex;
    align-items: center;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .nib-glyph {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .nib-glyph > svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .nib-glyph:disabled {
    opacity: 0.4;
  }
</style>
