<script lang="ts">
  /** Which space this is, and the way to any other one.
   *
   *  The column of wordless squares down the left of the window is gone: there
   *  were two ways to choose a space and this is the better one, because it says
   *  the name. What the column carried comes here - every space with its own
   *  mark, the quiet dot that says somebody else is in it, and what a space
   *  itself offers, on the row it is about.
   *
   *  It opens *inside* the panel rather than floating over the app: the anchor is
   *  always the top of the list, so the list of spaces is the width of the list
   *  of notes and needs no measuring, no flipping at an edge and no second sheet
   *  written for a phone. A drawer is a panel too, so a thumb gets exactly what a
   *  pointer gets.
   *
   *  With the panel shut it sits in the title bar, `bare`: the mark and no name,
   *  opening the same list; see Titlebar.svelte. */
  import { arrive, leave } from './slide'
  import NameField from './NameField.svelte'
  import { overlays } from './overlays'
  import { shortcuts } from './shortcuts.svelte'
  import { commitSpaceName } from './space-actions'
  import SharedMark from './SharedMark.svelte'
  import SpaceBadge from './SpaceBadge.svelte'
  import { spacesMenu } from './surfaces.svelte'
  import { t } from './i18n.svelte'
  import { isShared } from './sharing.svelte'
  import { workspace } from './workspace.svelte'

  const { bare = false }: { bare?: boolean } = $props()

  let open = $state(false)

  const here = $derived(workspace.activeSpace)
  const name = $derived(here?.name ?? t('Spaces'))

  /** The bare mark's words, for its tooltip and a screen reader. */
  const called = $derived(here ? t('{name}: switch space', { name: here.name }) : t('Spaces'))

  /** The names the switcher already holds, so the field can say a name is taken;
   *  a space keeping its own name is not taking it from itself. */
  const otherSpaces = $derived(
    workspace.spaces.filter((space) => space.id !== here?.id).map((space) => space.name),
  )

  /** Whether the name being typed cannot be written, which the header wears as a
   *  hairline in red exactly as a row does; the field is what knows why. */
  let wrong = $state(false)

  // Escape closes it, the way Escape closes everything else the app opens over
  // what is under it; see overlays.ts.
  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))

  // What a space wears in its badge, and which set has to be fetched to draw it,
  // are the badge's own business: SpaceBadge.svelte.
</script>

<!-- The mark of the space you are in, for the header over the file list. Plain
     rather than `is-on`: this is where you are, said quietly, not a row to pick
     out of a list of them.

     Keyed on the space, so changing space crosses one mark into the next rather
     than swapping the drawing between two frames - `arrive` and `leave` with
     nothing to slip, which is the app's own fade and is nothing at all for a
     reader who asked for less movement; see slide.ts and motion.ts. Both marks
     are in the page while they cross, which is what the box they share is for:
     the name beside them must not move. -->
{#snippet mark()}
  {#if here}
    {@const space = here}
    <span class="mark">
      {#key space.id}
        <span class="fade" in:arrive={{ y: 0 }} out:leave={{ y: 0 }}>
          <SpaceBadge {space} />
        </span>
      {/key}
    </span>
  {/if}
{/snippet}

{#if !bare && here && workspace.naming?.path === here.root}
  <!-- Renaming a space happens where its name is written, in the same field a row
       in the list uses: the header keeps its height, its weight and its chevron,
       and only the name becomes editable. See NameField.svelte. -->
  <div class="name" class:is-wrong={wrong}>
    {@render mark()}
    <NameField
      value={here.name}
      taken={otherSpaces}
      bind:wrong
      oncommit={(typed: string) => void commitSpaceName(here, typed)}
      oncancel={() => workspace.cancelNaming()}
    />
    <svg class="chevron" viewBox="0 0 13 13"><path d="M3.6 5.2 6.5 8.1l2.9-2.9" /></svg>
  </div>
{:else}
  <!-- Bare, it is the bar's own square button, `.nib-glyph`, with the badge in it. -->
  <button
    class={bare ? 'nib-glyph bare' : 'name'}
    class:open
    data-space-drop="switcher"
    title={shortcuts.tooltip(bare ? called : name, 'space.switcher')}
    aria-label={bare ? called : undefined}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {@render mark()}
    {#if !bare}
      <span class="nib-row-label">{name}</span>
      <!-- Said on the header as well as on the row, so a space being shared is a
           fact you can see without opening the list of spaces to look for it. -->
      {#if here && isShared(here.root)}
        <SharedMark />
      {/if}
      <svg class="chevron" viewBox="0 0 13 13"><path d="M3.6 5.2 6.5 8.1l2.9-2.9" /></svg>
    {/if}
  </button>
{/if}

{#if open}
  <!-- The list itself, fetched with the first press rather than carried in front of
       the first paint, and warmed at the launch's last turn so that press finds it
       here; see SpaceMenu.svelte and surfaces.svelte.ts. -->
  {#await spacesMenu() then SpaceMenu}
    <SpaceMenu {bare} close={() => (open = false)} />
  {/await}
{/if}

<style>
  /* The space's name, and the whole of what the switcher is. The width of the
     panel, less whatever else is in the head: the list it opens is the width of
     the panel, so the control that opens it is too, and a header where only the
     word is pressable is a header most presses miss - on a phone especially,
     where the thumb lands wide of a short name. It was as wide as the word for a
     while, on the argument that a full-width hover puts a grey block across the
     header; the block is what a row does everywhere else in this panel, and
     missing the button is worse. Still `min-width: 0`, so a long name is cut
     rather than pushing the plus off the end. */
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--row-height);
    padding: 0 calc(var(--row-pad) - var(--space-1));
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .name:hover {
      background: var(--surface-hover);
    }
  }

  .name:active,
  .name.open {
    background: var(--surface-press);
  }

  /* `.nib-glyph` draws it; it stays pressed while its list is open, as the header does. */
  button.bare {
    align-self: center;
  }

  button.bare.open {
    background: var(--surface-press);
  }

  button.bare .mark {
    margin: 0;
  }

  /* The box the space's mark sits in, in front of its name. A box of its own
     because the two marks cross inside it: both are in the page for the length of
     the crossing, one over the other in the single cell of a grid, so the name
     beside them never moves. Nothing here draws the badge - that is `.nib-badge`
     in the themes package - only where it sits. */
  .mark {
    flex: none;
    display: grid;
    /* The name starts beside its mark at the distance every other row in the
       panel puts between the two, while what follows the name - the shared mark,
       the chevron - keeps the header's own tighter gap. */
    margin-inline-end: calc(var(--row-gap) - var(--space-1));
  }

  .mark > .fade {
    grid-area: 1 / 1;
  }

  /* Beside the word rather than at the far end of the panel: the two are one
     control, and a chevron floating in the middle of a bar belongs to nothing.
     What stays full width is the button, so there is still a header-sized thing
     to press. */
  .name .nib-row-label {
    flex: 0 1 auto;
  }

  /* Says the name can be pressed, and turns over while what it opened is open.
     `--icon-md`, the size of a mark that belongs to a name, so it grows with the
     word under a thumb instead of staying a pointer's size beside 19px type. */
  .chevron {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--muted);
    /* Painted, or an `svg` is filled black whatever `color` says. */
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .name.open .chevron {
    transform: rotate(180deg);
  }
</style>
