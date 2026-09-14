<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { dur } from './motion'
  import { toast } from './toasting.svelte'

  const showing = $derived(toast.showing)
</script>

<!-- The gesture saying its own name, and offering to take itself back. Keyed on the
     notice's own number so a second one flies in as a new notice rather than having its
     words swapped under the reader's eye - the words are what changed, and a change
     nobody saw happen is a change nobody read. The words are announced by the store;
     this half is the seen one, so it says nothing to a live region of its own. -->
{#key showing?.id}
  {#if showing}
    <div
      class="toast"
      transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
      data-nib-toast
    >
      <p>{showing.words}</p>

      {#if showing.action}
        <button class="nib-button is-quiet" onclick={() => toast.take()}>{showing.action}</button>
      {/if}
    </div>
  {/if}
{/key}

<style>
  /* The update notice's own card, in the other corner and at the same height: it is
     the same kind of thing said in the same voice, so it is not a second shape. The
     start rather than the end, because the end is where the update notice sits and a
     reader who has both is reading two things, not one wider one. */
  .toast {
    position: fixed;
    inset-inline-start: max(var(--space-4), var(--inset-start));
    bottom: calc(var(--space-4) + var(--inset-bottom));
    z-index: 40;
    max-width: 22rem;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
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

  .nib-button {
    flex: none;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  /* A phone has the room across rather than beside, and a thumb needs the height. The
     card spans the screen the way the update notice does, but the word and the button
     stay on one line: two words do not need two rows. */
  :global([data-touch]) .toast {
    inset-inline-start: max(var(--space-3), var(--inset-start));
    inset-inline-end: max(var(--space-3), var(--inset-end));
    max-width: none;
  }

  :global([data-touch]) .nib-button {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
  }
</style>
