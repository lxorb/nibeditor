<script lang="ts">
  /** A terminal in a pane: the screen, and the find bar over it when it is up.
   *
   *  The screen is not this component's. It belongs to the tab and outlives this, which is
   *  taken apart the moment another tab is in front: what is here is the place it is
   *  drawn, handed over as this arrives and taken back as it goes. See
   *  sessions.svelte.ts.
   *
   *  The keyboard comes here when the tab comes to the front of the pane that has it. It
   *  comes back when whatever was put over it - the palette, a menu, a question - goes,
   *  and when the window does, from where the window keeps it; see keyboard-home.ts. */

  import { onMount, untrack } from 'svelte'
  import FindBar from '../FindBar.svelte'
  import type { Tab } from '../workspace.svelte'
  import { sessionOf } from './sessions.svelte'

  const { tab: shown, focused }: { tab: Tab; focused: boolean } = $props()

  /** The tab this pane is for, held from the moment it is built; see WebTab.svelte for
   *  why the prop is not read after that. */
  const tab = untrack(() => shown)
  const session = sessionOf(tab)

  let place = $state<HTMLElement>()

  onMount(() => {
    if (place)
      void session.attach(
        place,
        untrack(() => focused),
      )

    return () => session.detach()
  })

  // To the front of the pane that has the keyboard: the keyboard comes with it.
  $effect(() => {
    if (focused) untrack(() => session.focus())
  })
</script>

<div class="terminal" data-region="editor">
  {#if session.finding}
    <FindBar
      query={session.query}
      count={session.found.count}
      current={session.found.at}
      onstep={(by: number) => session.step(by)}
      onclose={() => session.closeFind()}
      onquery={(typed: string) => session.look(typed)}
    />
  {/if}

  <div class="place" bind:this={place}></div>
</div>

<style>
  /* The note's ground, edge to edge, so a terminal is a page of the window rather than a
     box inside one. */
  .terminal {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }

  .place {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* The screen's own element, made by the session rather than by this component, so
     reached through the scope. Inset by the room a note's first line has from the edge,
     and the scrollbar left at the very edge where a pointer finds it. */
  .place :global(.nib-terminal) {
    position: absolute;
    inset: var(--space-2) 0 0 var(--space-3);
  }

  .place :global(.xterm) {
    height: 100%;
  }
</style>
