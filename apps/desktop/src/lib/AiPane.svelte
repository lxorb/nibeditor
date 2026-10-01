<script lang="ts">
  /** Settings > AI: the providers, where the keys are, the plans, and which provider
   *  each feature asks.
   *
   *  Its own component rather than rows in the panel's table, because a provider is
   *  not a setting: it is two or three fields, a list fetched from a server, and one
   *  sentence about where its key went. Six kinds and a list of them; see
   *  ai/providers.ts.
   *
   *  The models are asked for rather than listed here. A table of model names in the
   *  source is wrong by the time anybody reads it, and a model running on this
   *  machine has a name only this machine knows. Claude Code and Codex take a name
   *  typed, or none for the one the reader chose in the program.
   *
   *  A plan is the reader's own, so its row says whose and which (Max, ChatGPT) as the
   *  program or OpenAI says it, and a sign-in happens where the plan's maker has it
   *  happen: in the program's own login, in a terminal tab (ai/local/signin.ts), or in
   *  the browser for ChatGPT. Nothing here reads a token or a program's files.
   *
   *  The one thing this pane is careful about is saying where a key is: an operating
   *  system's own store on a desktop or a phone, and the browser's storage in a tab,
   *  which is not the same thing and is not pretended to be. See ai/keys.ts. */
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import { FEATURES, ai } from './ai/store.svelte'
  import { listModels } from './ai/complete'
  import { USAGE } from './ai/chatgpt'
  import ChatGptMark from './ai/ChatGptMark.svelte'
  import { forgetKey, hasKey, keysAreGuarded, writeKey } from './ai/keys'
  import { plans } from './ai/local/status.svelte'
  import { limitSentence } from './ai/local/trouble'
  import type { Limit } from './ai/local/heard'
  import {
    isLocal,
    KIND_NAMES,
    type LocalKind,
    offeredKinds,
    type Provider,
    type ProviderKind,
    reachable,
  } from './ai/providers'
  import { glassesKey } from './even/key.svelte'
  import { message, t } from './i18n.svelte'
  import { dur } from './motion'
  import Select from './Select.svelte'
  import { invoke, isDesktop, openExternal } from './tauri'
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
  /** Whether the browser is out signing somebody in to ChatGPT, and which press sent it:
   *  a second press starts again rather than waiting out a tab somebody closed. */
  let signingIn = $state(false)
  let signIns = 0

  /** Where each program is installed from: its maker's own page. */
  const INSTALL: Record<LocalKind, string> = {
    'claude-code': 'https://code.claude.com/docs/en/setup',
    codex: 'https://developers.openai.com/codex/cli',
  }

  /** Where each plan's use is seen and managed, for the moment it runs out. */
  const USAGE_OF: Record<LocalKind | 'chatgpt', string> = {
    'claude-code': 'https://claude.ai/settings/usage',
    codex: USAGE,
    chatgpt: USAGE,
  }

  /** Which plan each kind spends, as its row names it. */
  const PLAN_OF: Record<LocalKind | 'chatgpt', string> = {
    'claude-code': 'Claude',
    codex: 'ChatGPT',
    chatgpt: 'ChatGPT',
  }

  /** What a base URL looks like, as the address Ollama answers on. An address and
   *  not a sentence, so it is the same in every language; named here rather than
   *  written into the field, because a placeholder written there reads as prose
   *  nobody translated. */
  const EXAMPLE_URL = 'http://localhost:11434'

  /** The word a provider wears: its own name, or its kind's. */
  const named = (provider: Provider) => provider.name || t(KIND_NAMES[provider.kind])

  /** Whether a provider's key is on this device, or, for ChatGPT, whether somebody is
   *  signed in: the two are the same question to a request. */
  const ready = (provider: Provider) =>
    provider.kind === 'chatgpt' ? !!plans.chatgpt : (keyed[provider.id] ?? false)

  /** Which kinds can still be added. One of each but the compatible kind, because
   *  there is one of each API, key, program and plan; as many compatible ones as
   *  somebody has servers. */
  const addable = $derived(
    offeredKinds(isDesktop, __CLAUDE_CODE__).filter(
      (kind) => kind === 'compatible' || !ai.providers.some((one) => one.kind === kind),
    ),
  )

  onMount(() => {
    // Asked as the pane opens and not from an effect: each question writes where the
    // plan stands, and an effect that read that back would ask again for ever.
    for (const provider of ai.providers) void ask(provider.kind)
  })

  /** Where a plan stands, asked of whoever knows: the program, or the crate. */
  async function ask(kind: ProviderKind) {
    if (isLocal(kind)) await plans.check(kind)
    if (kind === 'chatgpt') await plans.checkChatgpt()
  }

  $effect(() => {
    // Every keyed provider in the list, asked whether this device holds its key. Reruns
    // when the list changes, which is what makes a new row say "not set" at once.
    for (const provider of ai.providers) {
      if (!isLocal(provider.kind) && provider.kind !== 'chatgpt') void look(provider.id)
    }
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
    if (!reachable(provider, ready(provider))) return

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

  function add(kind: ProviderKind) {
    ai.add(kind)
    void ask(kind)
  }

  function forget(provider: Provider) {
    if (!isLocal(provider.kind) && provider.kind !== 'chatgpt') void drop(provider)
    ai.remove(provider.id)
  }

  /** Claude Code's or Codex's own login, in a terminal tab; the pane closes so the tab
   *  can be seen, and the program is asked until it says it is signed in. */
  async function signInTo(kind: LocalKind) {
    const program = plans.local[kind].program
    if (!program) return
    const [{ signIn }, { settings }] = await Promise.all([
      import('./ai/local/signin'),
      import('./settings.svelte'),
    ])
    settings.open = false
    await signIn(kind, program)
    plans.watch(kind)
  }

  /** Sign in with ChatGPT: the browser, and back. */
  async function continueWithChatgpt(provider: Provider) {
    const mine = ++signIns
    signingIn = true
    trouble = { ...trouble, [provider.id]: '' }
    try {
      await invoke('chatgpt_sign_in')
      await plans.checkChatgpt()
      await refresh(provider)
    } catch (error) {
      // The crate's own words where OpenAI refused, and ours for a wait that ran out; a
      // second press giving up the first wait is no failure at all.
      const said = error instanceof Error ? error.message : String(error)
      if (said !== 'stopped') {
        trouble = {
          ...trouble,
          [provider.id]:
            said === 'timed out'
              ? t('Could not sign in.')
              : message(new Error(said), t('Could not sign in.')),
        }
      }
    } finally {
      if (signIns === mine) signingIn = false
    }
  }

  async function signOutOfChatgpt(provider: Provider) {
    await invoke('chatgpt_sign_out').catch((error: unknown) => {
      trouble = { ...trouble, [provider.id]: message(error, t('Could not sign out.')) }
    })
    plans.chatgptLimit = null
    await plans.checkChatgpt()
  }

  /** What a plan's limit is worth saying, or nothing while it is not near. */
  function limitWords(kind: LocalKind | 'chatgpt', limit: Limit | null): string {
    if (!limit || limit.state === 'fine') return ''
    if (limit.state === 'reached') return limitSentence(PLAN_OF[kind], limit)
    return t('Your {plan} plan is near its limit.', { plan: PLAN_OF[kind] })
  }
</script>

<!-- Where a program on this machine stands: not installed, signed out, or whose plan it
     is signed in with. -->
{#snippet program(provider: Provider, kind: LocalKind)}
  {@const plan = plans.local[kind]}
  <div class="nib-setting setting">
    <span class="name">{t('Account')}</span>
    <div class="row">
      {#if plan.state === 'unknown' && !plan.program}
        <span class="hint">{t('Asking…')}</span>
      {:else if plan.state === 'missing'}
        <span class="hint">{t('Not installed')}</span>
        <button class="nib-chip" onclick={() => void openExternal(INSTALL[kind])}>
          {t('Install')}
        </button>
        <button class="nib-chip is-quiet" onclick={() => void plans.check(kind)}>
          {t('Check again')}
        </button>
      {:else if plan.state === 'in'}
        <span class="hint" title={plan.account ?? ''}>
          {plan.plan === 'API key'
            ? t('API key')
            : plan.plan
              ? t('{plan} plan', { plan: plan.plan })
              : t('Signed in')}
        </span>
      {:else}
        <button class="nib-chip" disabled={!plan.program} onclick={() => void signInTo(kind)}>
          {t('Sign in')}
        </button>
      {/if}
    </div>
  </div>

  <label class="nib-setting setting">
    <span class="name">{t('Model')}</span>
    <input
      class="nib-field inline"
      value={provider.model}
      placeholder={t('Default')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
      autocomplete="off"
      onchange={(event) => ai.update(provider.id, { model: event.currentTarget.value.trim() })}
    />
  </label>

  {@render limited(kind, plan.limit)}
{/snippet}

<!-- The ChatGPT plan's sign-in, as OpenAI asks it to look: its mark, and its words. -->
{#snippet chatgpt(provider: Provider)}
  <div class="nib-setting setting">
    <span class="name">{t('Account')}</span>
    <div class="row">
      {#if plans.chatgpt}
        <span class="hint">{plans.chatgpt.email ?? t('Signed in')}</span>
        <button class="nib-chip is-quiet" onclick={() => void signOutOfChatgpt(provider)}>
          {t('Sign out')}
        </button>
      {:else if plans.chatgpt === null}
        {#if signingIn}<span class="hint">{t('Asking…')}</span>{/if}
        <button class="nib-chip continue" onclick={() => void continueWithChatgpt(provider)}>
          <ChatGptMark />
          {t('Continue with ChatGPT')}
        </button>
      {:else}
        <span class="hint">{t('Asking…')}</span>
      {/if}
    </div>
  </div>
  {@render limited('chatgpt', plans.chatgptLimit)}
{/snippet}

<!-- A plan near or at its limit, said as the reader's own, with where to see it. -->
{#snippet limited(kind: LocalKind | 'chatgpt', limit: Limit | null)}
  {#if limitWords(kind, limit)}
    <div class="nib-setting setting" transition:slide={{ duration: dur(160) }}>
      <span class="name hint">{limitWords(kind, limit)}</span>
      <button class="nib-chip is-quiet" onclick={() => void openExternal(USAGE_OF[kind])}>
        {t('Manage usage')}
      </button>
    </div>
  {/if}
{/snippet}

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
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            onchange={(event) => {
              ai.update(provider.id, { baseUrl: event.currentTarget.value })
              void refresh({ ...provider, baseUrl: event.currentTarget.value })
            }}
          />
        </label>
      {/if}

      {#if isLocal(provider.kind)}
        {@render program(provider, provider.kind)}
      {:else}
        {#if provider.kind === 'chatgpt'}
          {@render chatgpt(provider)}
        {:else}
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
        {/if}

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
                disabled={asking === provider.id || !reachable(provider, ready(provider))}
                onclick={() => void refresh(provider)}
              >
                {asking === provider.id ? t('Asking…') : t('List models')}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if trouble[provider.id]}
        <p class="hint bad">{trouble[provider.id]}</p>
      {/if}
    </div>
    {#if provider.kind === 'chatgpt' && plans.chatgpt}
      <!-- OpenAI's own words for it, beside the model it is spent on. -->
      <p class="hint caption">{t('Using ChatGPT plan')}</p>
    {/if}
  {/each}
{:else}
  <p class="hint">{t('No providers yet.')}</p>
{/if}

<!-- Adding one. The plans first on a desktop, then the three keyed kinds; the one that
     can be added more than once stays here after the others have gone. -->
<div class="card">
  {#each addable as kind (kind)}
    <button class="nib-action" onclick={() => add(kind)}>
      {t('Add {name}', { name: t(KIND_NAMES[kind]) })}
    </button>
  {/each}
</div>

<!-- Which provider each feature asks, once there is more than one to choose from. -->
{#if ai.providers.length > 1}
  <h3 transition:slide={{ duration: dur(160) }}>{t('Used for')}</h3>
  <div class="card" transition:slide={{ duration: dur(160) }}>
    {#each FEATURES as feature (feature.id)}
      <div class="nib-setting setting">
        <span class="name">{t(feature.label)}</span>
        <div class="pick">
          <Select
            value={ai.uses[feature.id] ?? ''}
            options={[
              { value: '', label: t('Default') },
              ...ai.providers.map((one) => ({ value: one.id, label: named(one) })),
            ]}
            onchange={(value: string) => ai.use(feature.id, value)}
            label={t(feature.label)}
            plain={viewport.touch}
          />
        </div>
      </div>
    {/each}
  </div>
{/if}

<!-- The two things worth a sentence: where a key goes, and that an answer can be
     wrong. The second is Anthropic's condition for Claude Code inside nib, and true of
     every provider; see docs/ai.md, Your own plan. -->
<p class="hint caption">
  {#if keysAreGuarded()}
    {t('Keys stay in the secure store on this device.')}
  {:else}
    {t('This browser holds the keys in its own storage.')}
  {/if}
</p>
<p class="hint caption">{t('AI can be wrong. Check the facts.')}</p>

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

  /* The ChatGPT mark beside its words, as OpenAI's own button has it. */
  .continue {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
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
</style>
