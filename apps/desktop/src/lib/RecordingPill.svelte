<script lang="ts">
  /** The one thing the app says about a microphone that is open: a dot, the time so
   *  far, and a stop.
   *
   *  Its own component because the recorder behind it is a subsystem - the
   *  microphone, the container, the WAV pieces, the transcript, the summary - and
   *  nothing in it is worth a byte before somebody presses Record. The window asks for
   *  this the moment a recording starts and keeps it afterwards; see surfaces.svelte.ts.
   *
   *  In the middle of the row the app's own notices take under the panes, on every
   *  kind of tab and in full screen: a red dot somebody started has to be there to be
   *  pressed, and it used to float over the foot of the note - which over a web tab is
   *  behind the page, because a native webview draws above every pixel of HTML in the
   *  window. See `.notices` in App.svelte.
   *
   *  Read off the store rather than handed in: a recording belongs to the window
   *  rather than to any one note, and this is the one place that says so. */

  import { t } from './i18n.svelte'
  import { recorder } from './recorder/recording.svelte'
  import { spanOf } from './recorder/transcript'
</script>

{#if recorder.on || recorder.saving}
  <!-- The bar shape every floating bar in the app wears, so this is one design and
       not a second one; only where it sits and what is in it is here. See
       `.nib-bar` in base.css.

       What went wrong is not said here: that is the line at the top of the document,
       which is already where work that failed and carried on says so. See
       Progress.svelte and busy.svelte.ts. -->
  <div class="nib-bar recording" class:saving={!recorder.on}>
    <span class="dot" class:behind={recorder.retrying || recorder.waiting > 1}></span>
    <span class="clock">{spanOf(recorder.elapsed)}</span>
    <button
      title={t('Stop recording')}
      aria-label={t('Stop recording')}
      disabled={!recorder.on}
      onclick={() => recorder.toggle(recorder.kind)}
    >
      <svg viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" rx="1" /></svg>
    </button>
  </div>
{/if}

<style>
  /* The middle track of the notices row, whatever is at either end of it. Laid out
     rather than floated, so it takes its room instead of covering the pane; see
     App.svelte. */
  .recording {
    grid-column: 2;
    align-items: center;
    gap: var(--space-2);
    padding-inline-start: var(--space-3);
    animation: pill-in var(--dur-base) var(--ease-spring);
  }

  /* One column on a phone, and the pill in the middle of it. */
  :global([data-touch]) .recording {
    grid-column: 1;
    justify-self: center;
  }

  /* Up from the foot of the window, which is where a thing that has just started
     comes from. */
  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-3));
    }
  }

  /* Stopped, and still writing the file down. The dot has nothing to pulse about any
     more and the clock says how long the recording was. */
  .recording.saving {
    opacity: 0.75;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    animation: pill-beat 1.8s var(--ease-in-out) infinite;
  }

  /* A transcript that is behind, or a piece being sent again: the dot holds still and
     goes to the accent. Nothing else changes, because the recording itself is fine and
     a second red thing would read as the recording being in trouble. */
  .dot.behind {
    background: var(--accent);
    animation: none;
  }

  .recording.saving .dot {
    background: var(--muted);
    animation: none;
  }

  @keyframes pill-beat {
    50% {
      opacity: 0.35;
    }
  }

  .clock {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted-strong);
  }

  .recording svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: currentColor;
  }

  /* A beat that is not moving is a dot that is simply there, which still says a
     microphone is open. */
  @media (prefers-reduced-motion: reduce) {
    .dot,
    .recording {
      animation: none;
    }
  }
</style>
