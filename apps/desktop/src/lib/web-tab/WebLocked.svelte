<script lang="ts">
  /** A site whose login another of the person's computers is using, in place of its
   *  page: the site's mark, where it is open, and Use here.
   *
   *  WhatsApp Web's answer, which everybody has met: *"WhatsApp is open in another
   *  window. Click Use here to use WhatsApp in this window."* Said in three words here,
   *  because the mark says which site and the name says which computer, and the page's
   *  last picture under it, dimmed, says which tab. Use here takes the site: the other
   *  computer hands over its latest state and shows this same surface naming this one,
   *  and the page follows here as soon as the state has landed, which is what the button
   *  stays pressed for. See lease.svelte.ts and docs/sync-v2.md section 4.
   *
   *  Drawn inside the hole the page would be placed over, so the pane measures the hole
   *  as it always does and nothing of the app's counts as being in front of it; the
   *  page is not running while this is up, so nothing native is drawn over it either. */
  import { fade } from 'svelte/transition'
  import { t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import type { Lock } from './pages.svelte'

  const { lock, icon, address }: { lock: Lock | null; icon: string | null; address: string } =
    $props()

  /** The lock as it was last drawn: the surface plays its way out after the lease has
   *  come here, and says the same thing while it goes rather than nothing. */
  let last: Lock = { device: '', pressed: false, take: () => undefined }
  const shown = $derived.by(() => {
    if (lock) last = lock
    return last
  })

  /** Whether the site's own mark would draw; a site with none leaves the box empty
   *  rather than a broken picture. */
  let marked = $state(true)

  const mark = $derived.by(() => {
    if (icon) return icon
    try {
      return new URL('/favicon.ico', address).href
    } catch {
      return null
    }
  })

  $effect(() => {
    if (mark) marked = true
  })
</script>

<!-- Inert on its way out: a press on a surface that is going is a press on nothing. -->
<div class="locked" inert={lock === null} transition:fade={{ duration: LAYER.fade }}>
  {#if mark && marked}
    <img class="mark" src={mark} alt="" draggable="false" onerror={() => (marked = false)} />
  {/if}
  <!-- The line waits for the computer's name: during a handover there is a breath in
       which this computer has let go and not yet heard who took it. -->
  <p class="where" class:said={shown.device !== ''}>
    {shown.device ? t('Open on {device}', { device: shown.device }) : ''}
  </p>
  <button
    class="nib-button use"
    class:pressed={shown.pressed}
    aria-busy={shown.pressed}
    onclick={() => {
      lock?.take()
    }}
  >
    {t('Use here')}
  </button>
</div>

<style>
  /* Over the whole hole, on the page's last picture, which the hole itself draws: the
     ground over it is the pane's own, part way, so the picture reads as the page that
     is not running rather than as the page. */
  .locked {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-4);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    font-family: var(--font-ui);
    text-align: center;
  }

  /* The size the card a browser build stands in for a page draws the site's mark at,
     because it is the same thing: the one picture in the middle of an empty pane. */
  .mark {
    width: calc(var(--icon-lg) * 2);
    height: calc(var(--icon-lg) * 2);
    border-radius: var(--radius-row);
  }

  .where {
    margin: 0;
    min-height: 1lh;
    color: var(--text-strong);
    font-size: var(--text-row);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .where.said {
    opacity: 1;
  }

  /* Pressed for as long as the handover runs: the other computer is uploading, and the
     press is what that is the answer to. */
  .use.pressed {
    background: var(--accent-press);
    transform: none;
  }
</style>
