<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { settings } from './settings.svelte'
  import { readableSize, usage } from './usage.svelte'
  import { dur } from './motion'
</script>

<!-- At the start of the notices row, with the update notice at its end; see
     `.notices` in App.svelte. -->
{#if usage.warning}
  <div class="toast" role="status" transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}>
    <p>
      {t('{used} of {limit} used.', {
        used: readableSize(usage.used),
        limit: readableSize(usage.limit),
      })}
    </p>

    <div class="actions">
      <button class="quiet" onclick={() => (usage.dismissed = true)}>{t('Dismiss')}</button>
      <button
        class="link"
        onclick={() => {
          usage.dismissed = true
          settings.show('account')
        }}
      >
        {t('Manage storage')}
      </button>
    </div>
  </div>
{/if}

<style>
  /* The first track of the notices row, which floats over the foot of the panes;
     App.svelte places it. */
  .toast {
    grid-column: 1;
    justify-self: start;
    max-width: 20rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--danger);
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
    gap: var(--space-3);
  }

  button {
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .quiet {
    color: var(--muted-strong);
  }

  .quiet:hover {
    color: var(--text-strong);
  }

  .link {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  :global([data-touch]) .toast {
    justify-self: stretch;
    max-width: none;
  }

  :global([data-touch]) button {
    min-height: var(--touch-target);
  }
</style>
