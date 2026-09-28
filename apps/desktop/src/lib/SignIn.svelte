<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { t } from './i18n.svelte'
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { account } from './account.svelte'
  import { joining } from './joining.svelte'
  import { settleLocalNotes } from './settling'
  import { dur, LAYER } from './motion'
  import { trap } from './trap'

  const LENGTH = 6

  /** An empty row of boxes. `Array.fill` answers `any[]`, which is how an
   *  unchecked value would reach the markup. */
  const blank = () => Array.from({ length: LENGTH }, () => '')

  let digits = $state<string[]>(blank())
  const boxes = $state<HTMLInputElement[]>([])
  let emailField = $state<HTMLInputElement>()

  const entered = $derived(digits.join(''))

  /** The last code sent for checking. Without this the effect below would
   *  resubmit the same digits every time `busy` flips back, burning attempts. */
  let submitted = $state('')

  /** The second factor's other way in, for somebody without their phone. */
  let recovering = $state(false)
  let recovery = $state('')

  $effect(() => {
    if (account.open && account.step === 'email') emailField?.focus()
  })

  // Emptied on the way into either half: the second asks for six digits of its
  // own, and the emailed code sitting in the boxes is neither an answer nor
  // something to clear by hand.
  $effect(() => {
    if (account.step === 'code' || account.step === 'second') {
      digits = blank()
      submitted = ''
      setTimeout(() => boxes[0]?.focus(), 60)
    }
  })

  // Six digits is the whole code, so check it as soon as they are all there.
  // A rejected code empties the row, ready for the next attempt.
  $effect(() => {
    if (entered.length !== LENGTH || entered === submitted) return

    submitted = entered
    // Which half of the sign-in these six are is the store's to know: the emailed
    // code, or the one out of the app. See `code` in account.svelte.ts.
    void account.code(entered).then((accepted) => {
      if (accepted) {
        // The notes already on this machine are dealt with first, and only then
        // is the link walked through: the answer to that question can be to
        // erase what is here, and the space they came for must not be in it
        // yet when it is.
        void settleLocalNotes().then(() => joining.walkThrough())
        return
      }

      digits = blank()
      submitted = ''
      setTimeout(() => boxes[0]?.focus(), 0)
    })
  })

  function onDigit(index: number, event: Event) {
    const input = event.target as HTMLInputElement
    const value = input.value.replace(/\D/g, '')

    if (!value) {
      digits[index] = ''
      return
    }

    // A pasted code fills the row from wherever it landed.
    for (let offset = 0; offset < value.length && index + offset < LENGTH; offset++) {
      digits[index + offset] = value.charAt(offset)
    }

    input.value = digits[index] ?? ''
    boxes[Math.min(index + value.length, LENGTH - 1)]?.focus()
  }

  function onDigitKey(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault()
      digits[index - 1] = ''
      boxes[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) boxes[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < LENGTH - 1) boxes[index + 1]?.focus()
  }

  /** Which door was taken; both lead to the same code. See `mode`. */
  const heading = $derived(account.mode === 'create' ? t('Create account') : t('Sign in'))

  function close() {
    account.open = false
    account.step = 'email'
    account.error = null
  }

  // Back closes this before it leaves the app.
  $effect(() => (account.open ? overlays.show(() => (account.open = false)) : undefined))
  $effect(() => closeOnBack(account.open, () => (account.open = false)))
</script>

