<script lang="ts">
  /** The LLM access pane: what is connected, and how to connect one more.
   *
   *  A client is given one URL and signs the person in itself, so the pane is
   *  a picker for the client, the few clicks that client needs, and a copy
   *  button next to each value that has to be typed somewhere else. The
   *  pasted-token way is still here for clients that cannot sign in, folded
   *  away under Other so it does not distract anyone who does not need it. */
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { MCP_URL } from './api'
  import { segmented } from './slide'
  import { account } from './account.svelte'
  import { type Client, connectors } from './connectors.svelte'
  import Copyable from './Copyable.svelte'
  import CopyButton from './CopyButton.svelte'
  import { i18n, t } from './i18n.svelte'
  import { reach } from './agents/settings/reach.svelte'
  import { settings } from './settings.svelte'
  import { openExternal } from './tauri'
  import { dur } from './motion'

  const CLAUDE_CONNECTORS = 'https://claude.ai/settings/connectors'
  const CHATGPT_PLUGINS = 'https://chatgpt.com/plugins'
  const CLAUDE_CODE = `claude mcp add --transport http nib ${MCP_URL}`

  const CLIENTS = $derived<{ id: Client; label: string }[]>([
    { id: 'claude', label: 'Claude' },
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'other', label: t('Other') },
  ])

  let showCode = $state(false)
  let showConfig = $state(false)

  /** What a client that takes a JSON block wants: the URL, and the token
   *  where there is one for a client that cannot sign in. */
  const config = (token?: string | null) =>
    JSON.stringify(
      {
        mcpServers: {
          nib: {
            url: MCP_URL,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          },
        },
      },
      null,
      2,
    )

  const when = (at: number | null) =>
    at
      ? t('Last used {time}.', {
          time: i18n.when(at, { dateStyle: 'short', timeStyle: 'medium' }),
        })
      : t('Not used yet.')

  const access = (readOnly: boolean) =>
    readOnly ? t('Reads your notes.') : t('Reads and writes your notes.')

  // Kept fresh while the pane shows: the moment a client has signed in, it
  // appears under Connected without anyone reloading anything.
  $effect(() => {
    if (!account.user) return
    return connectors.watch()
  })

  const connected = $derived(connectors.clients.length > 0 || !!connectors.token?.exists)
</script>

