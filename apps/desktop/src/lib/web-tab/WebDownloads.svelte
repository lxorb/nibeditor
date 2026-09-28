<script lang="ts">
  /** What the web tabs have downloaded: the bubble under the glyph at the right of the
   *  bar.
   *
   *  Chrome's download bubble, in nib's shapes. One row a file, newest first: its name,
   *  a hairline that fills while it is on its way, and one glyph at the end - stop while
   *  it is going, the folder once it is there. Pressing a finished row opens the file,
   *  which is what pressing a download in a browser does. A file that did not arrive
   *  says so in one word and nothing opens it.
   *
   *  Nothing here saves or opens anything itself: every press goes to the crate by the
   *  download's id; see downloads.svelte.ts. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import FileIcon from 'lucide/dist/esm/icons/file.mjs'
  import CircleAlert from 'lucide/dist/esm/icons/circle-alert.mjs'
  import FolderOpen from 'lucide/dist/esm/icons/folder-open.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { showLabel } from '../reveal'
  import { downloads, type Download } from './downloads.svelte'

  const { onclose }: { onclose: () => void } = $props()

  const rows = $derived([...downloads.list].reverse())
  // "Show in Finder" on a Mac, as Safari's own downloads say it; see reveal.ts.
  const showWords = $derived(t(showLabel()))

  /** How far one file has got, or null while the server has not said how large it is -
   *  which the hairline draws as a sweep rather than as a length. */
  function fraction(one: Download): number | null {
    return one.total === null ? null : Math.min(1, one.received / one.total)
  }

  $effect(() => overlays.show(onclose))
</script>

<div
  class="downloads nib-bubble is-pressable"
  role="dialog"
  aria-label={t('Downloads')}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  <ul>
    {#each rows as one (one.id)}
      {@const share = fraction(one)}
      <li class:failed={one.state === 'failed'}>
        <button
          class="nib-row file"
          disabled={one.state !== 'done'}
          title={one.name}
          onclick={() => {
            void downloads.open(one.id)
            onclose()
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {#each one.state === 'failed' ? CircleAlert : FileIcon as [tag, attrs], index (index)}
              <svelte:element this={tag} {...attrs} />
            {/each}
          </svg>
          <span class="words">
            <span class="name">{one.name}</span>
            {#if one.state === 'going'}
              <span class="line" class:sweeping={share === null}>
                <span class="done" style:transform={`scaleX(${String(share ?? 0.3)})`}></span>
              </span>
            {:else if one.state === 'failed'}
              <span class="said">{t('Failed')}</span>
            {/if}
          </span>
        </button>

        {#if one.state === 'going'}
          <button
            class="nib-glyph"
            title={t('Cancel')}
            aria-label={t('Cancel')}
            onclick={() => void downloads.cancel(one.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each X as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
        {:else if one.state === 'done'}
          <button
            class="nib-glyph"
            title={showWords}
            aria-label={showWords}
            onclick={() => {
              void downloads.show(one.id)
              onclose()
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each FolderOpen as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  /* Under the glyph it belongs to, at the right of the bar, which is where a browser
     draws it. */
  .downloads {
    position: absolute;
    top: 100%;
    right: var(--space-2);
    z-index: 20;
    width: min(22rem, calc(100% - var(--space-4)));
    max-width: none;
    max-height: 60vh;
    overflow-y: auto;
    padding: var(--space-1);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .file {
    flex: 1;
    min-width: 0;
    color: var(--text);
  }

  /* A row that is on its way or did not arrive has nothing to open, but it is still
     read at full strength: greyed out would say it was not there. */
  .file:disabled {
    opacity: 1;
  }

  .file > svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted);
  }

  .failed .file > svg,
  .said {
    color: var(--danger);
  }

  .words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .failed .name {
    color: var(--muted);
  }

  .said {
    font-size: var(--text-xs);
  }

  /* The hairline a file fills on its way: the accent, from the start of the line. */
  .line {
    position: relative;
    height: 2px;
    border-radius: 1px;
    background: var(--line);
    overflow: hidden;
  }

  .done {
    position: absolute;
    inset: 0;
    background: var(--accent);
    transform-origin: left;
    transition: transform var(--dur-base) var(--ease-out);
  }

  :global([dir='rtl']) .done {
    transform-origin: right;
  }

  /* A file of no known size is a third of the line going across, again and again. */
  .sweeping .done {
    animation: sweep 1.2s var(--ease-in-out) infinite;
  }

  @keyframes sweep {
    from {
      translate: -100% 0;
    }
    to {
      translate: 340% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sweeping .done {
      animation: none;
    }
  }
</style>
