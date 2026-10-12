<script lang="ts">
  /** The account connector's steps for one way in (Settings > AI > Access): Claude's,
   *  ChatGPT's, or any client that speaks MCP over the web, with the token for one that
   *  cannot sign in.
   *
   *  A client is given one URL and signs the person in itself, so this is the few clicks
   *  that client needs and a copy button next to each value that has to be typed
   *  somewhere else. The pasted-token way is folded away under Other so it does not
   *  distract anyone who does not need it. What is connected is listed with everything
   *  else that reaches the notes, in Access.svelte. */
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { MCP_URL } from '../api'
  import { connectors } from '../connectors.svelte'
  import Copyable from '../Copyable.svelte'
  import CopyButton from '../CopyButton.svelte'
  import { t } from '../i18n.svelte'
  import { openExternal } from '../tauri'
  import { dur } from '../motion'

  const { client }: { client: 'claude' | 'chatgpt' | 'other' } = $props()

  const CLAUDE_CONNECTORS = 'https://claude.ai/settings/connectors'
  const CHATGPT_PLUGINS = 'https://chatgpt.com/plugins'
  const CLAUDE_CODE = `claude mcp add --transport http nib ${MCP_URL}`

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
</script>

{#snippet chevron(open: boolean)}
  <svg class="chevron" class:open viewBox="0 0 16 16" aria-hidden="true"
    ><path d="M6 3l5 5-5 5" /></svg
  >
{/snippet}

{#key client}
  <div class="steps-wrap" in:fly={{ y: 6, duration: dur(180), easing: cubicOut }}>
    {#if client === 'claude'}
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
    {:else if client === 'chatgpt'}
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
              <span class="nib-switch" class:on={!connectors.readOnly} aria-hidden="true"></span>
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

<style>
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

  .switch .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

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
