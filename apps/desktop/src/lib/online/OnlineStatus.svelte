<script lang="ts">
  /** Over an online terminal until its session's screen is there: one line saying what
   *  it waits on, with the line the app draws for work worth waiting on under it - or,
   *  once the wait ended without the screen, why, and Try again, which Enter is too - or,
   *  for a session that is no more, New online terminal in its place.
   *  Centred over the pane, over the cached screen dimmed where there is one, and never
   *  an empty pane in its place. See arrival.svelte.ts.
   *
   *  Held back a moment while it waits, so a socket that opens at once never flashes a
   *  line at anyone; a failure is the answer and is shown at once. */

  import { t } from '../i18n.svelte'
  import Sweep from '../Sweep.svelte'
  import { type Status, statusLine } from './arrival.svelte'

  const { status, onretry }: { status: Status; onretry: () => void } = $props()

  const failed = $derived('failed' in status)
  const gone = $derived('gone' in status)
</script>

<div class="status" class:failed role="status">
  <p>{statusLine(status)}</p>
  {#if failed}
    <button type="button" class="nib-button" onclick={onretry}
      >{gone ? t('New online terminal') : t('Try again')}</button
    >
  {:else}
    <div class="sweep"><Sweep /></div>
  {/if}
</div>

<style>
  /* A floating layer's card, as the Reconnect bar is, in the middle of the pane. */
  .status {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: min(24rem, calc(100% - var(--space-6)));
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    animation: arrive var(--dur-base) var(--ease-out) var(--dur-slow) both;
  }

  .status.failed {
    animation-delay: 0s;
  }

  p {
    margin: 0;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  .failed p {
    color: var(--text-strong);
  }

  .sweep {
    width: 6rem;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      scale: 0.97;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status {
      animation-name: none;
    }
  }
</style>
