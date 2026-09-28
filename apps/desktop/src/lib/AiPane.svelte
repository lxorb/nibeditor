<script lang="ts">
  /** Settings > AI: the providers, and where the keys are.
   *
   *  Its own component rather than rows in the panel's table, because a provider is
   *  not a setting: it is two or three fields, a list fetched from a server, and one
   *  sentence about where its key went. Three kinds and a list of them; see
   *  ai/providers.ts.
   *
   *  The models are asked for rather than listed here. A table of model names in the
   *  source is wrong by the time anybody reads it, and a model running on this
   *  machine has a name only this machine knows.
   *
   *  The one thing this pane is careful about is saying where a key is: an operating
   *  system's own store on a desktop or a phone, and the browser's storage in a tab,
   *  which is not the same thing and is not pretended to be. See ai/keys.ts. */
  import { slide } from 'svelte/transition'
  import { ai } from './ai/store.svelte'
  import { listModels } from './ai/complete'
  import { forgetKey, hasKey, keysAreGuarded, writeKey } from './ai/keys'
  import { KIND_NAMES, type Provider, type ProviderKind, reachable } from './ai/providers'
  import { glassesKey } from './even/key.svelte'
  import { message, t } from './i18n.svelte'
  import { dur } from './motion'
  import Select from './Select.svelte'
  import { viewport } from './viewport.svelte'

  /** Which providers have a key on this device, by id. Asked once per provider and
   *  again whenever one is typed: the store itself never holds a key, so "set" is a
   *  question for the device and not for the list. */
  let keyed = $state<Record<string, boolean>>({})
  /** The models each provider answered with, by id. */
  let models = $state<Record<string, string[]>>({})
  /** Which provider is being asked for its models, so its row can say so. */
  let asking = $state('')
  /** What went wrong, by provider, in that provider's own words. */
  let trouble = $state<Record<string, string>>({})

  const KINDS: ProviderKind[] = ['anthropic', 'openai', 'compatible']

  /** What a base URL looks like, as the address Ollama answers on. An address and
   *  not a sentence, so it is the same in every language; named here rather than
   *  written into the field, because a placeholder written there reads as prose
   *  nobody translated. */
  const EXAMPLE_URL = 'http://localhost:11434'

  /** The word a provider wears: its own name, or its kind's. */
  const named = (provider: Provider) => provider.name || t(KIND_NAMES[provider.kind])

  /** Which kinds can still be added. One Claude and one OpenAI, because there is one
   *  of each API and one key for each; as many compatible ones as somebody has
   *  servers. */
  const addable = $derived(
    KINDS.filter((kind) => kind === 'compatible' || !ai.providers.some((one) => one.kind === kind)),
  )

  $effect(() => {
    // Every provider in the list, asked whether this device holds its key. Reruns
    // when the list changes, which is what makes a new row say "not set" at once.
    for (const provider of ai.providers) void look(provider.id)
  })

  async function look(id: string) {
    const found = await hasKey(id).catch(() => false)
    keyed = { ...keyed, [id]: found }
  }

  async function take(provider: Provider, typed: string) {
    trouble = { ...trouble, [provider.id]: '' }

    try {
      await writeKey(provider.id, typed)
      await look(provider.id)
      await refresh(provider)
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, t('that key could not be saved')) }
    }
  }

  async function drop(provider: Provider) {
    try {
      await forgetKey(provider.id)
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, t('that key could not be saved')) }
    }
    await look(provider.id)
  }

  /** Asks a provider what it has. The one network call this pane makes on purpose:
   *  a list of models is the first thing that tells somebody their key works. */
  async function refresh(provider: Provider) {
    if (!reachable(provider, keyed[provider.id] ?? false)) return

    asking = provider.id
    trouble = { ...trouble, [provider.id]: '' }

    try {
      const found = await listModels(provider)
      models = { ...models, [provider.id]: found }
      // The first one where nothing has been chosen, so a provider that has just
      // been given a key is usable without a second decision.
      if (!provider.model && found[0]) ai.update(provider.id, { model: found[0] })
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, t('Could not read the models.')) }
    } finally {
      asking = ''
    }
  }

  function forget(provider: Provider) {
    void drop(provider)
    ai.remove(provider.id)
  }
</script>

<h3>{t('Providers')}</h3>

