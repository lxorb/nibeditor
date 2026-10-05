<script lang="ts">
  /** Over the field: the rewind sheet while it is open for the thread, and Redo after a
   *  rewind until the next message (docs/ai-sidebar.md 4.5). The panel draws this with
   *  the open thread, the live one the engine writes into, and itself
   *  (lib/ai/sidebar/seams.ts). */
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { Thread } from '../chat/types'
  import Rewind from './Rewind.svelte'
  import { review, type ReviewPanel } from './review.svelte'

  const { thread, panel = null }: { thread: Thread; panel?: ReviewPanel | null } = $props()

  const sheet = $derived(review.sheet?.thread.id === thread.id ? review.sheet : null)
  const redo = $derived(review.canRedo(thread))
</script>

{#if sheet}
  <Rewind {sheet} />
{:else if redo}
  <div class="redo" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    <button class="nib-chip is-quiet" onclick={() => void review.putBack(thread, panel)}
      >{t('Redo')}</button
    >
  </div>
{/if}

<style>
  .redo {
    display: flex;
    justify-content: flex-end;
  }
</style>
