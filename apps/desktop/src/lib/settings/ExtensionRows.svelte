<!-- The extensions, in Settings > General > Browser: one row each, with its switch, and
     what it may do and the way to take it away a press on its name away.

     chrome://extensions in nib's rows. A row is the extension's picture, its name, its
     version, and the switch; pressing the name opens the row, which lists what the
     extension asks to be allowed in Chromium's own words and holds Options and Remove.
     Under the rows, the field a store link is pasted into. What the engine said when an
     extension did not load is the one line that is not asked for. The list and every
     press are lib/web-tab/extensions.svelte.ts's. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import Puzzle from 'lucide/dist/esm/icons/puzzle.mjs'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { settings } from '../settings.svelte'
  import { workspace } from '../workspace.svelte'
  import { extensions } from '../web-tab/extensions.svelte'

  /** The row that is open, if any. */
  let opened = $state<string | null>(null)
  let link = $state('')

  onMount(() => void extensions.start())

  async function add(event: SubmitEvent) {
    event.preventDefault()
    if (!link.trim()) return
    if (await extensions.install(link.trim())) link = ''
  }

  async function options(id: string) {
    const page = await extensions.optionsOf(id)
    if (!page) return
    settings.open = false
    workspace.openPage(page, 'front')
  }
</script>

{#each extensions.list as one (one.id)}
  <div class="nib-setting setting extension">
    <button
      class="name"
      aria-expanded={opened === one.id}
      onclick={() => (opened = opened === one.id ? null : one.id)}
    >
      {#if one.picture}
        <img src={one.picture} alt="" draggable="false" />
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {#each Puzzle as [tag, attrs], index (index)}
            <svelte:element this={tag} {...attrs} />
          {/each}
        </svg>
      {/if}
      <span class="what">
        <span class="named">{one.name}</span>
        {#if one.problem}
          <small class="warn">{t('Did not load')}</small>
        {:else}
          <small>{one.version}</small>
        {/if}
      </span>
    </button>
    <button
      class="toggle"
      role="switch"
      aria-checked={one.enabled}
      aria-label={one.name}
      onclick={() => void extensions.enable(one.id, !one.enabled)}
    >
      <span class="nib-switch" class:on={one.enabled} aria-hidden="true"></span>
    </button>
  </div>
  {#if opened === one.id}
    <div class="details" transition:slide={{ duration: dur(140) }}>
      {#if one.problem}
        <p class="warn">{one.problem}</p>
      {/if}
      {#if one.permissions.length}
        <ul class="asks" aria-label={t('Permissions')}>
          {#each one.permissions as ask (ask)}
            <li>{ask}</li>
          {/each}
        </ul>
      {/if}
      <div class="rows">
        {#if one.options}
          <button class="nib-chip is-quiet" onclick={() => void options(one.id)}>
            {t('Options')}
          </button>
        {/if}
        <button class="nib-chip is-quiet danger" onclick={() => void extensions.remove(one.id)}>
          {t('Remove')}
        </button>
      </div>
    </div>
  {/if}
{/each}

<form class="nib-setting setting" onsubmit={add}>
  <input
    class="nib-field"
    type="url"
    bind:value={link}
    placeholder={t('Paste a Chrome Web Store link')}
    aria-label={t('Paste a Chrome Web Store link')}
    spellcheck="false"
    autocomplete="off"
    disabled={extensions.installing !== null}
  />
</form>
{#if extensions.failed}
  <p class="warn">{t(extensions.failed)}</p>
{/if}

<style>
  .extension .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .extension img,
  .extension svg {
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-lg);
    object-fit: contain;
  }

  .extension svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted);
  }

  .what {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .named {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .warn {
    color: var(--danger);
  }

  .toggle {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 0 var(--space-2) calc(var(--icon-lg) + var(--space-2));
  }

  .details p {
    margin: 0;
    font-size: var(--text-xs);
  }

  .asks {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .asks li {
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .rows {
    display: flex;
    gap: var(--space-2);
  }

  .danger {
    color: var(--danger);
  }

  form input {
    flex: 1;
    min-width: 0;
  }

  p.warn {
    margin: 0;
    font-size: var(--text-xs);
  }
</style>