{#if ai.providers.length}
  {#each ai.providers as provider (provider.id)}
    <div class="card" transition:slide={{ duration: dur(160) }}>
      <!-- What it is, and whether it is the one a block uses without being told. -->
      <div class="nib-setting setting">
        <span class="name">{named(provider)}</span>
        <div class="row">
          {#if ai.defaultId === provider.id}
            <span class="hint">{t('Default')}</span>
          {:else}
            <button class="nib-chip" onclick={() => ai.setDefault(provider.id)}>
              {t('Make default')}
            </button>
          {/if}
          <button class="nib-chip is-quiet" onclick={() => forget(provider)}>{t('Remove')}</button>
        </div>
      </div>

      {#if provider.kind === 'compatible'}
        <label class="nib-setting setting">
          <span class="name">{t('Name')}</span>
          <input
            class="nib-field inline"
            value={provider.name}
            placeholder={t('OpenAI-compatible')}
            spellcheck="false"
            onchange={(event) => ai.update(provider.id, { name: event.currentTarget.value })}
          />
        </label>

        <label class="nib-setting setting">
          <span class="name">{t('Base URL')}</span>
          <input
            class="nib-field inline"
            value={provider.baseUrl ?? ''}
            placeholder={EXAMPLE_URL}
            spellcheck="false"
            autocomplete="off"
            onchange={(event) => {
              ai.update(provider.id, { baseUrl: event.currentTarget.value })
              void refresh({ ...provider, baseUrl: event.currentTarget.value })
            }}
          />
        </label>
      {/if}

      <!-- The key. Shown as set and never shown again: a field that hands a key back
           is a field that can copy one out of somebody else's window. -->
      <div class="nib-setting setting">
        <span class="name">{t('API key')}</span>
        {#if keyed[provider.id]}
          <div class="row">
            <span class="hint">{t('Set on this device')}</span>
            <button class="nib-chip is-quiet" onclick={() => void drop(provider)}
              >{t('Remove')}</button
            >
          </div>
        {:else}
          <input
            class="nib-field inline"
            type="password"
            value=""
            placeholder={provider.kind === 'compatible' ? t('Optional') : 'sk-'}
            spellcheck="false"
            autocomplete="off"
            onchange={(event) => {
              const typed = event.currentTarget.value
              event.currentTarget.value = ''
              void take(provider, typed)
            }}
          />
        {/if}
      </div>

      <div class="nib-setting setting">
        <span class="name">{t('Model')}</span>
        {#if models[provider.id]?.length}
          <div class="pick">
            <Select
              value={provider.model}
              options={(models[provider.id] ?? []).map((one) => ({ value: one, label: one }))}
              onchange={(value: string) => ai.update(provider.id, { model: value })}
              label={t('Model')}
              plain={viewport.touch}
            />
          </div>
        {:else}
          <div class="row">
            {#if provider.model}<span class="hint">{provider.model}</span>{/if}
            <button
              class="nib-chip"
              disabled={asking === provider.id || !reachable(provider, keyed[provider.id] ?? false)}
              onclick={() => void refresh(provider)}
            >
              {asking === provider.id ? t('Asking…') : t('List models')}
            </button>
          </div>
        {/if}
      </div>

      {#if trouble[provider.id]}
        <p class="hint bad">{trouble[provider.id]}</p>
      {/if}
    </div>
  {/each}
{:else}
  <p class="hint">{t('No providers yet.')}</p>
{/if}

<!-- Adding one. Three kinds, and the one that can be added more than once stays
     here after the other two have gone. -->
<div class="card">
  {#each addable as kind (kind)}
    <button class="action" onclick={() => ai.add(kind)}>
      {t('Add {name}', { name: t(KIND_NAMES[kind]) })}
    </button>
  {/each}
</div>

<!-- The one thing worth a sentence: where a key goes. -->
<p class="hint caption">
  {#if keysAreGuarded()}
    {t('Keys stay in the secure store on this device.')}
  {:else}
    {t('This browser holds the keys in its own storage.')}
  {/if}
</p>

<!-- The account's own key, which is a different key for a different thing. Read
     only here: it is set in Glasses, and it is never shown again anywhere. See
     even/key.svelte.ts. -->
{#if glassesKey.set}
  <h3>{t('OpenAI key')}</h3>
  <div class="card">
    <div class="nib-setting setting">
      <span class="name">{t('Used by the glasses')}</span>
      <span class="hint">{t('set, ends in …{tail}', { tail: glassesKey.tail })}</span>
    </div>
  </div>
  <p class="hint caption">{t('Kept encrypted on your account, and never shown again.')}</p>
{/if}

<style>
  /* The settings pane's own shapes. A section in its own component does not inherit
     the panel's styles - those are scoped to it - so the ones this pane uses are
     here with the panel's values, the way McpSetup and SyncPane carry theirs. See
     SettingsPanel.svelte. */
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }

  h3:first-child,
  :global(h2) + h3 {
    margin-top: 0;
  }

  /* A run of rows. Plain on a desktop; a phone draws the box around it. */
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* Name on the left, control on the right, one line each. */

  .setting .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* What may be done about a row, at the end of it. */
  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Wide enough for the longest model name anybody has to read. */
  .pick {
    flex: none;
    width: 14rem;
  }

  /* A field in a row: the design system's box, sized to the column a control sits
     in rather than to the row. */
  .inline {
    flex: none;
    width: 14rem;
    min-height: 30px;
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }

  /* An action in a card: full width, quiet until pointed at. */
  .action {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .action:hover:not(:disabled) {
      color: var(--text-strong);
    }
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  .hint.caption {
    padding: 0 2px;
  }

  /* A phone draws the box, the touch rows and the hairlines. The sheet is the
     panel's, so that half of the selector is global. */
  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .action {
    position: relative;
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    color: var(--accent);
    font-size: var(--touch-text);
  }
</style>
