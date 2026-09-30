<script lang="ts">
  /** The way back out of full screen, in the corner the bar's own buttons were in. It
   *  fades once nothing has moved for a while - it is a way out, not part of what is being
   *  read - and stays there faintly rather than going, because a screen with no way off it
   *  is the one thing this must never be. Escape, back on Android and the menu row do the
   *  same. See fullscreen.svelte.ts.
   *
   *  Fetched the first time full screen is, which is never as the window opens: nothing
   *  about full screen is remembered. */

  import { fullscreen } from './fullscreen.svelte'
  import { t } from './i18n.svelte'
</script>

<button
  class="leave"
  class:idle={fullscreen.idle}
  title={t('Leave fullscreen')}
  aria-label={t('Leave fullscreen')}
  onclick={() => void fullscreen.leave()}
>
  <svg viewBox="0 0 16 16">
    <path d="M6.5 2.5v4h-4M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 13.5v-4h4" />
  </svg>
</button>

<style>
  /* Small, and quieter still once nothing has moved for a while - but never gone: it
     stays reachable by a finger and by a key. Its size is `--leave-size`, which a web
     tab's bar makes room for; see App.svelte. */
  .leave {
    position: absolute;
    top: max(var(--space-2), var(--inset-top));
    inset-inline-end: max(var(--space-2), var(--inset-end));
    z-index: var(--z-float);
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-3) 82%, transparent);
    color: var(--muted-strong);
    box-shadow: var(--shadow-sm);
    cursor: default;
    width: var(--leave-size);
    height: var(--leave-size);
    transition:
      opacity var(--dur-slow) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
    /* Arrives with the screen it belongs to rather than appearing on it. In CSS, so it
       goes with the tokens under reduced motion. */
    animation: arrive var(--dur-base) var(--ease-out);
  }

  @keyframes arrive {
    from {
      opacity: 0;
    }
  }

  .leave.idle {
    opacity: 0.22;
  }

  @media (hover: hover) {
    .leave:hover {
      opacity: 1;
      background: var(--surface-3);
      color: var(--text-strong);
    }
  }

  .leave:active {
    opacity: 1;
    background: var(--press);
    color: var(--text-strong);
  }

  .leave:focus-visible {
    opacity: 1;
    outline-offset: 2px;
  }

  .leave svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A thumb's target rather than a pointer's, drawn at the size every other icon on a
     touch screen is. */
  :global([data-touch]) .leave svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }
</style>
