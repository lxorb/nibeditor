<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { refreshSpaces } from './account'
  import { api } from './api'
  import { message, t } from './i18n.svelte'
  import { opening } from './opened'
  import { PROBLEMS } from './problems'
  import { remember, settings } from './settings'

  const { onSignedIn }: { onSignedIn: () => void } = $props()

  const LENGTH = 6

  /** An empty row of boxes. `Array.fill` answers `any[]`, which is how an
   *  unchecked value would reach the markup. */
  const blank = () => Array.from({ length: LENGTH }, () => '')

  let step = $state<'email' | 'code'>('email')
  let email = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)
  let resendIn = $state(0)

  let digits = $state<string[]>(blank())
  const boxes = $state<HTMLInputElement[]>([])
  let emailField = $state<HTMLInputElement>()

  const entered = $derived(digits.join(''))

  /** The last code sent for checking. Without this the effect below would send
   *  the same digits again every time `busy` flips back, burning attempts. */
  let submitted = $state('')

  let ticking: ReturnType<typeof setInterval> | undefined

  $effect(() => {
    if (step === 'email') emailField?.focus()
    else setTimeout(() => boxes[0]?.focus(), 60)
  })

  // Six digits is the whole code, so it is checked as soon as they are all
  // there. A refused code empties the row, ready for the next attempt.
  $effect(() => {
    if (entered.length !== LENGTH || entered === submitted) return

    submitted = entered
    void verify(entered)
  })

  $effect(() => () => clearInterval(ticking))

  function countDown(seconds: number) {
    clearInterval(ticking)
    resendIn = seconds

    ticking = setInterval(() => {
      resendIn -= 1
      if (resendIn <= 0) clearInterval(ticking)
    }, 1000)
  }

  async function requestCode() {
    const address = email.trim()
    if (!address) return

    busy = true
    error = null

    try {
      countDown(await api.requestCode(address))
      step = 'code'
      digits = blank()
      submitted = ''
    } catch (thrown) {
      error = message(thrown, PROBLEMS.unreachable)
    } finally {
      busy = false
    }
  }

  async function verify(code: string) {
    busy = true
    error = null

    try {
      const session = await api.verifyCode(email.trim(), code)
      await remember({ token: session.token, email: session.user.email })

      // The spaces are wanted for the picker that follows, and failing to fetch
      // them is not a failed sign-in: the popup asks again on its own.
      await refreshSpaces(session.token).catch(() => [])

      // What the page works from is storage, and storage has just changed.
      opening(await settings())
      clearInterval(ticking)
      onSignedIn()
    } catch (thrown) {
      error = message(thrown, PROBLEMS.unreachable)
      digits = blank()
      submitted = ''
      setTimeout(() => boxes[0]?.focus(), 0)
    } finally {
      busy = false
    }
  }

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
</script>

<!-- The app's own mark, from the icon the extension already ships, rather than a
     second drawing of it that could drift from the first. -->
<div class="mark">
  <img src="/icons/128.png" width="38" height="38" alt="nibeditor" />
</div>

{#if step === 'email'}
  <form
    in:fly={{ x: -14, duration: 200, easing: cubicOut }}
    onsubmit={(event) => {
      event.preventDefault()
      void requestCode()
    }}
  >
    <input
      bind:this={emailField}
      bind:value={email}
      type="email"
      autocomplete="email"
      placeholder="you@example.com"
      aria-label={t('Email address')}
      spellcheck="false"
      required
    />
    <button type="submit" disabled={busy}>{busy ? t('Sending') : t('Continue')}</button>
  </form>
{:else}
  <div class="code" in:fly={{ x: 14, duration: 200, easing: cubicOut }}>
    <p class="sent">{t('Code sent to')} <strong>{email}</strong></p>

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
      class="quiet"
      type="button"
      disabled={resendIn > 0 || busy}
      onclick={() => requestCode()}
    >
      {resendIn > 0 ? t('Resend in {seconds}s', { seconds: resendIn }) : t('Send a new code')}
    </button>
  </div>
{/if}

{#if error}
  <p class="error" transition:fly={{ y: -6, duration: 160 }}>{t(error)}</p>
{/if}

<style>
  .mark {
    display: flex;
    justify-content: center;
    margin: var(--space-4) 0 var(--space-5);
  }

  .mark img {
    border-radius: var(--radius-md);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .sent {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    text-align: center;
  }

  .sent strong {
    color: var(--text);
    font-weight: 550;
  }

  .digits {
    display: flex;
    gap: 6px;
    justify-content: center;
  }

  .digits input {
    width: 2.4rem;
    padding: 11px 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 1.2rem;
    animation: drop var(--dur-base) var(--ease-spring) backwards;
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.9);
    }
  }

  .quiet {
    display: block;
    margin: var(--space-4) auto 0;
    padding: 4px 8px;
    background: none;
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  .quiet:hover:not(:disabled) {
    background: none;
    color: var(--accent);
    transform: none;
  }

  .error {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--danger);
    text-align: center;
  }
</style>
