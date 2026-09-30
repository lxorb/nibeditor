<script lang="ts">
  /** A program asking to become an agent (docs/agent-native.md 9.1): the first time a
   *  client connects through `nib mcp`, nib asks once, and Allow makes its token.
   *
   *  The bubble a site's question is asked in (web-tab/WebAsk.svelte), with the same two
   *  answers in the same words: a new kind of question in an old shape is one nobody has
   *  to learn. The client's mark is its initial in its own colour, the square the Share
   *  sheet draws a person with, because a client is somebody asking to come in.
   *
   *  Under the title bar at the right, over the activity panel's side of the window, and
   *  on the overlay stack, so a page under it is out of sight while it is up: nothing of
   *  the app's can be drawn over a page. Escape is Don't allow: the client asks again
   *  the next time it connects. */
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { accentFor } from '../../accents'
  import { t } from '../../i18n.svelte'
  import { initial } from '../../icons'
  import { dur } from '../../motion'
  import { overlays } from '../../overlays'
  import { isDesktop } from '../../tauri'
  import { theme } from '../../theme.svelte'
  import type { Activity } from './activity.svelte'

  const { activity }: { activity: Activity } = $props()

  const asking = $derived(activity.seen.approvals.find((one) => one.category === 'pairing') ?? null)
  const client = $derived(asking?.summary ?? '')

  let card = $state<HTMLElement>()

  function answer(allow: boolean) {
    if (asking) void activity.answer(asking, allow).catch(() => undefined)
  }

  $effect(() => overlays.show(() => answer(false)))

  // The keys are the bubble's while it is up, for WebAsk's reason: a key meant for
  // something else must not let a program in.
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
    class="pairing nib-bubble is-pressable nib-host"
    role="dialog"
    aria-label={client}
    tabindex="-1"
    bind:this={card}
    transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
  >
    <p class="what">
      <span
        class="nib-badge"
        style:--badge-fill={accentFor(client, theme.current)}
        style:--badge-ink="#fff"
        aria-hidden="true">{initial(client)}</span
      >
      <span class="client">{t('{client} wants to connect', { client })}</span>
    </p>
    <div class="rows">
      <button class="nib-button is-quiet" onclick={() => answer(false)}>{t('Don’t allow')}</button>
      <button class="nib-button" onclick={() => answer(true)}>{t('Allow')}</button>
    </div>
  </div>
{/if}

<style>
  .pairing {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-2));
    inset-inline-end: var(--space-3);
    /* Over the panes and under a sheet's scrim, where the notices row is. */
    z-index: 31;
    width: min(20rem, calc(100vw - var(--space-6)));
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

  .client {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
