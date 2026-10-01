<script lang="ts">
  /** The panes, laid out the way the tree says: a pane, or two sides with a
   *  divider between them, each side being a pane or another split. It renders
   *  itself for each side, which is what makes the tree a tree.
   *
   *  A grid rather than flexbox, so the share of the room each side takes is
   *  exactly the number the tree holds and the divider is a real line rather
   *  than a gap between two floats. */

  import Pane from './Pane.svelte'
  import PaneTree from './PaneTree.svelte'
  import { type Frame, paneIn, type Split } from './workspace/pane-tree'
  import { workspace } from './workspace.svelte'

  const { frame }: { frame: Frame } = $props()

  /** The frame as a split, when it is one. Read here rather than narrowed in the
   *  markup: this component names itself, and a type that refers to itself
   *  through the component it is a prop of is one the compiler gives up on. */
  const split = $derived(frame.kind === 'split' ? frame : null)

  /** Which side holds the pane filling the window, where this split holds it: the other
   *  side and the divider go while it does. See lib/tab-fill. */
  const kept = $derived.by(() => {
    const fills = workspace.panes.fills
    return split && fills ? split.sides.findIndex((side) => paneIn(side, fills)) : -1
  })

  let host = $state<HTMLElement>()

  /** How to end the drag that is on, if one is. A pane can be closed from a key
   *  or a menu while a finger is on the divider, and then the handle goes without
   *  ever hearing `pointerup` - which would leave the window wearing a resize
   *  cursor, with nothing on the page selectable. */
  let dragging: (() => void) | null = null

  $effect(() => () => dragging?.())

  /** The divider follows the pointer, and the panes stop easing while it does:
   *  a transition on the way to where the finger already is reads as lag.
   *
   *  Pointer capture keeps the events coming once the pointer has left the thin
   *  handle, which it does in the first few pixels of any drag. The room is
   *  measured once at the start, since reading it again on every move would
   *  measure what this drag has already done. */
  function grab(event: PointerEvent & { currentTarget: HTMLElement }, split: Split) {
    if (event.button !== 0 || !host) return

    const handle = event.currentTarget
    const box = host.getBoundingClientRect()
    const along = split.along

    handle.setPointerCapture(event.pointerId)
    workspace.panes.sliding = split.id
    document.body.style.cursor = along === 'row' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const move = (moved: PointerEvent) => {
      const room = along === 'row' ? box.width : box.height
      const at = along === 'row' ? moved.clientX - box.left : moved.clientY - box.top
      workspace.panes.resize(split.id, at / room, room)
    }

    const stop = () => {
      if (!dragging) return
      dragging = null

      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)

      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      workspace.panes.settle()
    }

    dragging = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  const share = (split: Split) =>
    `${(split.fraction * 100).toFixed(3)}% 1px ${((1 - split.fraction) * 100).toFixed(3)}%`
</script>

{#if split}
  <div
    class="split"
    class:down={split.along === 'column'}
    class:sliding={workspace.panes.sliding === split.id}
    bind:this={host}
    style:grid-template-columns={split.along === 'row' && kept < 0 ? share(split) : undefined}
    style:grid-template-rows={split.along === 'column' && kept < 0 ? share(split) : undefined}
  >
    <!-- A side as an item, not `split.sides[i]`: a pane's teardown reads it once a
         collapsing split is null, and an item keeps the last side. -->
    {#each split.sides as side, at (side.id)}
      {#if at === 1 && kept < 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="divider"
          onpointerdown={(event) => grab(event, split)}
          ondblclick={() => workspace.panes.equalise(split.id)}
        ></div>
      {/if}

      {#if kept < 0 || kept === at}
        <div class="side"><PaneTree frame={side} /></div>
      {/if}
    {/each}
  </div>
{:else if frame.kind === 'pane'}
  <Pane pane={frame} />
{/if}

<style>
  .split {
    display: grid;
    flex: 1;
    min-width: 0;
    min-height: 0;
    /* The share of the room eases when it changes on its own - a pane opening, a
       double click - and not while a finger is on the divider. */
    transition:
      grid-template-columns var(--dur-base) var(--ease-out),
      grid-template-rows var(--dur-base) var(--ease-out);
  }

  .split.sliding {
    transition: none;
  }

  .side {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* A line one pixel wide, with three pixels either side of it to take hold of:
     a handle you can see is a handle in the way. */
  .divider {
    position: relative;
    background: var(--line);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .divider::after {
    content: '';
    position: absolute;
    inset: 0 -3px;
    cursor: col-resize;
  }

  .split.down > .divider::after {
    inset: -3px 0;
    cursor: row-resize;
  }

  .divider:hover,
  .split.sliding > .divider {
    background: var(--accent);
  }
</style>
