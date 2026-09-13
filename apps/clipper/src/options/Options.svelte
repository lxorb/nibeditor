<script lang="ts">
  import { firstOf, refreshSpaces } from '../lib/account'
  import { api, type Space } from '../lib/api'
  import { openShortcuts } from '../lib/browser'
  import { i18n, t } from '../lib/i18n.svelte'
  import { modelsOf, ollamaModels } from '../lib/interpret'
  import { OLLAMA, PROVIDER_IDS, PROVIDERS } from '../lib/interpret/providers'
  import { readTemplates, TEMPLATES } from '../lib/interpret/templates'
  import { opened } from '../lib/opened'
  import SignIn from '../lib/SignIn.svelte'
  import { forget, remember, settings, type Theme } from '../lib/settings'
  import { applyTheme, followSystem } from '../lib/theme'
  import { CATALOGUES_URL, LANGUAGES } from '../lib/translate'

  const held = opened()

  const THEMES: { id: Theme; name: string }[] = [
    { id: 'system', name: 'Match the system' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
  ]

  let token = $state(held.token)
  let email = $state(held.email)
  let spaces = $state<Space[]>(held.spaces)
  let spaceId = $state(firstOf(held.spaces, held.target.spaceId))
  let folder = $state(held.target.folder)
  let theme = $state(held.theme)

  /** The interpreter's half of this page.
   *
   *  A key and a chosen model belong to their provider, so both are kept by
   *  provider and only the chosen one is in a field: switching from Claude to a
   *  model on the machine and back does not lose the key that was typed. These two
   *  maps are plain rather than reactive - nothing draws them, the fields do. */
  const keys = { ...held.interpreter.keys }
  const models = { ...held.interpreter.models }

  const opening = held.interpreter.provider

  let provider = $state(opening)
  let key = $state(opening ? (keys[opening] ?? '') : '')
  let model = $state(opening ? (models[opening] ?? PROVIDERS[opening].model) : '')
  let address = $state(held.interpreter.address)
  let templates = $state(held.interpreter.templates)

  /** What the provider says it has, for the field to suggest, and what Ollama says
   *  it has on this machine, which is null until it has been asked and stays null
   *  when nothing answers there. */
  let offers = $state<string[]>([])
  let local = $state<string[] | null>(null)

  /** The first line of the templates that did not read, in words, or nothing at all
   *  while they all do. */
  const trouble = $derived.by(() => {
    const read = readTemplates(templates)
    return 'problem' in read ? t(read.problem, { line: read.line }) : ''
  })

  /** Whether it is worth suggesting what is already in use. */
  const suggest = $derived(!!local && !(provider === 'compatible' && address.trim() === OLLAMA))

  /** Written back whole, over what storage holds rather than over the snapshot this
   *  page opened with: the popup remembers its Interpret switches in the same entry
   *  and may have flipped one while this page was open. */
  async function keep() {
    if (provider) {
      keys[provider] = key
      models[provider] = model
    }

    const fresh = await settings()
    await remember({
      interpreter: {
        ...fresh.interpreter,
        provider,
        keys: { ...keys },
        models: { ...models },
        address,
        templates,
      },
    })
  }

  /** What models the chosen provider has. An answer of nothing is an answer: the
   *  field is typed into instead, which is what a server that lists nothing wants
   *  anyway. */
  async function look() {
    if (!provider) {
      offers = []
      return
    }

    offers = await modelsOf({ provider, key, address, model })

    // A provider that was just chosen has no model yet, and the first one it lists
    // is a better guess than an empty field.
    const first = offers[0]
    if (first && !model.trim()) {
      model = first
      await keep()
    }
  }

  function choose(next: string) {
    if (provider) {
      keys[provider] = key
      models[provider] = model
    }

    provider = PROVIDER_IDS.find((one) => one === next) ?? null
    key = provider ? (keys[provider] ?? '') : ''
    model = provider ? (models[provider] ?? PROVIDERS[provider].model) : ''

    void keep().then(look)
  }

  /** Local first: the address, no key, and the first model it has. */
  function useLocal() {
    provider = 'compatible'
    address = OLLAMA
    key = ''
    model = local?.[0] ?? ''
    offers = local ?? []

    void keep()
  }

  function restore() {
    templates = TEMPLATES
    void keep()
  }

  // Once, as the page opens rather than from an effect: both of these read the
  // fields, and an effect that read them would run again on every keystroke in
  // them. Neither holds the page up.
  void ollamaModels().then((found) => (local = found))
  void look()

  $effect(() => {
    if (!token) return

    void refreshSpaces(token)
      .then((listed) => {
        spaces = listed
        spaceId = firstOf(listed, spaceId)
      })
      .catch(() => {
        // The remembered list stays on screen; there is nothing here to say
        // that the picker does not already show.
      })
  })

  // The choice can be the system's, and the system can change while this page
  // is open on it.
  $effect(() => followSystem(() => theme))

  function chooseTheme(next: Theme) {
    theme = next
    applyTheme(next)
    void remember({ theme: next })
  }

  function chooseLanguage(next: string) {
    void i18n.use(next)
    void remember({ language: next })
  }

  function chooseTarget() {
    void remember({ target: { spaceId, folder } })
  }

  async function signOut() {
    const going = token
    await forget()

    token = null
    email = null
    spaces = []

    // The session is gone from this browser either way; telling the service is
    // a courtesy that a network failure must not undo.
    if (going) await api.signOut(going).catch(() => undefined)
  }
</script>

<main>
  {#if token}
    <section>
      <div class="setting">
        <span class="name">{t('Account')}</span>
        <span class="value">{email}</span>
      </div>

      <div class="setting">
        <span class="name">{t('Space')}</span>
        <select
          bind:value={spaceId}
          onchange={chooseTarget}
          aria-label={t('Space')}
          disabled={!spaces.length}
        >
          {#each spaces as space (space.id)}
            <option value={space.id}>{space.name}</option>
          {/each}
        </select>
      </div>

      <label class="setting">
        <span class="name">{t('Folder')}</span>
        <input bind:value={folder} oninput={chooseTarget} spellcheck="false" placeholder="/" />
      </label>
    </section>

    <section>
      <div class="setting">
        <span class="name">{t('Interpreter')}</span>
        <select
          value={provider ?? 'off'}
          onchange={(event) => choose(event.currentTarget.value)}
          aria-label={t('Interpreter')}
        >
          <option value="off">{t('Off')}</option>
          {#each PROVIDER_IDS as one (one)}
            <option value={one}>{t(PROVIDERS[one].name)}</option>
          {/each}
        </select>
      </div>

      {#if suggest}
        <div class="setting">
          <span class="name">{t('Ollama is running here')}</span>
          <button class="quiet" type="button" onclick={useLocal}>{t('Use it')}</button>
        </div>
      {/if}

      {#if provider}
        {#if provider === 'compatible'}
          <label class="setting">
            <span class="name">{t('Address')}</span>
            <!-- Typed, kept, and asked nothing. Looking a provider's models up sends
                 the key, and this field is half an address for as long as somebody is
                 typing it: a blur used to hand the key to whatever host was in it,
                 which for a typo or a paste is somebody else's server. The models are
                 looked up when the key is committed or a provider is chosen, both of
                 which are somebody saying so about the provider rather than about the
                 letters in a hostname - and `reachable` in interpret/providers.ts is
                 what refuses the request either way. -->
            <input
              bind:value={address}
              oninput={() => void keep()}
              spellcheck="false"
              placeholder={OLLAMA}
            />
          </label>
        {/if}

        <label class="setting">
          <span class="name">{t('API key')}</span>
          <input
            type="password"
            bind:value={key}
            oninput={() => void keep()}
            onchange={() => void look()}
            spellcheck="false"
            autocomplete="off"
          />
        </label>

        <label class="setting">
          <span class="name">{t('Model')}</span>
          <input bind:value={model} oninput={() => void keep()} spellcheck="false" list="models" />
        </label>

        <datalist id="models">
          {#each offers as one (one)}
            <option value={one}></option>
          {/each}
        </datalist>

        <p class="said">
          {t(
            'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.',
          )}
        </p>

        <div class="setting">
          <span class="name">{t('Templates')}</span>
          <button class="quiet" type="button" onclick={restore}>{t('Reset')}</button>
        </div>

        <textarea
          bind:value={templates}
          oninput={() => void keep()}
          spellcheck="false"
          aria-label={t('Templates')}></textarea>

        {#if trouble}
          <p class="said bad">{trouble}</p>
        {/if}
      {/if}
    </section>

    <section>
      <div class="setting">
        <span class="name">{t('Language')}</span>
        <select
          value={i18n.choice}
          onchange={(event) => chooseLanguage(event.currentTarget.value)}
          aria-label={t('Language')}
        >
          {#each LANGUAGES as language (language.id)}
            <option value={language.id}>{t(language.name)}</option>
          {/each}
        </select>
      </div>

      <!-- Most of the catalogues were written in one pass and never read through.
           Saying so is the honest part; the link is the useful part, because the
           reader who can see the wrong word is the only person who can put it
           right. The app's language row says the same thing. -->
      {#if i18n.machine}
        <p class="said">
          <a href={CATALOGUES_URL} target="_blank" rel="noreferrer">
            {t('Machine-translated. Corrections welcome.')}
          </a>
        </p>
      {/if}

      <div class="setting">
        <span class="name">{t('Appearance')}</span>
        <select
          value={theme}
          onchange={(event) => chooseTheme(event.currentTarget.value as Theme)}
          aria-label={t('Appearance')}
        >
          {#each THEMES as one (one.id)}
            <option value={one.id}>{t(one.name)}</option>
          {/each}
        </select>
      </div>

      <div class="setting">
        <span class="name">{t('Shortcuts')}</span>
        <button class="quiet" type="button" onclick={openShortcuts}>{t('Open')}</button>
      </div>
    </section>

    <button class="out" type="button" onclick={() => void signOut()}>{t('Sign out')}</button>
  {:else}
    <SignIn
      onSignedIn={() => {
        const fresh = opened()
        token = fresh.token
        email = fresh.email
        spaces = fresh.spaces
      }}
    />
  {/if}
</main>

<style>
  main {
    width: min(30rem, calc(100vw - var(--space-6)));
    margin: var(--space-7) auto;
    padding: var(--space-2) var(--space-5) var(--space-5);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
  }

  section + section {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }

  /* The same row the app's settings use: the name on the left, the one control
     that changes it on the right. */
  .setting {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 46px;
    font-size: var(--text-sm);
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .value {
    color: var(--muted-strong);
  }

  /* A sentence rather than a setting: what the row above it does not say, and the
     one place on this page where a whole line of words is the point. */
  .said {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .said.bad {
    color: var(--danger);
  }

  /* The templates are the one thing here that is a document rather than a value, so
     they get the width of the card and a hand that does not change with the
     language. */
  textarea {
    display: block;
    width: 100%;
    height: 19rem;
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.55;
    resize: vertical;
  }

  textarea:focus-visible {
    border-color: var(--accent);
    outline: none;
  }

  .setting select,
  .setting input {
    flex: none;
    width: 14rem;
    padding: 7px 11px;
    font-size: var(--text-sm);
  }

  .setting select {
    padding-inline-end: 30px;
  }

  .quiet {
    padding: 6px 12px;
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .quiet:hover:not(:disabled) {
    background: var(--surface-3);
  }

  .quiet:active:not(:disabled) {
    background: var(--press);
  }

  .out {
    width: 100%;
    margin-top: var(--space-4);
    background: none;
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  .out:hover:not(:disabled) {
    background: none;
    color: var(--danger);
    transform: none;
  }
</style>
