<script lang="ts">
  /** A pane with nothing open.
   *
   *  Emil, 2026-09-14: *"it should be possible to have no note open (there should not
   *  always open a new one). Cause then there should just be options between the
   *  different note types which would then create the corresponding note if clicked
   *  (the corresponding button)."* So closing the last note leaves the pane empty, and
   *  what fills it is the choice itself rather than a note nobody asked for.
   *
   *  The same rows as the plus and Ctrl+T, out of the same list and in the same order,
   *  drawn large: a chooser nobody has to open, because there is nothing else here to
   *  look at. Anything that appeared only here would be a second list to keep in step;
   *  see new-kinds.ts.
   *
   *  The keyboard lands on the first of them, so Enter is the new note this used to
   *  make on its own, and the arrows walk the rest - one tab stop for the group, which
   *  is what every other list in the app is; see roving.ts. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { MARKS } from './file-mark'
  import Icon from './Icon.svelte'
  import { dur } from './motion'
  import { newKinds } from './new-kinds'
  import { roving } from './roving'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'

  const { paneId }: { paneId: string } = $props()

  const kinds = $derived(newKinds())

  let element = $state<HTMLElement>()

  /** The keyboard, once, as the pane empties. Only where the keyboard was in this
   *  pane or nowhere at all: a note closed from the file list leaves somebody's hand
   *  in the file list, and a button that took it from there would be this pane
   *  answering a press nobody aimed at it. */
  $effect(() => {
    if (workspace.panes.focusedId !== paneId) return

    const at = document.activeElement
    if (at && at !== document.body && !element?.contains(at)) return

    element?.querySelector('button')?.focus()
  })
</script>

<!-- One tab stop for the group, and the arrows inside it: left and right where the
     buttons stand in a row, up and down where a phone stacks them. -->
<div
  class="here"
  bind:this={element}
  data-new-here={paneId}
  use:roving={{ across: !viewport.touch, rows: 'button', wrap: true }}
  role="group"
>
  {#each kinds as one, index (one.kind)}
    <!-- Each rises as the pane empties, a moment after the one before it, and none of
         it moves at all for somebody who has asked their system for less; see
         motion.ts. -->
    <button
      class="kind"
      onclick={() => one.make(paneId)}
      in:fly={{ y: 10, duration: dur(150), delay: dur(index * 40), easing: cubicOut }}
    >
      <!-- The kind's own mark, drawn large: nothing here chose an icon, so the mark
           is the fallback, which is what every list that shows a kind does. See
           Icon.svelte and FileMark.svelte. -->
      <span class="mark" aria-hidden="true"><Icon icon={null} fallback={MARKS[one.mark]} /></span>
      <span class="nib-row-label">{one.label()}</span>
    </button>
  {/each}
</div>

<style>
  /* The pane's own ground, with the buttons in the middle of it: nothing is drawn
     around them, because the pane is the frame. */
  .here {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-6);
    background: var(--bg);
    overflow: auto;
  }

  /* A card rather than a row: this is the one place a kind is chosen with nothing
     else on screen, so it is drawn at the size that says so. The hairline and the
     corner are the app's own, which is what every surface here wears. */
  .kind {
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

  .kind:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  /* Lifts under the pointer and under the keyboard both, so the ring is not the only
     thing that says which one is about to be pressed. */
  .kind:hover,
  .kind:focus-visible {
    translate: 0 -2px;
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

  .kind:hover .mark,
  .kind:focus-visible .mark {
    color: var(--accent);
  }

  /* Stacked under a thumb, at the row height every other list has there. */
  :global([data-touch]) .here {
    flex-direction: column;
    flex-wrap: nowrap;
  }

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
</style>
