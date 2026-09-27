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
</button>

<style>
  /* A card rather than a row: the kind is chosen with nothing else to look at, so it
     is drawn at the size that says so. The hairline and the corner are the app's own,
     which is what every surface here wears. */
  .kind {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 9rem;
    height: 7rem;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      translate var(--dur-fast) var(--ease-out);
  }

  /* Lit under the pointer and under the keyboard both, so the ring is not the only
     thing that says which one is about to be pressed - or, where the list keeps one
     selection, lit by that and nothing else. */
  .kind:not(.is-choice):hover,
  .kind.is-on {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .kind:not(.is-choice):hover,
  .kind:not(.is-choice):focus-visible,
  .kind.is-on {
    translate: 0 -2px;
  }

  .kind.is-on {
    border-color: var(--accent);
  }

  .kind:active {
    background: var(--surface-press);
  }

  /* Twice the size the file list draws it at, and the same stroke: the mark is what
     says which kind this is before the word under it is read. `font-size` as well as
     the box, because an emoji is type; see Icon.svelte. */
  .mark {
    display: block;
    width: 1.75rem;
    height: 1.75rem;
    font-size: 1.75rem;
    color: var(--muted);
    stroke: currentColor;
    stroke-width: 1.6;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .kind:not(.is-choice):hover .mark,
  .kind:not(.is-choice):focus-visible .mark,
  .kind.is-on .mark {
    color: var(--accent);
  }

  /* In the corner, where a key beside a command sits in the palette: there for the
     hand that wants it and quiet for everybody else. */
  kbd {
    position: absolute;
    top: var(--space-2);
    inset-inline-end: var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .kind.is-on kbd {
    color: var(--muted-strong);
  }

  /* Stacked under a thumb, at the row height every other list has there. */
  :global([data-touch]) .kind {
    flex-direction: row;
    justify-content: flex-start;
    width: min(20rem, 100%);
    height: auto;
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    gap: var(--touch-pad);
    font-size: var(--touch-text);
  }

  /* No keys under a thumb. */
  :global([data-touch]) kbd {
    display: none;
  }
</style>
