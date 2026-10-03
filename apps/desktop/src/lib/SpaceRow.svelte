<script lang="ts">
  /** What a space's row in a list of spaces says, wherever the list is: the title bar's
   *  menu and the switcher in the middle of the window draw the same row, so there is
   *  one switcher in two places and not two of them.
   *
   *  In front, the space's mark, which wears the space's number at its corner once a
   *  digit is typed or while Alt is held (SpacePlace.svelte). What was typed shows as the
   *  hits it is, the palette's own bold, since no field holds it; see space-pick.ts.
   *
   *  At the end, what a space has to add about itself: somebody else can reach it, or -
   *  in the place of that - it is somebody else's to write and yours only to read; and
   *  a page of it out of sight playing. */
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import { t } from './i18n.svelte'
  import { pieces } from './palette/pieces'
  import SharedMark from './SharedMark.svelte'
  import { isShared, roleOf } from './sharing.svelte'
  import SpaceBadge from './SpaceBadge.svelte'
  import SpacePlace from './SpacePlace.svelte'
  import { isNumber } from './space-pick'
  import { spaceSound } from './surfaces.svelte'
  import type { Space } from './workspace.svelte'

  const {
    space,
    place,
    typed = '',
    held = false,
    on = false,
  }: { space: Space; place: number; typed?: string; held?: boolean; on?: boolean } = $props()

  const name = $derived(
    isNumber(typed) ? [{ text: space.name, hit: false }] : pieces(space.name, typed),
  )
  const reads = $derived(roleOf(space.root) === 'read')
</script>

<SpacePlace {place} {typed} {held}><SpaceBadge {space} {on} /></SpacePlace>
<span class="nib-row-label"
  >{#each name as piece, at (at)}{#if piece.hit}<b>{piece.text}</b
      >{:else}{piece.text}{/if}{/each}</span
>
{#if reads}
  <SharedMark icon={Eye} label={t('Read-only')} />
{:else if isShared(space.root)}
  <SharedMark />
{/if}
{#if spaceSound.asked}
  {#await spaceSound.asked then Sound}<Sound id={space.id} />{/await}
{/if}

<style>
  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
</style>
