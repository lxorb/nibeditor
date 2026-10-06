<script lang="ts">
  /** The rows that bring notes over from another app, each into a space of its own:
   *  the first screen's, Settings' Import pane's, and the web's first visit's.
   *
   *  The iPhone's "Transfer Your Apps & Data": a row per place the notes could come
   *  from and nothing to read. Obsidian and Notion by name, because they are where
   *  most people arrive from; everything else is one row, since the import tells an
   *  `.enex` from a Logseq graph by itself (docs/import.md, "Nobody picks a format").
   *  Names and no logos, the way the chooser's other rows are a title and a button.
   *
   *  Obsidian on a desktop opens on the vaults Obsidian lists, the way Arc opens on
   *  the browsers it found; see migrating.svelte.ts. */
  import { t } from './i18n.svelte'
  import { migrating } from './migrating.svelte'
  import { isMobile } from './tauri'

  /** A phone hands over files one at a time and never a folder; see
   *  import/picking.ts. So there, a vault or a graph arrives as a zip, through
   *  the row that takes files. */
  const folders = !isMobile

  /** An app's name is its name in every language, as in the import sheet. */
  const OBSIDIAN = 'Obsidian'
  const NOTION = 'Notion'
</script>

{#if migrating.vaults}
  {#each migrating.vaults as vault (vault.path)}
    <div class="nib-setting">
      <span class="name" title={vault.path}>{vault.name}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.vault(vault)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name">{t('Import a folder')}</span>
    <span class="pair">
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => migrating.back()}
      >
        {t('Back')}
      </button>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.folder()}
      >
        {t('Import')}
      </button>
    </span>
  </div>
{:else}
  {#if folders}
    <div class="nib-setting">
      <span class="name">{OBSIDIAN}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.obsidian()}
      >
        {t('Import')}
      </button>
    </div>
  {/if}

  <div class="nib-setting">
    <span class="name">{NOTION}</span>
    <button
      class="nib-button is-quiet is-soft"
      type="button"
      disabled={migrating.working}
      onclick={() => void migrating.files()}
    >
      {t('Import')}
    </button>
  </div>

  <div class="nib-setting">
    <span class="name">{t('Another app')}</span>
    <span class="pair">
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.files()}
      >
        {t('Import')}
      </button>
      {#if folders}
        <button
          class="nib-button is-quiet is-soft"
          type="button"
          disabled={migrating.working}
          onclick={() => void migrating.folder()}
        >
          {t('Import a folder')}
        </button>
      {/if}
    </span>
  </div>
{/if}

<style>
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-row);
    font-weight: var(--weight-row);
    color: var(--text);
  }

  .pair {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .nib-button {
    flex: none;
  }

  :global([data-touch]) .name {
    font-size: var(--touch-text);
  }
</style>
