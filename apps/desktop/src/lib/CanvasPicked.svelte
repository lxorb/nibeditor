<script lang="ts">
  /** The bar over what is picked: its colour, another of it, gone, and the rest.
   *
   *  Four things, and they are the four a hand does to a card it has just put down.
   *  It sits over the selection rather than at the bottom of the pane, because that
   *  is where the hand already is and a plane is big: reaching a bar in the corner
   *  to colour a card in the middle is a journey for one press.
   *
   *  The rest of what can be done is the menu behind the fourth button, which is
   *  the same menu a right click and a long press open. One list, so nothing can be
   *  in one of them and missing from the other. */

  import CanvasColours from './CanvasColours.svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import { MARKS } from './canvas/glyphs'
  import { shownColour } from './canvas/palette'
  import { tick } from './canvas/tick'
  import { t } from './i18n.svelte'

  const {
    at,
    below,
    colour,
    recent,
    grouping,
    oncolour,
    onduplicate,
    ondelete,
    ongroup,
    onmore,
  }: {
    /** Where on screen, in pixels inside the plane's own element: the middle of the
     *  top edge of what is picked. */
    at: { x: number; y: number }
    /** Whether to hang under that point rather than over it, which is what happens
     *  when the selection is against the top of the pane. */
    below: boolean
    /** The colour what is picked wears, or nothing where it wears none. */
    colour: string | null
    recent: readonly string[]
    /** Whether the bar offers to make a frame round what is picked, to take one
     *  apart, or neither - which is one thing picked that is not a frame. */
    grouping: 'group' | 'ungroup' | null
    oncolour: (colour: string | null) => void
    onduplicate: () => void
    ondelete: () => void
    ongroup: () => void
    onmore: (event: MouseEvent) => void
  } = $props()

  let colouring = $state(false)
  let over = $state<HTMLElement>()

  function pick(next: string | null) {
    colouring = false
    oncolour(next)
  }

  // A press anywhere but on this bar puts the colours away, which is how every other
  // panel in the app closes. Caught on the way down rather than waited for on the way
  // up: the plane below stops the event at itself for its own gestures, and a panel
  // that only shuts when nothing else spoke first is a panel that does not shut.
  $effect(() => {
    const shut = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && over?.contains(target)) return

      colouring = false
    }

    window.addEventListener('pointerdown', shut, { capture: true })
    return () => window.removeEventListener('pointerdown', shut, { capture: true })
  })
</script>

<svelte:window onblur={() => (colouring = false)} />

<!-- Every pointer stops here: the plane behind would read a press as a gesture and
     clear the very selection this bar is about. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="over"
  class:below
  bind:this={over}
  style:left="{at.x}px"
  style:top="{at.y}px"
  onpointerdown={(event) => event.stopPropagation()}
  onpointermove={(event) => event.stopPropagation()}
  onpointerup={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
>
  {#if colouring}
    <div class="panel">
      <CanvasColours {colour} {recent} oncolour={pick} />
    </div>
  {/if}

  <div class="bar">
    <button
      type="button"
      class="swatch"
      class:on={colouring}
      class:bare={colour === null}
      title={t('Colour')}
      aria-label={t('Colour')}
      aria-pressed={colouring}
      style:--dot={shownColour(colour ?? undefined) ?? 'transparent'}
      onclick={() => {
        tick()
        colouring = !colouring
      }}
    ></button>

    <button
      type="button"
      title={t('Duplicate')}
      aria-label={t('Duplicate')}
      onclick={() => {
        tick()
        onduplicate()
      }}
    >
      <CanvasIcon node={MARKS.copy} />
    </button>

    <!-- Several things made one, or one taken apart. Only when there is something to
         do: one card picked has no group to make and no group to break. -->
    {#if grouping}
      <button
        type="button"
        title={grouping === 'group' ? t('Group') : t('Ungroup')}
        aria-label={grouping === 'group' ? t('Group') : t('Ungroup')}
        onclick={() => {
          tick()
          ongroup()
        }}
      >
        <CanvasIcon node={grouping === 'group' ? MARKS.group : MARKS.ungroup} />
      </button>
    {/if}

    <button
      type="button"
      class="gone"
      title={t('Delete')}
      aria-label={t('Delete')}
      onclick={() => {
        tick()
        ondelete()
      }}
    >
      <CanvasIcon node={MARKS.bin} />
    </button>

    <button
      type="button"
      title={t('More')}
      aria-label={t('More')}
      onclick={(event) => {
        tick()
        colouring = false
        // The menu closes on the next click anywhere, and this is a click: without
        // this it would open and shut inside the one press.
        event.stopPropagation()
        onmore(event)
      }}
    >
      <CanvasIcon node={MARKS.rest} />
    </button>
  </div>
</div>

<style>
  /* Over the middle of the top edge of the selection, clear of it by a step, and
     under it instead when there is no room above. */
  .over {
    position: absolute;
    z-index: var(--z-bars);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    translate: -50% calc(-100% - var(--space-2));
    animation: arrive var(--dur-fast) var(--ease-out);
  }

  .over.below {
    flex-direction: column-reverse;
    translate: -50% var(--space-2);
  }

  @keyframes arrive {
    from {
      opacity: 0;
      scale: 0.96;
    }
  }

  .bar {
    display: flex;
    align-items: stretch;
    gap: 1px;
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
  }

  .panel {
    box-sizing: border-box;
    max-width: 21rem;
    padding: var(--space-2);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  button {
    flex: none;
    display: grid;
    place-items: center;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:active {
    background: var(--press);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .gone {
    color: var(--danger);
  }

  .gone:active {
    background: var(--danger-soft);
  }

  .swatch::after {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
  }

  /* Nothing coloured, drawn as the ring the others fill. */
  .swatch.bare::after {
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-width: var(--touch-target);
    min-height: var(--touch-target);
  }

  :global([data-touch]) .swatch::after {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }
</style>
