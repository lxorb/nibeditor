<script lang="ts">
  import { untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { back } from './sync2/resurrected.svelte'
  import { undoToast } from './undo-toast.svelte'
  import { unread } from './unread.svelte'
  import { workspace } from './workspace.svelte'

  /** The one word for each thing the toast can take back. */
  const said = $derived({
    delete: t('Deleted'),
    move: t('Moved'),
    archive: t('Archived'),
    unarchive: t('Unarchived'),
  })

  // What is on the stack already, before this was on the page, is nobody's news.
  undoToast.know(workspace.undone.stack)

  // The stack is what this follows. The toast's own batch is read and written in the
  // same call, and an effect that depended on it would run again on its own write.
  $effect(() => {
    const stack = workspace.undone.stack
    untrack(() => undoToast.heard(stack))
  })

  // Gone with the component, and the timers with it.
  $effect(() => () => {
    undoToast.dismiss()
    unread.dismiss()
    back.dismiss()
  })
</script>

<!-- One word for what happened and one for the way back: the row it was about has
     already gone or moved, which says the rest. -->
{#if undoToast.kind}
  <div
    class="toast"
    role="status"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    onpointerenter={() => undoToast.hold()}
    onpointerleave={() => undoToast.linger()}
  >
    <p>{said[undoToast.kind]}</p>
    <button class="undo" onclick={() => void undoToast.undo(workspace)}>{t('Undo')}</button>
  </div>
  <!-- A row clicked that opened nothing, because the file is there and would not
       read; see unread.svelte.ts. Nothing to press: there is no way back from a
       file another program holds, only the news that it does. -->
{:else if unread.shown}
  <div class="toast" role="status" transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}>
    <p>{t('That file could not be read')}</p>
  </div>
{/if}{#if back.said}
  <!-- A note this device deleted, put back because another device was writing in
       it; see sync2/resurrected.svelte.ts. Its own toast rather than a turn of the one
       above, so an Undo that is up is not taken away by it. Written against the block
       before it, because a line between two blocks is a space on the page. -->
  <div
    class="toast"
    role="status"
    transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
    onpointerenter={() => back.hold()}
    onpointerleave={() => back.linger()}
  >
    <p>
      {t('{name} is back: {device} was writing in it', {
        name: back.said.name,
        device: back.said.device,
      })}
    </p>
  </div>
{/if}

<style>
  /* The first track of the notices row, under the file list the change was made in,
     where Gmail puts its own. Stacked under the storage warning when both are up. */
  .toast {
    grid-column: 1;
    justify-self: start;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-lg);
  }

  p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .undo {
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--accent);
    cursor: default;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .undo:active {
    opacity: 0.6;
  }

  :global([data-touch]) .undo {
    min-height: var(--touch-target);
  }
</style>
