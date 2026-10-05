<script lang="ts">
  /** Which colour, asked as a row of colours.
   *
   *  The six the theme names, the ones used lately, and every other colour there
   *  is behind the wheel. Recent ones matter on a plane: a drawing is two or three
   *  colours used over and over, and a hand that mixed a particular green wants
   *  that green again on the next stroke rather than a second trip round the
   *  picker.
   *
   *  It says nothing about what it is colouring. The pen's popover shows it for
   *  the pen and the bar shows it for what is picked; both hand back a colour and
   *  the surface decides what that means, so there is one row of colours in the
   *  app and one answer to "which colour". */

  import { DOTS } from './canvas/palette'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const {
    colour,
    recent = [],
    none = true,
    bare,
    wheel = true,
    oncolour,
  }: {
    /** The colour in hand, so the dot that is on shows it. */
    colour: string | null
    /** Colours used lately, newest first. */
    recent?: readonly string[]
    /** Whether "no colour at all" is one of the answers. */
    none?: boolean
    /** What the "no colour" dot is drawn in, and what it is called, for the times it
     *  is not really "no colour" at all.
     *
     *  A card with no colour of its own wears the surface, so a hollow ring is the
     *  truth for one. A pen with no colour of its own writes in the ink the page is
     *  set in, which is nearly white in a dark theme and nearly black in a light one:
     *  a hollow ring there is a hole showing the panel through it, and it read as a
     *  white dot that went dark when the theme did. So the pen draws that dot in the
     *  ink it actually writes. */
    bare?: { css: string; title: string }
    /** Whether every other colour is offered behind the wheel. A base's tones are the
     *  theme's six and nothing else (docs/tasks.md 5.19), so its pickers leave it out. */
    wheel?: boolean
    oncolour: (colour: string | null) => void
  } = $props()

  function choose(next: string | null) {
    tick()
    oncolour(next)
  }
</script>

<div class="colours">
  {#each DOTS as dot (dot.colour)}
    <button
      type="button"
      class="dot"
      class:on={colour === dot.colour}
      title={t('Colour {number}', { number: dot.colour })}
      aria-label={t('Colour {number}', { number: dot.colour })}
      aria-pressed={colour === dot.colour}
      style:--dot={dot.css}
      onclick={() => choose(dot.colour)}
    ></button>
  {/each}

  {#if none}
    <button
      type="button"
      class="dot"
      class:bare={!bare}
      class:on={colour === null}
      title={bare?.title ?? t('No colour')}
      aria-label={bare?.title ?? t('No colour')}
      aria-pressed={colour === null}
      style:--dot={bare?.css}
      onclick={() => choose(null)}
    ></button>
  {/if}

  <!-- A colour of your own. The input is the dot, so there is nothing extra to
       learn and nothing extra to draw. -->
  {#if wheel}
    <label class="dot wheel" title={t('Another colour')}>
      <input
        type="color"
        value={colour?.startsWith('#') ? colour : '#7c5cff'}
        aria-label={t('Another colour')}
        oninput={(event) => choose(event.currentTarget.value)}
      />
    </label>
  {/if}

  {#each recent as one (one)}
    <button
      type="button"
      class="dot"
      class:on={colour === one}
      title={t('The colour you used before')}
      aria-label={t('The colour you used before')}
      aria-pressed={colour === one}
      style:--dot={one}
      onclick={() => choose(one)}
    ></button>
  {/each}
</div>

<style>
  /* Eight to a row, and the row is a grid rather than a wrap, so the eight that are
     always there - the six the theme names, the bare dot and the wheel - are one row
     at every width this is drawn at, and the ones used lately fill even rows under
     them.

     It wrapped before, at whatever width the panel happened to be: a dot was 40px
     wide and the pen's panel is `min(21rem, 100%)` less its padding, which is 320px
     on a desktop, so seven dots fitted and the wheel went down alone - the one
     colour that is not one of the theme's own, orphaned on a row of its own. A grid
     of eight cannot do that, and it holds wherever the panel is narrower: the side
     panel's `min(21rem, 60vw)`, a tablet, a phone.

     `minmax(0, 40px)` rather than `1fr`, and that is the load-bearing part: 40px is
     the size a dot is drawn at where there is room, so a surface that shrinks to fit
     its contents - the bar over a picked card, whose panel has a `max-width` and no
     width - still asks for a row of eight; and a narrower panel shares what it has
     between the same eight columns instead of wrapping one off the end. */
  .colours {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 40px));
    gap: 2px;
  }

  /* The dot is the whole button, with a finger's worth of room round it: the cell's
     width, which is a dot's 26px plus air at every width the panel takes. */
  .dot {
    display: grid;
    place-items: center;
    width: 100%;
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    cursor: default;
  }

  /* The hairline round every dot is the page's own ink at a whisper rather than
     black at a whisper: a white dot on a white panel has to have an edge, and so
     does a black one on a dark panel. One rule, both themes. */
  /* Round at every width: the dot is 26px where the cell has room for it and the
     cell where it has not, with the height following the width rather than being
     stated, so a narrow panel draws eight smaller circles instead of eight
     ellipses. */
  .dot::after {
    content: '';
    display: block;
    width: min(26px, 100%);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition:
      scale var(--dur-fast) var(--ease-spring),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .dot:hover::after {
    scale: 1.12;
  }

  .dot:active::after {
    scale: 1.04;
  }

  .dot.on::after {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  /* No colour at all, drawn as the ring the others fill. */
  .bare::after {
    background: none;
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  .bare.on::after {
    box-shadow:
      inset 0 0 0 2px var(--muted),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  /* Every colour there is, behind a dot that shows the wheel. */
  .wheel {
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  /* The six the theme names, round: a wheel of colours nothing else in the app
     uses would be a second palette. */
  .wheel::after {
    background: conic-gradient(
      from 0deg,
      var(--canvas-1),
      var(--canvas-2),
      var(--canvas-3),
      var(--canvas-4),
      var(--canvas-5),
      var(--canvas-6),
      var(--canvas-1)
    );
  }

  .wheel input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    opacity: 0;
    cursor: pointer;
  }
</style>
