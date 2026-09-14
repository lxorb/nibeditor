<script lang="ts">
  /** The Recently deleted pane: two lists, Spaces and Notes, each row with
   *  the way back and the way out. Reads the account when signed in and the
   *  device otherwise; both when the device still holds older items. */
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { relativeStep } from './ago'
  import { i18n, plural, t } from './i18n.svelte'
  import { settings } from './settings.svelte'
  import { trash, type TrashItem } from './trash.svelte'
  import { rowName } from './note-name'
  import { dur } from './motion'

  const DAY = 24 * 60 * 60 * 1000

  // Read afresh each time the pane comes into view, not only when it is
  // first made: the panel keeps it around while it is closed.
  $effect(() => {
    if (settings.open && settings.section === 'trash') void trash.load()
  })

  const spaces = $derived(trash.items.filter((item) => item.kind === 'space'))
  const notes = $derived(trash.items.filter((item) => item.kind !== 'space'))

  /** The formatter for the language on screen, made once rather than once per row
   *  per render: building one reads the locale data, which is the dearest thing
   *  on this pane by a long way. */
  const relative = $derived(new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }))

  /** "3 days ago", in the interface language. Which unit that is, is ago.ts. */
  function ago(at: number): string {
    const step = relativeStep(Date.now() - at)
    return relative.format(step.value, step.unit)
  }

  function daysLeft(item: TrashItem): number {
    return Math.max(1, Math.ceil((item.purgeAt - Date.now()) / DAY))
  }

  /** One line under the name: where it was, when it went, when it goes. */
  function meta(item: TrashItem): string {
    return [
      item.detail,
      t('deleted {when}', { when: ago(item.deletedAt) }),
      plural(daysLeft(item), { one: 'gone in {count} day', other: 'gone in {count} days' }),
      item.source === 'device' ? t('on this device') : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }
</script>

{#snippet rows(items: TrashItem[])}
  <div class="card">
    {#each items as item (item.id)}
      <div class="row" transition:slide={{ duration: dur(180), easing: cubicOut }}>
        <div class="name">
          <span class="title">{rowName(item.name, item.kind !== 'note')}</span>
          <small>{meta(item)}</small>
        </div>
        <button class="quiet" disabled={trash.busy} onclick={() => void trash.restore(item)}>
          {t('Restore')}
        </button>
        <button class="quiet danger" disabled={trash.busy} onclick={() => void trash.purge(item)}>
          {t('Delete now')}
        </button>
      </div>
    {/each}
  </div>
{/snippet}

<p class="hint">
  {t('Deleted notes and spaces wait here for 14 days, then they are gone for good.')}
</p>

{#if trash.error}
  <p class="hint bad">{trash.error}</p>
{/if}

{#if trash.loaded && !trash.items.length}
  <p class="hint empty">{t('Nothing here.')}</p>
{:else if trash.items.length}
  <div class="top">
    <button class="quiet danger" disabled={trash.busy} onclick={() => void trash.empty()}>
      {t('Empty')}
    </button>
  </div>

  {#if spaces.length}
    <h3>{t('Spaces')}</h3>
    {@render rows(spaces)}
  {/if}

  {#if notes.length}
    <h3>{t('Notes')}</h3>
    {@render rows(notes)}
  {/if}
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  .hint.empty {
    margin-top: var(--space-3);
  }

  .top {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-3);
  }

  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .row + .row {
    border-top: 1px solid var(--line);
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .title,
  .name small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }
  button.quiet {
    flex: none;
    padding: 9px 0 9px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
    cursor: pointer;
  }

  @media (hover: hover) {
    button.quiet:hover:not(:disabled) {
      color: var(--text);
    }

    button.quiet.danger:hover:not(:disabled) {
      color: var(--danger);
    }
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
