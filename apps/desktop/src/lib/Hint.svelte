<script lang="ts">
  /** A small `i` after a label, and the sentence behind it.
   *
   *  For the settings whose name only means something to somebody who already
   *  knows the word - Strict CommonMark, smart punctuation - where the honest
   *  answer is a sentence and the pane has no room for one. So the sentence is
   *  there to be asked for: a pointer over the glyph shows it, a thumb taps it,
   *  and the keyboard reaches it like anything else.
   *
   *  Not a `title`, and not a bubble of its own: the card the sentence appears in
   *  is `.nib-bubble` in the themes package, which the name being renamed on a row
   *  shows its reason in too. What is here is where this one sits.
   *
   *  The glyph's own name is the sentence, so a screen reader reads it on focus
   *  and the bubble is decoration by the time it appears. */

  import Info from 'lucide/dist/esm/icons/info.mjs'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { dur } from './motion'

  const { text }: { text: string } = $props()

  let open = $state(false)
  let host = $state<HTMLElement>()

  /** A tap anywhere else puts it away, the way a menu closes. */
  function outside(event: PointerEvent) {
    if (open && host && !host.contains(event.target as Node)) open = false
  }
</script>

<svelte:window onpointerdown={outside} />

<span class="explain" bind:this={host}>
  <button
    type="button"
    aria-label={text}
    onclick={(event) => {
      // The row behind this is a control of its own; asking what a setting means
      // is not asking to change it.
      event.stopPropagation()
      open = !open
    }}
    onpointerenter={() => (open = true)}
    onpointerleave={(event) => {
      // A finger reports itself as a pointer entering and never leaving, so only
      // a real hover puts it away again; a tap is the click above.
      if (event.pointerType === 'mouse') open = false
    }}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation()
        open = false
      }
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Info as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  {#if open}
    <span
      class="nib-bubble sentence"
      aria-hidden="true"
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}>{text}</span
    >
  {/if}
</span>

<style>
  .explain {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  /* The glyph itself: quiet enough to be passed over by somebody who knows the
     word, and in the same slot after every label that has one, so a label
     without one sits exactly where it did. */
  button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  button:hover {
    color: var(--text-strong);
  }

  button:focus-visible {
    outline-offset: 1px;
  }

  /* A mark inside a row rather than in front of a name: `--icon-sm`, which is
     what every other such mark in the app is. It was 14px. */
  svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Where this one sits: under the glyph, and left-aligned to it rather than
     centred on it, because a label sits at the left of its row, so there is room
     that way and none the other. The card itself is `.nib-bubble`. */
  .sentence {
    position: absolute;
    top: calc(100% + 6px);
    inset-inline-start: -8px;
    z-index: var(--z-popover);
  }

  /* A thumb needs a target, and the sentence needs the width the screen has.
     Not a whole finger's row: this sits inside one beside the words it belongs
     to, and a 48px circle in the middle of a label would be the label's size.

     So the glyph grows to Android's 24dp and the *target* grows to the 48 a
     finger needs, invisibly, around it: what is drawn and what can be hit are
     two different sizes, which is how a small control is aimed at without being
     drawn big. It used to be a 26px box - a number of its own, under the floor,
     and the only thing a finger had to land on. */
  :global([data-touch]) button {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  :global([data-touch]) button::after {
    content: '';
    position: absolute;
    inset: calc((var(--touch-icon) - var(--touch-target)) / 2);
  }

  :global([data-touch]) svg {
    width: var(--touch-mark);
    height: var(--touch-mark);
  }
</style>
