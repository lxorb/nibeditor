<script lang="ts">
  /** The kinds a tab can be, offered where a tab would be: a pane with nothing open, and
   *  a new tab under its address field.
   *
   *  Emil, 2026-09-14: *"it should be possible to have no note open (there should not
   *  always open a new one). Cause then there should just be options between the
   *  different note types which would then create the corresponding note if clicked
   *  (the corresponding button)."* So closing the last note leaves the pane empty, and
   *  what fills it is the choice itself rather than a note nobody asked for.
   *
   *  And issue #213: Ctrl+T and the plus make a new tab that shows *"the same view as
   *  when pressed Ctrl + D with the only difference being that the navbar at the top
   *  where you can enter a url is still there"*. So this is drawn in both places, out of
   *  the one list and in its three lines (see new-kinds.ts); in a new tab the kind chosen
   *  takes that tab's place (`chosenOn`, see `chosenOn` in workspace.svelte.ts), and the
   *  address field keeps the keyboard it was given.
   *
   *  Each card wears its letter, and the letter makes it - only while the keyboard is
   *  not in a field, so typing an address never makes anything; see new-kind-keys.ts.
   *
   *  In an empty pane the keyboard lands on the first card, so Enter is the new note
   *  this used to make on its own, and the arrows walk the rest - one tab stop for the
   *  group, which is what every other list in the app is; see roving.ts. The cards are
   *  KindCard.svelte. */
  import { t } from './i18n.svelte'
  import KindCard from './KindCard.svelte'
  import { kindLines, newKinds, type NewKindRow, showOthers } from './new-kinds'
  import { kindOfLetter, letterIsOurs } from './new-kind-keys'
  import { overlays } from './overlays'
  import { roving } from './roving'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'

  const { paneId, chosenOn }: { paneId: string; chosenOn?: string } = $props()

  const kinds = $derived(newKinds())
  const lines = $derived(kindLines(kinds))

  /** Says which new tab the choice is made on, where this is one; see `chosenOn`. */
  function choosing() {
    if (chosenOn !== undefined) workspace.chosenOn(chosenOn)
  }

  function make(one: NewKindRow) {
    choosing()
    one.make(paneId)
  }

  /** The kind's other forms at its card, where it has any: a terminal's other shells. */
  function others(one: NewKindRow, card: Element | null | undefined): boolean {
    return !!card && showOthers(one, card, paneId, choosing)
  }

  /** A press on a card makes its kind, and one on its chevron - or with Shift - shows
   *  the kind's other forms instead. */
  function choose(event: MouseEvent, one: NewKindRow) {
    const chevron = event.target instanceof Element && event.target.closest('[data-more]')
    const card = event.currentTarget instanceof Element ? event.currentTarget : null
    if ((chevron || event.shiftKey) && others(one, card)) return
    make(one)
  }

  let element = $state<HTMLElement>()

  /** The keyboard, once, as the pane empties. Only where the keyboard was in this
   *  pane or nowhere at all: a note closed from the file list leaves somebody's hand
   *  in the file list, and a button that took it from there would be this pane
   *  answering a press nobody aimed at it. Never in a new tab, whose address field has
   *  it. */
  $effect(() => {
    if (chosenOn !== undefined || workspace.panes.focusedId !== paneId) return

    const at = document.activeElement
    if (at && at !== document.body && !element?.contains(at)) return

    element?.querySelector('button')?.focus()
  })

  /** Whether this view is the one a letter is for: the pane being worked in, nothing
   *  over it, and - in a new tab - that tab still in front. */
  function hears(): boolean {
    if (workspace.panes.focusedId !== paneId || overlays.depth > 0) return false
    if (chosenOn !== undefined && workspace.showing(paneId)?.id !== chosenOn) return false

    return letterIsOurs(document.activeElement, element?.closest('[data-pane]') ?? element ?? null)
  }

  // On the window, before anything else hears it: with the keyboard on nothing the press
  // is the window's, and with it on a card the group's own letters would spell a name.
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const one = kindOfLetter(kinds, event)
      if (!one || !hears()) return

      event.preventDefault()
      event.stopPropagation()
      const card = element?.querySelector(`[data-kind="${one.kind}"]`)
      if (event.shiftKey && others(one, card)) return
      make(one)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
</script>

<!-- One tab stop for the group, and the arrows inside it: left and right where the
     buttons stand in lines, up and down where a phone stacks them. -->
<div
  class="here"
  bind:this={element}
  data-new-here={paneId}
  use:roving={{ across: !viewport.touch, rows: 'button', wrap: true }}
  role="group"
  aria-label={t('New tab')}
>
  {#each lines as line (line[0]?.line)}
    <div class="line">
      {#each line as one (one.kind)}
        <!-- The shells behind the terminal's chevron are found as a hand comes near it,
             not as the pane empties: an empty pane is what a window can open on. -->
        <KindCard
          {one}
          letter={one.letter}
          rise={kinds.indexOf(one)}
          data-kind={one.kind}
          aria-keyshortcuts={one.letter.toUpperCase()}
          onclick={(event: MouseEvent) => choose(event, one)}
          onpointerenter={() => one.ready?.()}
          onfocus={() => one.ready?.()}
        />
      {/each}
    </div>
  {/each}
</div>

<style>
  /* The pane's own ground, with the cards in the middle of it: nothing is drawn
     around them, because the pane is the frame. */
  .here {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-6);
    /* The paper, or what the theme says an empty pane stands on; see Pane.svelte. */
    background: var(--empty-ground, var(--bg));
    overflow: auto;
  }

  /* One line of kinds: what is written, what runs, the web. A line too wide for the
     pane gives way under itself rather than into the next. */
  .line {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
  }

  /* Stacked under a thumb, at the row height every other list has there. */
  :global([data-touch]) .here,
  :global([data-touch]) .line {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: center;
  }

  :global([data-touch]) .line {
    width: 100%;
  }
</style>
