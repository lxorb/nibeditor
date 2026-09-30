<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { restartToUpdate } from './updater'
  import { dur } from './motion'

  const { version, ondismiss }: { version: string; ondismiss: () => void } = $props()

  let restarting = $state(false)

  async function restart() {
    restarting = true
    await restartToUpdate()
    // Only reached if the restart failed; the app is normally gone by now.
    restarting = false
  }
</script>

<!-- The download has already happened quietly. This says so and offers the one
     thing left to do, rather than interrupting to ask permission first. -->
<div class="notice" role="status" transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}>
  <p>{t('nibeditor {version} is ready to install.', { version })}</p>

  <div class="actions">
    <button class="nib-button is-quiet" onclick={ondismiss}>{t('Later')}</button>
    <button class="nib-button" disabled={restarting} onclick={restart}>{t('Restart now')}</button>
  </div>
</div>

<style>
  /* The last track of the notices row, which is the corner it used to float in. It
     takes its room rather than covering the pane; App.svelte says why. */
  .notice {
    grid-column: 3;
    justify-self: end;
    max-width: 22rem;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
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

  .actions {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }

  /* Both buttons are `.nib-button` in the themes package - the accent one and
     `is-quiet` beside it. They were their own pair here: a smaller corner, a
     smaller type size, no lift under the pointer where the sign-in panel's
     lifted, and a fade of 0.6 where the app's is 0.4. A notice is small, so the
     words are the size the sentence beside them is read at. */
  .nib-button {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  /* A phone has no room beside the text, so the buttons go under it and the
     whole thing spans the row. */
  :global([data-touch]) .notice {
    grid-column: 1;
    justify-self: stretch;
    max-width: none;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
  }

  :global([data-touch]) .actions {
    justify-content: flex-end;
  }

  :global([data-touch]) button {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
  }
</style>
