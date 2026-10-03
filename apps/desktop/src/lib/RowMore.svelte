<script lang="ts">
  /** The three dots at the end of a row in the list of spaces: what the space, or the
   *  file somebody shared, offers. Also a right click on the row and a held finger, so
   *  the gesture is the one every other list in the app answers to. A row of the menu
   *  too, and it says so: a plain button among the rows was enough for the whole list
   *  to stop being read as a menu. Reached with the row's own menu key rather than
   *  with Tab; see roving.ts. */
  import { t } from './i18n.svelte'

  const { onclick }: { onclick: (event: MouseEvent) => void } = $props()
</script>

<button
  class="nib-glyph more"
  role="menuitem"
  aria-haspopup="menu"
  title={t('More')}
  aria-label={t('More')}
  {onclick}
>
  <svg viewBox="0 0 13 13"
    ><circle cx="3" cy="6.5" r="1" /><circle cx="6.5" cy="6.5" r="1" /><circle
      cx="10"
      cy="6.5"
      r="1"
    /></svg
  >
</button>

<style>
  /* `.nib-glyph` in the themes package draws it; what is here is whether it is there
     at all. */
  .more {
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* Where there is a pointer it appears on the row it belongs to - the line the row
     and this share; where there is not, it is simply there, because a finger cannot
     hover and a held finger is a gesture nobody can see. */
  @media (hover: hover) {
    :global(.line:hover) > .more,
    .more:focus-visible {
      opacity: 1;
    }
  }

  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }

  /* Three dots: a shape rather than a stroke, so it is filled. */
  .more svg {
    fill: currentColor;
    stroke: none;
  }

  .more:focus-visible {
    outline-offset: -1px;
  }
</style>
