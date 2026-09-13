<script lang="ts">
  /** The bubble a site is answered in: *"example.com wants to use your camera."*
   *
   *  Chrome's shape, in nib's clothes, because this is a question everybody has already
   *  been asked a hundred times and a new shape for it would only make it harder to
   *  answer: under the address bar, at the left, with the site's own mark, one sentence,
   *  and Chrome's own two answers. It appears when the page asks - the request is held open in the
   *  engine while it is up - and the answer is remembered for that site, so nobody is
   *  asked twice. See permissions.svelte.ts.
   *
   *  It is the app's own HTML, so the page has to be out of sight while it is on screen:
   *  a native webview draws above every pixel of the window. That is the overlay stack's
   *  job and not this component's - it puts itself on the stack, like every other thing
   *  the app opens over the note, and the pane hides the page for as long as it is
   *  there. See overlays.ts and WebTab.svelte. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import type { Asking } from './permissions.svelte'
  import { grants } from './permissions.svelte'

  const { asking, icon }: { asking: Asking; icon: string | null } = $props()

  /** What each request says, in Chrome's own words for it. One sentence, because the
   *  reader is deciding about one thing. */
  const WANTS: Record<Asking['ask'], () => string> = {
    camera: () => t('Use your camera'),
    microphone: () => t('Use your microphone'),
    location: () => t('Know your location'),
    notifications: () => t('Show notifications'),
    clipboard: () => t('See text and images copied to the clipboard'),
    sensors: () => t('Use your motion sensors'),
    downloads: () => t('Download multiple files'),
    fonts: () => t('Use fonts installed on your device'),
    midi: () => t('Use your MIDI devices'),
    windows: () => t('Manage windows on all your displays'),
  }

  let marked = $state(true)

  // Escape tells the site no and remembers nothing, which is what Chrome does with a
  // bubble somebody dismissed: they have not decided about the site, so the next time it
  // asks is a fair time to ask them again.
  $effect(() => overlays.show(() => grants.dismiss(asking)))
</script>

<div
  class="ask nib-bubble"
  role="dialog"
  aria-label={asking.site}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  <p class="what">
    {#if icon && marked}
      <img class="mark" src={icon} alt="" onerror={() => (marked = false)} />
    {/if}
    <span><strong>{asking.site}</strong> {t('wants to')}</span>
  </p>
  <p class="which">{WANTS[asking.ask]()}</p>

  <div class="rows">
    <!-- Chrome's own two words for the two answers, and "Don’t allow" rather than
         "Block" for a reason worth writing down: the app already has a row called
         Block - the kind of thing a paragraph is - and one English string cannot be two
         rows in a catalogue, so a German reader was being offered "Block", the markdown
         block, as the way to refuse a site the camera. The apostrophe is the
         typographic one the app's other refusals use, which is also the one the
         catalogue guard can see. -->
    <button class="nib-button is-quiet" onclick={() => grants.answer(asking, false)}>
      {t('Don’t allow')}
    </button>
    <button class="nib-button" onclick={() => grants.answer(asking, true)}>{t('Allow')}</button>
  </div>
</div>

<style>
  /* Under the bar at its left edge, where a browser puts it: the question is about the
     site the address field is showing, so it belongs under that. */
  .ask {
    position: absolute;
    top: 100%;
    left: var(--space-2);
    z-index: 20;
    width: min(22rem, calc(100% - var(--space-4)));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: var(--radius-sm);
  }

  .which {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  /* The two answers, at the end of the row the way every sheet in the app puts its
     own two. */
  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