{#if account.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="nib-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={close}></div>

  <div
    class="nib-screen panel"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={heading}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <!-- Somebody sent a link here, so say what it was before asking for an
         address: signing in is the whole of what it takes to open it. -->
    {#if joining.invitation}
      <p class="shared">
        {t('{who} shared {space} with you', {
          who: joining.invitation.from ?? t('Somebody'),
          space: joining.invitation.space,
        })}
      </p>
    {/if}

    {#if account.step === 'email'}
      <h2 class="heading">{heading}</h2>
      <form
        in:fly={{ x: -14, duration: dur(200), easing: cubicOut }}
        onsubmit={(event) => {
          event.preventDefault()
          void account.requestCode()
        }}
      >
        <input
          bind:this={emailField}
          bind:value={account.email}
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          aria-label={t('Email address')}
          spellcheck="false"
          required
        />
        <button class="nib-button" type="submit" disabled={account.busy}>
          {account.busy ? t('Sending') : t('Continue')}
        </button>
      </form>
    {:else if account.step === 'second'}
      <!-- The other half, for an account with a second factor. The same six
           boxes: what is typed into them is six digits either way, and the one
           thing that is different is where they come from. A recovery code is
           longer and goes in the field under them, for the day the phone is
           gone. See services/sync/src/second.ts. -->
      <div class="code" in:fly={{ x: 14, duration: dur(200), easing: cubicOut }}>
        <p class="sent">{t('Now the code from your authenticator app')}</p>

        <div class="digits">
          {#each digits as digit, index (index)}
            <input
              bind:this={boxes[index]}
              value={digit}
              oninput={(event) => onDigit(index, event)}
              onkeydown={(event) => onDigitKey(index, event)}
              inputmode="numeric"
              autocomplete={index === 0 ? 'one-time-code' : 'off'}
              maxlength="6"
              aria-label={t('Digit {number}', { number: index + 1 })}
              style:animation-delay="{index * 32}ms"
            />
          {/each}
        </div>

        {#if recovering}
          <form
            onsubmit={(event) => {
              event.preventDefault()
              void account.second(recovery)
            }}
          >
            <input
              bind:value={recovery}
              type="text"
              placeholder={t('Recovery code')}
              aria-label={t('Recovery code')}
              spellcheck="false"
            />
            <button class="nib-button" type="submit" disabled={account.busy}>{t('Continue')}</button
            >
          </form>
        {:else}
          <button class="link" type="button" onclick={() => (recovering = true)}>
            {t('Use a recovery code')}
          </button>
        {/if}
      </div>
    {:else}
      <div class="code" in:fly={{ x: 14, duration: dur(200), easing: cubicOut }}>
        <p class="sent">{t('Code sent to')} <strong>{account.email}</strong></p>

        <div class="digits">
          {#each digits as digit, index (index)}
            <input
              bind:this={boxes[index]}
              value={digit}
              oninput={(event) => onDigit(index, event)}
              onkeydown={(event) => onDigitKey(index, event)}
              inputmode="numeric"
              autocomplete={index === 0 ? 'one-time-code' : 'off'}
              maxlength="6"
              aria-label={t('Digit {number}', { number: index + 1 })}
              style:animation-delay="{index * 32}ms"
            />
          {/each}
        </div>

        <button
          class="link"
          type="button"
          disabled={account.resendIn > 0 || account.busy}
          onclick={() => account.requestCode()}
        >
          {account.resendIn > 0
            ? t('Resend in {seconds}s', { seconds: account.resendIn })
            : t('Send a new code')}
        </button>
      </div>
    {/if}

    {#if account.error}
      <p class="error" transition:fly={{ y: -6, duration: dur(160) }}>{t(account.error)}</p>
    {/if}
  </div>
{/if}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: 30;
  }

  /* What the link was about, above the address it asks for. */
  .shared {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  .heading {
    margin: 0 0 var(--space-4);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    text-align: center;
  }

  /* `.nib-screen` in the themes package; see Palette.svelte. */
  .panel {
    z-index: 31;
    padding: var(--space-5);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* The height from the row scale, so a thumb gets a row where it used to get
     44px, and the room inside it on the grid. */
  input {
    width: 100%;
    min-height: var(--row-height);
    padding: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  input::placeholder {
    color: var(--muted);
  }

  /* The one thing this panel is for is `.nib-button` in the themes package,
     which is where the lift on hover, the deeper fill under the finger and the
     one fade for a button that cannot be pressed all live. */

  .sent {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    text-align: center;
  }

  .sent strong {
    color: var(--text);
    font-weight: var(--weight-strong);
  }

  .digits {
    display: flex;
    gap: 7px;
    justify-content: center;
  }

  .digits input {
    width: 2.6rem;
    padding: 12px 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 1.25rem;
    animation: drop var(--dur-base) var(--ease-spring) backwards;
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.9);
    }
  }

  /* Asking for another code: a sentence you can press rather than a button, so
     it is not `.nib-button` and says the whole of itself here. */
  .link {
    display: block;
    margin: var(--space-4) auto 0;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .link:hover:not(:disabled) {
    color: var(--accent);
  }

  .error {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--danger);
    text-align: center;
  }

  /* On the keyboard while a field has it, and scrolled rather than cut off when
     what is left above the keys is shorter than the panel. */
  :global([data-touch]) .panel {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    overflow-y: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: max(
      var(--space-5),
      calc(var(--space-5) + var(--inset-bottom) - var(--keyboard))
    );
  }
</style>
