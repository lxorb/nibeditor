<script lang="ts">
  /** The extensions' part of the web bar: each pinned extension's own picture, which
   *  opens its popup, and the puzzle, which lists them all.
   *
   *  Chrome's toolbar, in nib's glyph squares. On a store's page for an extension that is
   *  not installed, the puzzle turns into the accent with a plus beside it, which installs
   *  it: the one press Chrome's own "Add to Chrome" is, put where the bar's presses are.
   *  Nothing is drawn where no engine runs extensions. */

  import { scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Plus from 'lucide/dist/esm/icons/plus.mjs'
  import Puzzle from 'lucide/dist/esm/icons/puzzle.mjs'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { extensions, pinnedOf } from './extensions.svelte'

  const {
    /** The extension the store page this tab is on is about, when it is not installed. */
    addable,
    /** The popup open over this tab, if any. */
    open,
    onpress,
    onlist,
    onadd,
  }: {
    addable: string | null
    open: string | null
    onpress: (id: string, anchor: HTMLElement) => void
    onlist: (anchor: HTMLElement) => void
    onadd: () => void
  } = $props()

  const pinned = $derived(pinnedOf(extensions.list))
</script>

{#each pinned as one (one.id)}
  <button
    class="nib-glyph extension"
    class:is-on={open === one.id}
    title={one.name}
    aria-label={one.name}
    aria-haspopup="dialog"
    onclick={(event) => onpress(one.id, event.currentTarget)}
    transition:scale={{ start: 0.6, duration: dur(160), easing: cubicOut }}
  >
    {#if one.picture}
      <img src={one.picture} alt="" draggable="false" />
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each Puzzle as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    {/if}
  </button>
{/each}

{#if addable}
  <button
    class="nib-chip add"
    disabled={extensions.installing !== null}
    title={t('Add extension')}
    onclick={onadd}
    transition:scale={{ start: 0.6, duration: dur(160), easing: cubicOut }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Plus as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    {t('Add')}
  </button>
{/if}

<button
  class="nib-glyph"
  title={t('Extensions')}
  aria-label={t('Extensions')}
  aria-haspopup="dialog"
  onclick={(event) => onlist(event.currentTarget)}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each Puzzle as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</button>

<style>
  /* An extension's own picture in a glyph's square, at the size of the site's mark. */
  .extension img {
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
  }

  .add {
    gap: var(--space-1);
  }

  .add svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>
