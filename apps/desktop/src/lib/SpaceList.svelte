<script lang="ts">
  /** Every space as a row to switch to, numbered, with what has been typed found in
   *  them: the rows the title bar's menu and the switcher in the middle of the window
   *  both are. The list around them, its keys and where it stands are the caller's;
   *  what is typed is a SpaceTyping the caller holds, since it is the caller's list the
   *  keys arrive at. See SpaceSwitcher.svelte and SpacePicker.svelte.
   *
   *  Each row says which space a carried tab would land in (`data-space-drop`), which
   *  is the whole of what a drop asks of it; see tab-strip/space-drop.ts. */
  import { tick } from 'svelte'
  import { longPress } from './longpress'
  import RowMore from './RowMore.svelte'
  import SpaceRow from './SpaceRow.svelte'
  import type { SpaceTyping } from './space-typing.svelte'
  import { type Space, workspace } from './workspace.svelte'

  const {
    typing,
    choose,
    about,
  }: {
    typing: SpaceTyping
    choose: (space: Space) => void
    /** A space's own menu, where the list offers one. */
    about?: (event: MouseEvent, space: Space) => void
  } = $props()

  /** Each row's button, by the space's place in the list. */
  const buttons = $state<Record<number, HTMLButtonElement | null>>({})

  const shown = $derived(
    typing.reading.shown.flatMap((at) => {
      const space = workspace.spaces[at]
      return space ? [{ space, at }] : []
    }),
  )

  // The keyboard stands on the row that is meant as soon as anything is typed: the
  // number, or the best of the names. Enter is then that row's own, as it is in any
  // list, and the arrows go on from it.
  $effect(() => {
    const best = typing.reading.best
    if (best >= 0) void tick().then(() => buttons[best]?.focus())
  })
</script>

{#each shown as { space, at } (space.id)}
  <div class="line" role="none">
    <button
      class="nib-row"
      class:is-on={space.id === workspace.activeSpaceId}
      data-space-drop={space.id}
      data-lands={space.id === workspace.activeSpaceId ? '' : undefined}
      role="menuitem"
      bind:this={buttons[at]}
      onclick={() => choose(space)}
      oncontextmenu={(event) => about?.(event, space)}
      use:longPress={(event) => about?.(event, space)}
    >
      <SpaceRow {space} place={at} typed={typing.typed} on={space.id === workspace.activeSpaceId} />
    </button>

    <!-- What the space itself offers, where the list offers it. -->
    {#if about}
      <RowMore onclick={(event: MouseEvent) => about(event, space)} />
    {/if}
  </div>
{/each}

<style>
  /* A row and the button at the end of it share one line, so the name gives way to
     the button rather than running under it. */
  .line {
    display: flex;
    align-items: center;
  }

  .line .nib-row {
    flex: 1;
    min-width: 0;
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  /* A carried tab would land here; see tab-strip/space-drop.ts. */
  button:global(.is-drop) {
    box-shadow: inset 0 0 0 1px var(--accent);
    background: var(--accent-soft);
  }
</style>
