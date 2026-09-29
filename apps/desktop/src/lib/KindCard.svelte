<script lang="ts">
  /** One kind a new tab can be, as a card: its mark drawn large and its name under it.
   *
   *  Two places draw the kinds at this size - a pane with nothing open, and the dialog
   *  Ctrl+T opens in the middle of the window - and they are one card, so the two
   *  cannot drift into two designs of the same choice. See NewHere.svelte and
   *  NewKindSheet.svelte; what the kinds are is new-kinds.ts.
   *
   *  Everything a button takes is handed straight on, so each place says for itself
   *  what a press does and where the keyboard is. */
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { MARKS } from './file-mark'
  import Icon from './Icon.svelte'
  import { dur } from './motion'
  import type { NewKindRow } from './new-kinds'

  const {
    one,
    on,
    letter,
    rise,
    ...rest
  }: {
    one: NewKindRow
    /** Whether this is the card a release or an Enter would make, where a list keeps
     *  one selection: lit by that alone, and not by the pointer or the ring, so two
     *  cards are never lit at once. Absent where the pointer and the keyboard say it
     *  themselves, which is an empty pane. */
    on?: boolean
    /** The key that picks it, drawn quietly in the corner. */
    letter?: string
    /** Where it stands in a row that rises one card after another, for the few
     *  milliseconds the next one waits. Absent for a card that arrives with whatever
     *  holds it. */
    rise?: number
  } & HTMLButtonAttributes = $props()
</script>

<!-- Each rises a moment after the one before it where its place is given, and none of
     it moves at all for somebody who has asked their system for less; see motion.ts. -->
<button
  type="button"
  class="kind"
  class:is-choice={on !== undefined}
  class:is-on={on}
  {...rest}
  in:fly={{
    y: 10,
    duration: dur(rise === undefined ? 0 : 150),
    delay: dur((rise ?? 0) * 40),
    easing: cubicOut,
  }}
>
  <!-- The kind's own mark, drawn large: nothing here chose an icon, so the mark is the
       fallback, which is what every list that shows a kind does. See Icon.svelte and
       FileMark.svelte. -->
  <span class="mark" aria-hidden="true"><Icon icon={null} fallback={MARKS[one.mark]} /></span>
  <span class="nib-row-label">{one.label()}</span>
  {#if letter}
    <kbd aria-hidden="true">{letter.toUpperCase()}</kbd>
  {/if}
  <!-- The way to the kind's other forms, where it has any: a terminal's other shells.
       Part of the card rather than a button of its own, so the cards stay one stop each;
       the place that draws the card tells a press on it apart. See `showOthers` in
       new-kinds.ts. -->
  {#if one.others}
    <span class="more" data-more aria-hidden="true">
      <svg viewBox="0 0 16 16"><path d="M4 6.5l4 4 4-4" /></svg>
    </span>
  {/if}
</button>

<style>
  /* A card rather than a row: the kind is chosen with nothing else to look at, so it
     is drawn at the size that says so. As tall as what is in it and no taller, with the
     same room above the mark as under the name, so a row of them reads as a row of keys
     however many kinds there are. The hairline is the app's own, and the corner is the
     one a card wears in the theme store. */
  .kind {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 9rem;
    max-width: 100%;
    padding: var(--space-5) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-row);
    line-height: var(--leading-row);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* The row's label for its one line and the ellipsis a long language needs, but not
     for its reach: in a row it takes the room the mark leaves, and in a column that
     room is the card's height, which stood the name at the top of an empty box. */
  .kind .nib-row-label {
    flex: initial;
    max-width: 100%;
  }

  /* Lit under the pointer - or, where the list keeps one selection, by that and
     nothing else, so two cards are never lit at once. In colour only: the border stays
     one hairline and nothing moves, so the card that lights is the same card in the
     same place. The ring a key leaves is the app's own, drawn inside over the hairline,
     which is why the chosen card's hairline is the accent: the two are one frame. */
  @media (hover: hover) {
    .kind:not(.is-choice):hover {
      background: var(--surface-hover);
      border-color: var(--line-strong);
      color: var(--text-strong);
    }
  }

  .kind.is-on {
    background: var(--surface-selected);
    border-color: var(--accent);
    color: var(--text-strong);
  }

  .kind:active {
    background: var(--surface-press);
  }

  /* Twice the size the file list draws it at, and the same stroke: the mark is what
     says which kind this is before the word under it is read. `font-size` as well as
     the box, because an emoji is type; see Icon.svelte. */
  .mark {
    display: block;
    flex: none;
    width: calc(2 * var(--icon-md));
    height: calc(2 * var(--icon-md));
    font-size: calc(2 * var(--icon-md));
    color: var(--muted);
    stroke: currentColor;
    stroke-width: 1.6;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .kind:not(.is-choice):hover .mark {
      color: var(--accent);
    }
  }

  .kind:not(.is-choice):focus-visible .mark,
  .kind.is-on .mark {
    color: var(--accent);
  }

  /* In the corner, in the type a key beside a command wears in the palette: there for
     the hand that wants it and quiet for everybody else. As far in from the top as from
     the side, which is the card's own padding at the side, so the letter sits on the
     same line the name gives way at. */
  kbd {
    position: absolute;
    top: var(--space-3);
    inset-inline-end: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
    color: var(--muted);
  }

  .kind.is-on kbd {
    color: var(--muted-strong);
  }

  /* In the corner under the letter, inside the card's own padding so it never meets the
     name however long a language writes it, and a target of its own for the pointer. */
  .more {
    position: absolute;
    bottom: var(--space-1);
    inset-inline-end: var(--space-1);
    display: grid;
    place-items: center;
    width: calc(var(--icon-sm) + var(--space-2));
    height: calc(var(--icon-sm) + var(--space-2));
    border-radius: var(--radius-sm);
    color: var(--muted);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .more:hover {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .more svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Stacked under a thumb, as the rows every other list is made of there: the mark
     in front of the name at the size a thumb's row draws it, and the name from the
     start of the line. */
  :global([data-touch]) .kind {
    flex-direction: row;
    justify-content: flex-start;
    width: min(20rem, 100%);
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    gap: var(--touch-gap);
    font-size: var(--touch-text);
    text-align: start;
  }

  :global([data-touch]) .mark {
    width: var(--touch-icon);
    height: var(--touch-icon);
    font-size: var(--touch-icon);
  }

  /* No keys under a thumb, and the chevron at the end of the line. */
  :global([data-touch]) kbd {
    display: none;
  }

  :global([data-touch]) .more {
    position: static;
    margin-inline-start: auto;
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
