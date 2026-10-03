<script lang="ts">
  /** A plan's rows in Settings > AI: Claude Code's or Codex's account and model, or the
   *  ChatGPT sign-in, and the limit once it is near.
   *
   *  Its own component rather than snippets of AiPane's, because only a desktop has a
   *  plan to offer (see `offeredKinds`), and the glasses' plugin leaves a component out
   *  whole where it would carry a snippet's words and every module behind them. */
  import { slide } from 'svelte/transition'
  import { USAGE } from './chatgpt'
  import ChatGptMark from './ChatGptMark.svelte'
  import { plans } from './local/status.svelte'
  import { limitSentence } from './local/trouble'
  import type { Limit } from './local/heard'
  import type { LocalKind, Provider } from './providers'
  import { ai } from './store.svelte'
  import { message, t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { invoke, openExternal } from '../tauri'

  interface Props {
    provider: Provider
    kind: LocalKind | 'chatgpt'
    /** Asks the provider for its models again, once a sign-in has landed. */
    refresh: (provider: Provider) => Promise<void>
    /** What went wrong, for the pane to say under the card; empty takes it back. */
    trouble: (said: string) => void
  }

  const { provider, kind, refresh, trouble }: Props = $props()

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

  /** Claude Code's or Codex's own login, in a terminal tab; the pane closes so the tab
   *  can be seen, and the program is asked until it says it is signed in. */
  async function signInTo(kind: LocalKind) {
    const program = plans.local[kind].program
    if (!program) return
    const [{ signIn }, { settings }] = await Promise.all([
      import('./local/signin'),
      import('../settings.svelte'),
    ])
    settings.open = false
    await signIn(kind, program)
    plans.watch(kind)
  }

  /** Sign in with ChatGPT: the browser, and back. */
  async function continueWithChatgpt() {
    const mine = ++signIns
    signingIn = true
    trouble('')
    try {
      await invoke('chatgpt_sign_in')
      await plans.checkChatgpt()
      await refresh(provider)
    } catch (error) {
      // The crate's own words where OpenAI refused, and ours for a wait that ran out; a
      // second press giving up the first wait is no failure at all.
      const said = error instanceof Error ? error.message : String(error)
      if (said !== 'stopped') {
        trouble(
          said === 'timed out'
            ? t('Could not sign in.')
            : message(new Error(said), t('Could not sign in.')),
        )
      }
    } finally {
      if (signIns === mine) signingIn = false
    }
  }

  async function signOutOfChatgpt() {
    await invoke('chatgpt_sign_out').catch((error: unknown) => {
      trouble(message(error, t('Could not sign out.')))
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
{#snippet program(kind: LocalKind)}
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
{#snippet chatgpt()}
  <div class="nib-setting setting">
    <span class="name">{t('Account')}</span>
    <div class="row">
      {#if plans.chatgpt}
        <span class="hint">{plans.chatgpt.email ?? t('Signed in')}</span>
        <button class="nib-chip is-quiet" onclick={() => void signOutOfChatgpt()}>
          {t('Sign out')}
        </button>
      {:else if plans.chatgpt === null}
        {#if signingIn}<span class="hint">{t('Asking…')}</span>{/if}
        <button class="nib-chip continue" onclick={() => void continueWithChatgpt()}>
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

{#if kind === 'chatgpt'}
  {@render chatgpt()}
{:else}
  {@render program(kind)}
{/if}

<style>
  /* AiPane's shapes for the rows it hands this, since a component's styles are its
     own; the values are AiPane's, which has them from the settings panel. */
  .setting .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

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

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }
</style>
