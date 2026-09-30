<script lang="ts">
  /** Another of the person's computers asking for their web logins (docs/sync-v2.md 6.6):
   *  *"Desktop wants your web logins  482 913"*, with Don't allow and Allow.
   *
   *  The bubble a site's question is asked in and a program's (WebAsk.svelte,
   *  PairingBubble.svelte), with the same two answers in the same words: a new question
   *  in an old shape is one nobody has to learn. The six digits are worked out from the
   *  asking computer's public key, and the asking computer shows the same six under its
   *  web tab's bar; a server that slipped its own key in would show others. So the
   *  digits are the whole point, set apart in the figures the app counts in.
   *
   *  Under the title bar at the right, on the overlay stack, so a page under it is out of
   *  sight while it is up. Escape puts it away without an answer: the computer is still
   *  waiting, and the question comes back the next time this one connects. */
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { accentFor } from '../accents'
  import { t } from '../i18n.svelte'
  import { initial } from '../icons'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { isDesktop } from '../tauri'
  import { theme } from '../theme.svelte'
  import type { Approval } from './approval.svelte'

  const { approval }: { approval: Approval } = $props()

  const asking = $derived(approval.asking[0] ?? null)
  const device = $derived(asking?.name ?? '')
  /** Six digits as two groups of three, the way a code is read aloud. */
  const digits = $derived(asking ? `${asking.digits.slice(0, 3)} ${asking.digits.slice(3)}` : '')

  let card = $state<HTMLElement>()

  $effect(() => {
    const one = asking
    if (!one) return
    return overlays.show(() => {
      approval.dismiss(one)
    })
  })

  // The keys are the bubble's while it is up, for WebAsk's reason: a key meant for a
  // page must not give another computer the logins.
  onMount(() => {
    card?.focus({ preventScroll: true })
    if (isDesktop && !document.hasFocus()) void keyboardHere()
  })

  async function keyboardHere(): Promise<void> {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview()
      .setFocus()
      .catch(() => undefined)
  }
</script>

{#if asking}
  <div
    class="approve nib-bubble is-pressable nib-host"
    role="dialog"
    aria-label={t('{device} wants your web logins', { device })}
    tabindex="-1"
    bind:this={card}
    transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
  >
    <p class="what">
      <span
        class="nib-badge"
        style:--badge-fill={accentFor(device, theme.current)}
        style:--badge-ink="var(--accent-ink)"
        aria-hidden="true">{initial(device)}</span
      >
      <span class="device">{t('{device} wants your web logins', { device })}</span>
      <span class="digits">{digits}</span>
    </p>
    <div class="rows">
      <button class="nib-button is-quiet" onclick={() => approval.deny(asking)}>
        {t('Don’t allow')}
      </button>
      <button class="nib-button" onclick={() => void approval.allow(asking)}>{t('Allow')}</button>
    </div>
  </div>
{/if}

<style>
  .approve {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-2));
    inset-inline-end: var(--space-3);
    /* Over the panes and under a sheet's scrim, where the notices row is. */
    z-index: var(--z-notice);
    width: min(22rem, calc(100vw - var(--space-6)));
    max-width: none;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  .device {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* The code both screens show: figures of one width, so the two groups line up with
     the same digits on the other computer. */
  .digits {
    flex: none;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
