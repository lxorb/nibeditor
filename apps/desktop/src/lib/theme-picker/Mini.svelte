<script lang="ts">
  /** One theme on its card: nib in small, in the theme's own colours.
   *
   *  The title bar with a tab in it, the list with the open note lit in the
   *  accent, and a note with a heading, two lines and a link - the parts somebody
   *  judging a theme looks at, and nothing drawn that the theme does not colour.
   *  The colours arrive worked out (see looks.ts) and are written on the element
   *  itself, so the window's own theme never reaches a card.
   *
   *  A theme that states both schemes is drawn twice and cut on the diagonal, light
   *  above and dark below, the way a Mac draws Auto: one card that says it follows
   *  the room. Spans throughout, because it lives inside a button. */
  import type { Look } from './looks'

  const { looks }: { looks: readonly Look[] } = $props()
</script>

<span class="mini" aria-hidden="true">
  {#each looks as look, index (index)}
    <span
      class="window"
      class:second={index > 0}
      style:--mini-ground={look.ground}
      style:--mini-side={look.side}
      style:--mini-frame={look.frame}
      style:--mini-text={look.text}
      style:--mini-muted={look.muted}
      style:--mini-line={look.line}
      style:--mini-accent={look.accent}
      style:--mini-open={look.open}
    >
      <span class="bar"><span class="tab"></span></span>
      <span class="side">
        <span class="row open"><span class="dot"></span></span>
        <span class="row"></span>
        <span class="row short"></span>
      </span>
      <span class="note">
        <span class="head"></span>
        <span class="line"></span>
        <span class="line"><span class="link"></span></span>
      </span>
    </span>
  {/each}
</span>

<style>
  /* The shape of a window, a little wider than it is tall, like the one it is a
     picture of. Its own edge is drawn inside it so the ring a chosen card wears
     sits outside and neither covers the other. */
  .mini {
    position: relative;
    display: block;
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent);
  }

  .window {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: grid;
    grid-template-columns: 30% 1fr;
    grid-template-rows: 17% 1fr;
    background: var(--mini-ground);
  }

  /* The other scheme, below the diagonal. */
  .second {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  .bar {
    grid-column: 1 / -1;
    display: flex;
    align-items: flex-end;
    padding-inline-start: 34%;
    background: var(--mini-frame);
    border-bottom: 1px solid var(--mini-line);
  }

  .tab {
    width: 30%;
    height: 72%;
    border-radius: 3px 3px 0 0;
    background: var(--mini-ground);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 7px 6px;
    background: var(--mini-side);
    border-inline-end: 1px solid var(--mini-line);
  }

  .row {
    height: 3px;
    width: 80%;
    border-radius: 2px;
    background: var(--mini-muted);
    opacity: 0.55;
  }

  .row.short {
    width: 55%;
  }

  /* The open note: the row's own fill, with the accent's dot where its mark goes. */
  .row.open {
    display: flex;
    align-items: center;
    width: 100%;
    height: 8px;
    margin-inline-start: -3px;
    padding-inline-start: 3px;
    border-radius: 3px;
    background: var(--mini-open);
    opacity: 1;
  }

  .dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--mini-accent);
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 10px;
  }

  .head {
    width: 48%;
    height: 5px;
    border-radius: 2px;
    background: var(--mini-text);
  }

  .line {
    display: flex;
    justify-content: flex-end;
    width: 86%;
    height: 3px;
    border-radius: 2px;
    background: var(--mini-muted);
  }

  .line + .line {
    width: 68%;
  }

  .link {
    width: 34%;
    height: 100%;
    border-radius: 2px;
    background: var(--mini-accent);
  }
</style>
