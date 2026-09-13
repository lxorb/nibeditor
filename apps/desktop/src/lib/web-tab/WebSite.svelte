<script lang="ts">
  /** What this site is: the popover behind the mark at the left of the address field.
   *
   *  Chrome's site information bubble, kept to what nib can honestly say: whether the
   *  connection is the secure kind, what the site has been allowed or refused, and one
   *  row that forgets all of it. A site that has never asked for anything shows the first
   *  line and nothing else, which is the common case and reads as "there is nothing to
   *  know here".
   *
   *  Turning something off here does not reach into the page. A site that already has the
   *  camera keeps it until it asks again, which is what happens in a browser too: the
   *  answer is about the next time. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import type { Ask } from './permissions.svelte'
  import { ASKS, grants } from './permissions.svelte'

  const { url, site, onclose }: { url: string | null; site: string; onclose: () => void } = $props()

  /** What each one is called on a row that says what a site may do. Chrome's words, so
   *  a reader who has turned one of these off in Chrome finds the same name here. */
  const NAMES: Record<Ask, () => string> = {
    camera: () => t('Camera'),
    microphone: () => t('Microphone'),
    location: () => t('Location'),
    notifications: () => t('Notifications'),
    clipboard: () => t('Clipboard'),
    sensors: () => t('Motion sensors'),
    downloads: () => t('Automatic downloads'),
    fonts: () => t('Fonts'),
    midi: () => t('MIDI devices'),
    windows: () => t('Window management'),
  }

  const secure = $derived(url?.startsWith('https:') === true)
  const said = $derived(grants.of(site))
  const decided = $derived(ASKS.filter((ask) => said[ask] !== undefined))

  $effect(() => overlays.show(onclose))
</script>

<div
  class="site nib-bubble"
  role="dialog"
  aria-label={site}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  <p class="how" class:risky={!secure}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each secure ? Lock : TriangleAlert as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    {secure ? t('Connection is secure') : t('Connection is not secure')}
  </p>

  {#if decided.length}
    <ul class="grants">
      {#each decided as ask (ask)}
        <li>
          <span>{NAMES[ask]()}</span>
          <!-- The answer, as the thing it is: a site is allowed or it is blocked, and
               pressing the word is the other answer. -->
          <button
            class="nib-button is-quiet"
            onclick={() => grants.remember(site, ask, said[ask] === 'allow' ? 'block' : 'allow')}
          >
            {said[ask] === 'allow' ? t('Allowed') : t('Blocked')}
          </button>
        </li>
      {/each}
    </ul>

    <button
      class="nib-button is-quiet reset"
      onclick={() => {
        grants.forget(site)
        onclose()
      }}
    >
      {t('Reset permissions')}
    </button>
  {/if}
</div>

<style>
  /* Under the mark it belongs to, at the left of the bar, which is where a browser
     draws it. */
  .site {
    position: absolute;
    top: 100%;
    left: var(--space-2);
    z-index: 20;
    width: min(20rem, calc(100% - var(--space-4)));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .how {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .how > svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* An `http:` page is the one thing about an address worth warning somebody about, so
     the line says so in the colour a callout warns in. */
  .risky {
    color: var(--callout-warning);
  }

  .grants {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .grants > li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .reset {
    align-self: flex-start;
  }
</style>
