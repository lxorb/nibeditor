<script lang="ts">
  /** Deleting the account, from the row in Settings that asks for it.
   *
   *  The session is not enough, because the session is the thing most likely to be
   *  in the wrong hands: pressing the row mails a fresh code to the account's own
   *  address, and an account with a second factor is asked for that too. The codes
   *  earn a ticket, and only then is the last question asked - so a mistyped code is
   *  said before anybody has confirmed anything. See services/sync/src/account.ts.
   *
   *  What goes is the account and its synced copies. The notes on this device are
   *  files on this device, and nothing here touches them: the app is signed out the
   *  way the Sign out row signs it out, which stops the syncing and the rooms and
   *  leaves every folder where it is.
   *
   *  Fetched on the press, like everything a pane shows only once somebody asks: the
   *  three requests and this flow are nothing the settings need in order to open. */

  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'

  import { account } from './account.svelte'
  import { ApiError, request } from './api'
  import { i18n, message, t } from './i18n.svelte'
  import { dur } from './motion'

  const { onend }: { onend: () => void } = $props()

  /** The account's own spaces somebody else is in, by name: deleting the account
   *  takes them away from those people too, which is the one thing the last question
   *  must not leave out. */
  const shared = $derived(
    new Intl.ListFormat(i18n.language).format(
      account.spaces.filter((one) => one.role === 'owner' && one.shared).map((one) => one.name),
    ),
  )

  /** The codes, or the one question after them. */
  let stage = $state<'codes' | 'sure'>('codes')
  /** Whether the account asks for its authenticator's code as well. */
  let second = $state(false)
  let code = $state('')
  let fromApp = $state('')
  let busy = $state(false)
  let wrong = $state<string | null>(null)
  let resendIn = $state(0)
  let field = $state<HTMLInputElement | null>(null)

  /** What the codes earned, spent by the last press. Not state: nothing draws it. */
  let ticket: string | null = null

  async function mail() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      const sent = await request<{ resendIn: number; second: boolean }>('/v1/account/delete/code', {
        token,
        body: {},
      })
      second = sent.second
      countDown(sent.resendIn)
      field?.focus()
    } catch (error) {
      wrong = message(error, 'could not reach the server')
    } finally {
      busy = false
    }
  }

  async function prove() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      const proved = await request<{ ticket: string }>('/v1/account/delete/verify', {
        token,
        body: { code, ...(second ? { second: fromApp } : {}) },
      })
      ticket = proved.ticket
      stage = 'sure'
    } catch (error) {
      wrong = message(error, 'that code is not right')
    } finally {
      busy = false
    }
  }

  async function leave() {
    const token = account.accountToken
    if (!token || !ticket || busy) return

    busy = true
    wrong = null

    try {
      await request<{ ok: true }>('/v1/account', { method: 'DELETE', token, body: { ticket } })
    } catch (error) {
      // A session the service no longer knows is an account that has already gone:
      // an answer lost on the way back from a delete that happened.
      if (!(error instanceof ApiError && error.status === 401)) {
        wrong = message(error, 'that did not work')
        busy = false
        return
      }
    }

    // Signed out the way the Sign out row signs out, which lets go of the session
    // before it asks anything of the network: the pane is "not signed in" from here.
    void account.signOut()
    onend()
  }

  let timer: ReturnType<typeof setInterval> | undefined

  /** How long until another code may be asked for, counted down where it shows. */
  function countDown(seconds: number) {
    clearInterval(timer)
    resendIn = seconds

    timer = setInterval(() => {
      resendIn -= 1
      if (resendIn <= 0) clearInterval(timer)
    }, 1000)
  }

  // Pressing the row is asking for the code.
  onMount(() => {
    void mail()
    return () => clearInterval(timer)
  })
</script>

<div class="leaving" transition:fade={{ duration: dur(130) }}>
  <p class="hint">{t('Notes on this device stay; only the account and its synced copies go.')}</p>

  {#if stage === 'codes'}
    <form
      onsubmit={(event) => {
        event.preventDefault()
        void prove()
      }}
    >
      <label class="nib-setting setting">
        <span class="name">{t('Code sent to')} <strong>{account.user?.email}</strong></span>
        <input
          class="inline"
          bind:this={field}
          bind:value={code}
          placeholder="000000"
          aria-label={t('Code')}
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
      </label>
      {#if second}
        <label class="nib-setting setting" transition:fade={{ duration: dur(130) }}>
          <span class="name">{t('Code from the app')}</span>
          <input
            class="inline"
            bind:value={fromApp}
            placeholder="000000"
            aria-label={t('Code from the app')}
            inputmode="numeric"
            autocomplete="one-time-code"
            spellcheck="false"
          />
        </label>
      {/if}
      <div class="nib-setting setting">
        <button
          type="button"
          class="nib-chip is-quiet resend"
          disabled={busy || resendIn > 0}
          onclick={() => void mail()}
        >
          {resendIn > 0 ? t('Resend in {seconds}s', { seconds: resendIn }) : t('Send a new code')}
        </button>
        <button type="button" class="nib-chip is-quiet" onclick={onend}>{t('Cancel')}</button>
        <button type="submit" class="nib-chip" disabled={busy || !code.trim()}>
          {t('Continue')}
        </button>
      </div>
    </form>
  {:else}
    {#if shared}
      <p class="hint" transition:fade={{ duration: dur(130) }}>
        {t('Also gone for everyone in {spaces}.', { spaces: shared })}
      </p>
    {/if}
    <button class="nib-action is-danger" disabled={busy} onclick={() => void leave()}>
      {t('Delete now')}
    </button>
    <button class="nib-action" disabled={busy} onclick={onend}>{t('Cancel')}</button>
  {/if}

  {#if wrong}
    <p class="hint bad" transition:fade={{ duration: dur(130) }}>{wrong}</p>
  {/if}
</div>

<style>
  /* The settings pane's own shapes, as Security.svelte carries them: a component
     does not inherit the panel's scoped styles. See SettingsPanel.svelte. */
  .leaving {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
    min-width: 0;
  }

  .name strong {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  /* The first of the three answers sits apart from the two that end the row. */
  .resend {
    margin-inline-end: auto;
  }

  .inline {
    flex: none;
    width: 8rem;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: end;
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .inline::placeholder {
    color: var(--muted);
  }

  .inline:focus {
    background: var(--bg);
  }

  @media (hover: hover) {
    .inline:hover {
      border-color: var(--line);
    }
  }

  .hint {
    margin: var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  :global(.sheet.phone) .inline {
    min-height: var(--touch-target);
    padding: 8px 10px;
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .setting {
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .hint {
    padding: 0 var(--touch-pad);
  }
</style>
