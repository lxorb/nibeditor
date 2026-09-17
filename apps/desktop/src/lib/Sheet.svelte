<script lang="ts">
  /** The box a space's sheets are drawn in.
   *
   *  Sharing a space and publishing one are the same gesture from the same menu
   *  and ask the same kind of question, so they are the same sheet: it rises in
   *  the middle of a window and from the bottom of a phone, it is dismissed by
   *  the scrim, by Escape, by the cross and by back, and the rows, cards and
   *  buttons inside it are one set of shapes rather than two that drift.
   *
   *  Three parts: a head that says what the sheet is about and how to leave, a
   *  body that scrolls, and cards in it. A card is a filled surface rather than a
   *  run of rows on the sheet's own background, which is what Proton Drive and the
   *  settings sheet on a phone both do: two or three groups on one sheet read as
   *  groups without a word being spent on saying so.
   *
   *  What is here is the box and those shapes. What each sheet is about is its
   *  own component; see ShareSheet.svelte and PublishSheet.svelte. */
  import type { Snippet } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { overlays } from './overlays'
  import { scrollbar } from './scrollbar'
  import { LAYER } from './motion'
  import { trap } from './trap'

  const {
    open,
    title,
    mark,
    foot,
    onclose,
    children,
  }: {
    open: boolean
    /** What the sheet is about, which is its heading and what it is read out as. */
    title: string
    /** The badge in front of the title: the space's own mark, so the sheet says
     *  which space it is about the way the switcher does. */
    mark?: Snippet
    /** What stays under the body rather than scrolling away with it: the one
     *  button the sheet exists for. A sheet with a long form in it - publishing a
     *  space is the long one - drew its Publish under the last card, and a body
     *  that scrolls ends with a clean edge: the sheet read as finished, with the
     *  only thing it is for out of sight below the fold. */
    foot?: Snippet
    onclose: () => void
    children: Snippet
  } = $props()

  // Escape closes it, like everything else the app puts over a note.
  $effect(() => (open ? overlays.show(onclose) : undefined))
  $effect(() => closeOnBack(open, onclose))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="nib-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={onclose}></div>

  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={title}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <!-- The subject, then the way out, which is where every window in the world
         keeps it. The scrim, Escape and back all close it too; nothing here is
         confirmed, so there is no button that says Done. -->
    <div class="head">
      {#if mark}
        <span class="nib-badge" aria-hidden="true">{@render mark()}</span>
      {/if}
      <!-- The heading of the layer, and said to be one: the sheets that hang off
           this one head their own sections with an `h3`, and with a paragraph up
           here the outline of the page went from the note's name straight to those.
           The class already says the size, the weight and that it has no margin, so
           nothing about it is drawn differently. -->
      <h2 class="title">{title}</h2>
      <button class="nib-glyph shut" aria-label={t('Close')} title={t('Close')} onclick={onclose}>
        <svg viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" /></svg>
      </button>
    </div>

    <div class="body" data-scrolls use:scrollbar>
      {@render children()}
    </div>

    {#if foot}
      <div class="foot">{@render foot()}</div>
    {/if}
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package draws it: the surface, the corner, the
     hairline, the shadow and the centring that the palette, the prompt, the
     sign-in panel and the invitation all had a copy of. What is its own is how
     wide it is and how far down it opens. */
  .sheet {
    --screen-width: 27rem;

    top: 14vh;
    display: flex;
    flex-direction: column;
    max-height: 72vh;
    overflow: hidden;
    z-index: 51;
  }

  /* The head stays while the cards under it scroll: on a phone the sheet is most
     of the screen, and the name of the thing being shared is what says what all
     of this is about. */
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  /* The way out is `.nib-glyph` in the themes package, which is the square and
     the mark every icon button in the app is. It was a 24px square with a 13px
     cross in it, which made the one way off a sheet the smallest glyph button
     there was. */

  /* Cards, one under the next, and the one thing that scrolls. */
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
    padding: 0 var(--space-2) var(--space-3);
  }

  /* The row that does not scroll, under the body. A line above it, because the
     body ends wherever it happens to end and the button under it has to read as
     the sheet's own rather than as the last thing in the form. */
  .foot {
    flex: none;
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--line);
  }

  /* ── The shapes inside ───────────────────────────────────────────
     Written for whatever the sheet puts in itself, which is why they are
     global: one card, one row, one field and one button, so two sheets cannot
     disagree about what a sheet looks like. */

  /* What went wrong, above whatever asked for it. */
  .sheet :global(.wrong) {
    margin: 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .sheet :global(h3) {
    margin: 0;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* A group on the sheet: a filled surface with rows in it. Two of them side by
     side say they are two things without a line or a word. */
  .sheet :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  /* A label inside a card, over the rows it is about. */
  .sheet :global(.card h3) {
    padding: var(--space-2) 0 var(--space-1);
  }

  /* The row a card is headed by: what the card is about, and the one control
     that turns the whole of it on. */
  .sheet :global(.card-head) {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  /* Under a card's head, before the rows it governs. Full width of the card,
     because a line that stops short of the edge is a line about one row. */
  .sheet :global(.line) {
    width: auto;
    height: 1px;
    margin: var(--space-1) calc(-1 * var(--space-2));
    border: none;
    background: var(--line);
  }

  /* A column of things that are not rows: a field and what it says about
     itself. */
  .sheet :global(.stack) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  /* What it is on the left, what may be done about it on the right, one line
     each: the same row the settings draw. */
  .sheet :global(.row) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 34px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .sheet :global(.name) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet :global(.name small) {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A line under a card or a field, in the one colour it is worth saying in. */
  .sheet :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .sheet :global(.hint.ok) {
    color: var(--success);
  }

  .sheet :global(.hint.bad) {
    color: var(--danger);
  }

  /* A sentence of its own, which may carry a link. */
  .sheet :global(.note) {
    margin: 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .sheet :global(.note a) {
    color: var(--accent);
  }

  /* Something typed in: an address, a name, a domain. A box of its own, so what
     it says when the keyboard lands in it is the themes package's answer for one
     - the border turns, the halo lights, the ring goes. The turn is restated
     below and only the turn: the border here is a shorthand, and a shorthand
     naming a colour outweighs the one word the shared rule changes. */
  .sheet :global(input.field) {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .sheet :global(input.field:focus) {
    border-color: var(--accent);
  }

  /* An action in a card: full width, quiet until pointed at. */
  .sheet :global(.action) {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .sheet :global(.action:hover:not(:disabled)) {
      color: var(--text-strong);
    }

    .sheet :global(.action.danger:hover:not(:disabled)) {
      color: var(--danger);
    }
  }

  /* A small action at the end of a row, where the control would be. */
  .sheet :global(.pill) {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .sheet :global(.pill.quiet) {
    border-color: transparent;
    color: var(--muted);
  }

  @media (hover: hover) {
    .sheet :global(.pill:hover) {
      border-color: var(--accent);
      color: var(--accent);
    }

    .sheet :global(.pill.quiet:hover) {
      border-color: transparent;
      color: var(--text-strong);
    }
  }

  .sheet :global(.pill:active) {
    background: var(--accent-soft);
  }

  /* The one thing the sheet is for, once it can be done. Where it sits in the
     row or the column holding it is that sheet's business. */
  .sheet :global(.primary) {
    flex: none;
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .sheet :global(.primary:hover:not(:disabled)) {
    background: var(--accent-hover);
  }

  .sheet :global(.primary:active:not(:disabled)) {
    background: var(--accent-press);
  }

  .sheet :global(.primary:disabled),
  .sheet :global(.action:disabled) {
    opacity: 0.5;
  }

  /* A phone's sheet is the bottom of the screen, and everything in it is the
     size a thumb needs. */
  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  :global([data-touch]) .body {
    padding-bottom: var(--touch-bottom);
  }

  /* The square and the mark grow with the row scale on their own; what a thumb
     needs from this one is the bar's own padding back, so the cross sits in the
     corner rather than a gap away from it. */
  :global([data-touch]) .shut {
    margin-inline-end: calc(-1 * var(--space-2));
  }

  :global([data-touch]) .sheet :global(.row) {
    min-height: var(--touch-target);
  }

  :global([data-touch]) .sheet :global(.action) {
    min-height: var(--touch-row);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(input.field) {
    min-height: var(--touch-target);
    padding: 0 var(--touch-gap);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(.pill) {
    min-height: var(--touch-target);
    padding: 0 var(--touch-gap);
    font-size: var(--text-base);
  }

  :global([data-touch]) .sheet :global(.primary) {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(.hint),
  :global([data-touch]) .sheet :global(.note) {
    font-size: var(--text-base);
  }
</style>
