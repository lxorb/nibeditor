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
   *  is what every other list in the app is; see roving.ts. The cards are the ones the
   *  Ctrl+T dialog draws; see KindCard.svelte. */
  import KindCard from './KindCard.svelte'
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
    <KindCard {one} rise={index} onclick={() => one.make(paneId)} />
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

  /* Stacked under a thumb, at the row height every other list has there. */
  :global([data-touch]) .here {
    flex-direction: column;
    flex-wrap: nowrap;
  }
</style>
