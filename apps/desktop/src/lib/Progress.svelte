<script lang="ts">
  import { busy } from './busy.svelte'
  import Sweep from './Sweep.svelte'

  /** Held back for a moment, so work that finishes quickly never flashes a
   *  line at anyone. Anything slower than this was worth mentioning. */
  const DELAY = 200

  let showing = $state(false)

  $effect(() => {
    if (!busy.active) {
      showing = false
      return
    }

    const timer = setTimeout(() => (showing = true), DELAY)
    return () => clearTimeout(timer)
  })
</script>

{#if busy.trouble}
  <!-- The same line, in the same place, saying what did not work. Held back by
       nothing: this is the answer, not a sign that one is coming. -->
  <div class="track failed" role="status">
    <div class="line"></div>
    <p class="said">{busy.trouble}</p>
  </div>
{:else if showing}
  <div class="track" role="status" aria-label={busy.label ?? undefined}>
    <Sweep />
  </div>
{/if}

<style>
  /* Along the top edge of the document, under the tabs. The line itself is
     Sweep.svelte, which the account's first sync draws as well. */
  .track {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: var(--z-float);
    pointer-events: none;
    animation: fade-in var(--dur-fast) var(--ease-out);
  }

  /* Still, and in the colour of something that did not work: a line that is no
     longer sweeping is a line that is no longer waiting for anything. */
  .failed .line {
    height: 2px;
    border-radius: 1px;
    background: var(--danger);
  }

  /* Under it, and no wider than it has to be: the line says something is wrong
     and this says what, in one sentence. */
  .said {
    margin: var(--space-2) auto 0;
    width: fit-content;
    max-width: min(30rem, calc(100% - var(--space-6)));
    padding: 6px var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-sm);
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
