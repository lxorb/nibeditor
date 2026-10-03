<script lang="ts">
  /** The mark a space is known by, in the badge every surface that names a space puts it
   *  in. One drawing for the switcher's header and for each space's row, so the space you
   *  are in cannot come to wear something its own row does not: the same badge at the
   *  same size either way. `on` is the accent the space you are in wears in a list. */
  import SpaceMark from './SpaceMark.svelte'
  import type { Space } from './workspace.svelte'

  const { space, on = false }: { space: Space; on?: boolean } = $props()
</script>

<span class="nib-badge" class:is-on={on} aria-hidden="true">
  <SpaceMark id={space.id} name={space.name} />
</span>
