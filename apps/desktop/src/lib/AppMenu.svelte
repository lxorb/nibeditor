<script lang="ts">
  import { tick } from 'svelte'
  import type { EditorView } from '@nib/editor'
  import type { MenuGroup } from './menu-item'
  import { appMenuPanel, appMenuRows } from './surfaces.svelte'
  import { t } from './i18n.svelte'

  const {
    view,
    onpalette,
    onhistory,
    dots = false,
  }: {
    view?: EditorView | undefined
    onpalette: () => void
    onhistory: () => void
    /** Three dots rather than three bars: what a phone and a tablet put at the
     *  right end of the title bar, where a thumb finds "the rest of the app".
     *  The menu it opens is the same menu. */
    dots?: boolean
  } = $props()

  let open = $state(false)
  let groups = $state<MenuGroup[]>([])

  /** Opens the menu, on rows built for this moment.
   *
   *  The builder is fetched rather than imported: it names every command in the app,
   *  asks each whether it may run and carries the export list and the shortcut hints
   *  with it, none of which is worth a byte before somebody presses the bars. So is
   *  the menu itself - the popover, its keys and its rows - which is nothing but the
   *  button until it opens; see AppMenuPanel.svelte. Both fetches are kept, and the
   *  launch has already asked for them by the time a hand reaches the bars, so no open
   *  of it ever waits; see `warmDoors` in surfaces.svelte.ts. A press in front of that
   *  mounts the menu shut first and opens it a tick later, so it still plays its way in.
   *
   *  Built on opening, so what is ticked and what is greyed out describes now. */
  async function show() {
    const [appMenu] = await Promise.all([appMenuRows(), appMenuPanel.ask()])
    await tick()

    groups = appMenu({ view, onpalette, onhistory })
    open = true
  }
</script>

<button
  class="nib-glyph trigger"
  class:dots
  title={t('Menu')}
  aria-label={t('Menu')}
  aria-expanded={open}
  onclick={() => (open ? (open = false) : void show())}
>
  {#if dots}
    <svg viewBox="0 0 16 16"
      ><circle cx="8" cy="3" r="1.35" /><circle cx="8" cy="8" r="1.35" /><circle
        cx="8"
        cy="13"
        r="1.35"
      /></svg
    >
  {:else}
    <svg viewBox="0 0 16 16"><path d="M1.5 4h13M1.5 8h13M1.5 12h13" /></svg>
  {/if}
</button>

<!-- The menu, mounted the first time it is asked for and kept; see show(). -->
{#if appMenuPanel.asked}
  {#await appMenuPanel.asked then AppMenuPanel}
    <AppMenuPanel bind:open {groups} />
  {/await}
{/if}

<style>
  /* The three bars are `.nib-glyph` in the themes package, which is the same
     square, corner, hover and press as the button beside them and the two at the
     bottom of the panel. It used to be a 30px pill with a 17px glyph in it and a
     corner of its own, which made it the only icon button in the app at that
     size and that radius.

     The bar stretches what is in it, and a fixed height turns that into "top of
     the row": the three bars sat four pixels above the centre line the button
     beside them, the space's name and the first tab all share. So where it sits
     in the row is still said here. */
  .trigger {
    align-self: center;
  }

  /* Dots are drawn rather than stroked, and a shade stronger than the bars: they
     sit alone at the end of a bar rather than in a column of icons. */
  /* Three dots rather than three bars, which is the same button under a thumb.
     Filled because a dot is a shape and not a stroke; the colour is the one
     every glyph button in the app is drawn in and is not restated here. */
  .trigger.dots svg {
    fill: currentColor;
    stroke: none;
  }

  /* ── On a phone ────────────────────────────────────────────────── */
  /* A thumb's row, at the right end of the title bar. */
  :global([data-touch]) .trigger {
    width: var(--touch-row);
    height: var(--touch-row);
  }

  :global([data-touch]) .trigger svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }
</style>