{#snippet chevron(open: boolean)}
  <svg class="chevron" class:open viewBox="0 0 16 16" aria-hidden="true"
    ><path d="M6 3l5 5-5 5" /></svg
  >
{/snippet}

<div class="llm">
  {#if !account.user}
    <p class="note">{t('Sign in first - the connector reaches the notes in your account.')}</p>
  {:else}
    {#if connected}
      <h3>{t('Connected')}</h3>
      <div class="card">
        {#each connectors.clients as one (one.id)}
          <div class="row" transition:slide={{ duration: dur(180), easing: cubicOut }}>
            <span class="name">
              {one.name}
              <small>{access(one.readOnly)} {when(one.lastUsedAt)}</small>
            </span>
            <button class="quiet danger" onclick={() => connectors.disconnect(one.id)}>
              {t('Disconnect')}
            </button>
          </div>
        {/each}

        {#if connectors.token?.exists}
          <div class="row" transition:slide={{ duration: dur(180), easing: cubicOut }}>
            <span class="name">
              {t('Pasted token')}
              <small>{access(connectors.token.readOnly)} {when(connectors.token.lastUsedAt)}</small>
            </span>
            <button
              class="quiet danger"
              disabled={connectors.busy}
              onclick={() => connectors.revokeToken()}
            >
              {t('Revoke')}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <h3>{connected ? t('Connect another') : t('Connect')}</h3>
    <p class="note">
      {t(
        'An AI assistant can read your notes - and change them, if you allow it. It signs in with your nibeditor email; there is nothing to paste.',
      )}
    </p>

    <div class="nib-segmented" role="tablist" use:segmented>
      {#each CLIENTS as one (one.id)}
        <button
          role="tab"
          class:on={connectors.client === one.id}
          aria-selected={connectors.client === one.id}
          onclick={() => connectors.choose(one.id)}
        >
          {one.label}
        </button>
      {/each}
    </div>

    {#key connectors.client}
      <div class="steps-wrap" in:fly={{ y: 6, duration: dur(180), easing: cubicOut }}>
        {#if connectors.client === 'claude'}
          <ol class="steps">
            <li>
              <p>{t('In Claude, open Settings → Connectors and click Add custom connector.')}</p>
              <button class="link" onclick={() => void openExternal(CLAUDE_CONNECTORS)}>
                {t('Open Claude’s connectors')}
                <svg class="nib-mirror" viewBox="0 0 16 16" aria-hidden="true"
                  ><path d="M6 3h7v7M13 3L5 11" /></svg
                >
              </button>
            </li>
            <li>
              <p>{t('Fill in the two fields and click Add.')}</p>
              <Copyable label={t('Name')} value="nibeditor" />
              <Copyable label="URL" value={MCP_URL} />
            </li>
            <li>
              <p>{t('Click Connect and sign in with your nibeditor email.')}</p>
            </li>
          </ol>

          <button class="disclose" aria-expanded={showCode} onclick={() => (showCode = !showCode)}>
            {@render chevron(showCode)}
            {t('Using Claude Code instead?')}
          </button>
          {#if showCode}
            <div class="disclosed" transition:slide={{ duration: dur(180), easing: cubicOut }}>
              <Copyable label={t('Command')} value={CLAUDE_CODE} />
              <p class="hint">
                {t('Run it in a terminal, then type /mcp in Claude Code to sign in.')}
              </p>
            </div>
          {/if}
        {:else if connectors.client === 'chatgpt'}
          <!-- ChatGPT keeps custom MCP servers under Plugins, behind its
               Developer mode. Checked against the app in September 2026. -->
          <ol class="steps">
            <li>
              <p>{t('In ChatGPT, open Settings → Plugins and click the plus button.')}</p>
              <button class="link" onclick={() => void openExternal(CHATGPT_PLUGINS)}>
                {t('Open ChatGPT’s plugins')}
              </button>
              <p class="hint">
                {t(
                  'No Plugins section or no plus button? Turn on Developer mode first, under Settings → Security and login.',
                )}
              </p>
            </li>
            <li>
              <p>{t('Fill in the form and click Create.')}</p>
              <Copyable label={t('Name')} value="nibeditor" />
              <Copyable label={t('Server URL')} value={MCP_URL} />
              <Copyable label={t('Authentication')} value="OAuth" plain />
              <p class="hint">
                {t(
                  'Leave the advanced OAuth settings as they are and tick “I understand and want to continue”.',
                )}
              </p>
            </li>
            <li>
              <p>{t('Sign in with your nibeditor email when ChatGPT asks.')}</p>
              <p class="hint">{t('To use it in a chat, type @ and pick nibeditor.')}</p>
            </li>
          </ol>
        {:else}
          <div class="steps-wrap">
            <p class="note">
              {t(
                'Any MCP client that speaks Streamable HTTP with OAuth. Give it the URL: it registers itself and opens nibeditor’s sign-in page.',
              )}
            </p>
            <Copyable label={t('Server URL')} value={MCP_URL} />

            <button
              class="disclose"
              aria-expanded={showConfig}
              onclick={() => (showConfig = !showConfig)}
            >
              {@render chevron(showConfig)}
              {t('Show config')}
            </button>
            {#if showConfig}
              <div class="disclosed" transition:slide={{ duration: dur(180), easing: cubicOut }}>
                <p class="hint">{t('For a client that takes a JSON block instead of a URL.')}</p>
                <pre>{config()}</pre>
                <CopyButton value={config()} wide />

                <p class="hint spaced">
                  {t(
                    'A client that cannot sign in can be given a token instead. It is shown only once.',
                  )}
                </p>
                <button
                  class="switch"
                  role="switch"
                  aria-checked={!connectors.readOnly}
                  onclick={() => connectors.setReadOnly(!connectors.readOnly)}
                >
                  <span class="name">{t('Let it write to my notes, not only read them')}</span>
                  <span class="nib-switch" class:on={!connectors.readOnly} aria-hidden="true"
                  ></span>
                </button>

                {#if connectors.freshToken}
                  <div class="fresh" transition:slide={{ duration: dur(200), easing: cubicOut }}>
                    <pre>{config(connectors.freshToken)}</pre>
                    <CopyButton value={config(connectors.freshToken)} wide />
                  </div>
                {:else}
                  <button
                    class="nib-button"
                    disabled={connectors.busy}
                    onclick={() => connectors.createToken()}
                  >
                    {connectors.token?.exists ? t('Replace the token') : t('Create a token')}
                  </button>
                {/if}
                {#if connectors.error}
                  <p class="hint bad">{connectors.error}</p>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/key}
  {/if}

  <!-- The other half: this connector reaches the account's notes from anywhere, and the
       agents on this computer reach everything nib has open. See
       agents/settings/AgentsPane.svelte, which leads back here. -->
  {#if !__EVEN_PLUGIN__ && reach.offered}
    <button class="link" onclick={() => (settings.section = 'agents')}>
      {t('Agents on this computer')}
      {@render chevron(false)}
    </button>
  {/if}
</div>

<style>
  .llm {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  h3:first-child {
    margin-top: 0;
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
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

  .hint.spaced {
    margin-top: var(--space-3);
  }

  /* ── What is connected ─────────────────────────────────────────── */

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

  .row .name,
  .switch .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* Choosing the client is the app's one segmented control; see .nib-segmented
     in the themes package. */

  /* ── The steps ─────────────────────────────────────────────────── */

  .steps-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: step;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .steps li {
    position: relative;
    padding-inline-start: 34px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    counter-increment: step;
  }

  /* The number, drawn as a small badge so the eye finds the next step. */
  .steps li::before {
    content: counter(step);
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: 22px;
    text-align: center;
  }

  .steps li > p:first-child {
    margin: 0;
    min-height: 22px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
    line-height: 22px;
  }

  /* A value with its copy button is one component; see Copyable.svelte. */

  /* ── Links and disclosures ─────────────────────────────────────── */

  .link,
  .disclose {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .link {
    color: var(--accent);
  }

  .link svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .disclose {
    color: var(--muted-strong);
    font-weight: var(--weight-strong);
  }

  @media (hover: hover) {
    .link:hover {
      color: var(--accent-hover);
    }

    .disclose:hover {
      color: var(--text-strong);
    }
  }

  .link:focus-visible,
  .disclose:focus-visible {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .chevron {
    width: 12px;
    height: 12px;
    fill: none;
    transform: scaleX(var(--dir));
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .chevron.open {
    transform: scaleX(var(--dir)) rotate(90deg);
  }

  .disclosed,
  .fresh {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-inline-start: 17px;
  }

  .fresh {
    padding-inline-start: 0;
  }

  pre {
    width: 100%;
    margin: 0;
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-x: auto;
    color: var(--muted-strong);
  }

  /* ── Buttons ───────────────────────────────────────────────────── */

  /* The one thing to press is `.nib-button` in the themes package; here it only
     keeps to its own width in the column. */
  .nib-button {
    align-self: flex-start;
  }

  button.quiet {
    align-self: flex-start;
    flex: none;
    padding: 9px 14px;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button.quiet {
    background: none;
    color: var(--muted);
    padding-inline-end: 0;
  }

  @media (hover: hover) {
    button.quiet:hover:not(:disabled) {
      color: var(--text);
    }

    button.quiet.danger:hover:not(:disabled) {
      color: var(--danger);
    }
  }

  /* The switch, drawn like the panel's so the two read as one control. */
  .switch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 38px;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
  }

  .switch:focus-visible {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
</style>
