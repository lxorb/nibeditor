<script lang="ts">
  /** Another space, in the middle of the window: Ctrl+Shift+Space.
   *
   *  Every space as the title bar's menu draws it, numbered, and nothing else - no
   *  heading, no field, no New space: this is for going somewhere. A digit goes at once
   *  where only one space can be meant; letters find a space by its name, show where
   *  they landed in it, and wait for Enter. Backspace takes a letter back, Escape and
   *  the key again put it away, the arrows walk. See space-pick.ts.
   *
   *  The contract every layer keeps, from the same parts: the shared scrim and screen
   *  out of the themes package, centred and a sheet wide (`--screen-sheet`, as choosing
   *  a space always was), the rise every layer rises with, Escape through the overlay
   *  stack, back on a phone, the keyboard held inside and handed back. As tall as every
   *  space while it is up, so the rows a name leaves out never move the edge: a layer
   *  in the middle does not change size. See docs/design.md. */
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { LAYER } from './motion'
  import { overlays } from './overlays'
  import { roving } from './roving'
  import SpaceList from './SpaceList.svelte'
  import { spacePicker } from './space-picker.svelte'
  import { SpaceTyping } from './space-typing.svelte'
  import { trap } from './trap'
  import { type Space, workspace } from './workspace.svelte'

  $effect(() => (spacePicker.open ? overlays.show(() => spacePicker.dismiss()) : undefined))
  $effect(() => closeOnBack(spacePicker.open, () => spacePicker.dismiss()))

  /** What is typed into it, new each time it opens. */
  const typing = $derived(
    spacePicker.open ? new SpaceTyping((space) => spacePicker.choose(space)) : null,
  )
  $effect(() => {
    const one = typing
    return () => one?.stop()
  })
</script>

{#if typing}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => spacePicker.dismiss()}
  ></div>

  <div
    class="nib-screen is-centred is-steady picker"
    style:--rows={workspace.spaces.length}
    data-spaces-open
    role="menu"
    aria-label={t('Spaces')}
    use:trap
    use:roving={{ current: '.is-on', wrap: true }}
    onkeydowncapture={typing.press}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <SpaceList {typing} choose={(space: Space) => spacePicker.choose(space)} />
  </div>
{/if}

<style>
  /* `.nib-screen` draws the surface and stands it in the middle (`is-centred`), one
     height while it is up (`is-steady`). What is its own: a sheet wide, the room a row
     of the menus has round it, and that height as the whole list's, held by `--rows`
     rather than by what is shown. */
  .picker {
    --screen-width: var(--screen-sheet);
    --screen-height: calc(var(--rows) * var(--row-height) + 2 * var(--space-1) + 2px);
    z-index: var(--z-sheet);
    padding: var(--space-1);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }
</style>
