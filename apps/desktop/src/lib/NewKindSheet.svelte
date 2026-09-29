<script lang="ts">
  /** What a new tab should be, in the middle of the window: Ctrl+T.
   *
   *  Emil, 2026-09-27: *"we need an other modal, not just a small one but a proper
   *  modal in the centre of the screen."* So the kinds are cards here, the ones a pane
   *  with nothing open draws, with the website standing; see KindCard.svelte and
   *  new-kind-choice.ts. No heading and no words beyond each card's own name: the
   *  marks say what the choice is.
   *
   *  The contract every layer keeps, from the same parts: the shared scrim and screen
   *  out of the themes package, the rise every layer rises with, Escape through the
   *  overlay stack, back on a phone, and the keyboard held inside and handed back. See
   *  Sheet.svelte, motion.ts and trap.ts.
   *
   *  The keys: the arrows step, Home and End go to the ends, Enter and Space make the
   *  one that stands, a card's letter makes that one outright. Held under Ctrl, T steps
   *  and letting go chooses; that half is the window's and is new-kind-chord.ts. */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { steppedKey } from './direction'
  import { t } from './i18n.svelte'
  import KindCard from './KindCard.svelte'
  import { LAYER } from './motion'
  import { newKindSheet as sheet } from './new-kind-sheet.svelte'
  import { overlays } from './overlays'
  import { trap } from './trap'

  // Escape closes it, like everything else the app puts over a note; see overlays.ts.
  $effect(() => (sheet.open ? overlays.show(() => sheet.dismiss()) : undefined))
  $effect(() => closeOnBack(sheet.open, () => sheet.dismiss()))

  let box = $state<HTMLElement>()

  /** The keyboard stands where the selection does, so the ring, the lit card and what
   *  Enter makes are one card however the selection moved: a key, T under a held Ctrl,
   *  or the pointer. */
  $effect(() => {
    if (sheet.open) box?.querySelectorAll<HTMLElement>('button')[sheet.at]?.focus()
  })

  /** A step, with the arrows turned round for a language that reads the other way:
   *  the cards stand in a row that does. */
  const STEPS: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  }

  function onKeydown(event: KeyboardEvent) {
    const by = STEPS[steppedKey(event.key)]

    if (by !== undefined) sheet.step(by)
    else if (event.key === 'Home') sheet.standOn(0)
    else if (event.key === 'End') sheet.standOn(sheet.kinds.length - 1)
    else if (event.key === 'Enter' || event.key === ' ') sheet.pick()
    else if (event.altKey || event.metaKey || !sheet.pickLetter(event.key)) return

    // Spent here: the app reads its own keys off the window, and Ctrl+N or Ctrl+W
    // there would be a second thing done behind the dialog.
    event.preventDefault()
    event.stopPropagation()
  }

  /** Only a pointer that moved. A dialog that rises under a resting pointer has a card
   *  under it, and the browser tells that card so without anything having moved: taken
   *  as a hand, it would move the selection off the website before anybody chose. */
  function onMove(event: PointerEvent, at: number) {
    if (event.movementX || event.movementY) sheet.standOn(at)
  }
</script>

{#if sheet.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => sheet.dismiss()}
  ></div>

  <div
    class="nib-screen sheet"
    style:--kinds={sheet.kinds.length}
    bind:this={box}
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('New')}
    tabindex="-1"
    onkeydown={onKeydown}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#each sheet.kinds as one, index (one.kind)}
      <KindCard
        {one}
        on={index === sheet.at}
        letter={one.letter}
        data-lands={index === sheet.at ? '' : undefined}
        onclick={() => sheet.pick(index)}
        onfocus={() => sheet.standOn(index)}
        onpointermove={(event: PointerEvent) => onMove(event, index)}
      />
    {/each}
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package draws the surface, the corner, the hairline
     and the shadow. What is its own: the middle of the window rather than a third of
     the way down, because nothing is typed here and the cards are the whole of it, and
     as wide as the cards in it, with the room between two cards all the way round
     them, so the edge is one more gap rather than a frame of its own.

     A grid of one row, one column a kind, rather than a row that wraps: a wrapped row
     is as wide as it would have been unwrapped, which left the edge wider at the sides
     than at the top, and the cards give way together before any of them moves. */
  .sheet {
    top: 50%;
    translate: -50% -50%;
    z-index: 51;
    display: grid;
    grid-template-columns: repeat(var(--kinds), minmax(0, auto));
    gap: var(--space-3);
    width: max-content;
    max-width: calc(100vw - var(--space-7));
    padding: var(--space-3);
    outline: none;
  }

  /* Two rows where one no longer fits, as even as the count allows: five as three and
     two rather than four and one on its own, and six as three and three. An engine
     that cannot round here keeps the one row, with the cards narrower. */
  @media (max-width: 800px) {
    .sheet {
      grid-template-columns: repeat(round(up, calc(var(--kinds) / 2), 1), minmax(0, auto));
    }
  }

  /* From the bottom under a thumb, the way every sheet there rises, with the cards
     as rows the width of the screen. */
  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    grid-template-columns: 100%;
    width: 100%;
    max-width: none;
    padding-bottom: var(--touch-bottom);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  :global([data-touch]) .sheet > :global(.kind) {
    width: 100%;
  }
</style>
