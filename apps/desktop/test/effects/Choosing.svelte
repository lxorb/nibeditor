<script lang="ts">
  /** The card mounted the way App.svelte mounts it: while the chooser is up, and
   *  taken away by the window's own `{#if}` once it is not. */
  import SpaceChooser from '../../src/lib/SpaceChooser.svelte'
  import { spaceChooser } from '../../src/lib/space-chooser.svelte'
</script>

{#if spaceChooser.showing}
  <SpaceChooser />
{/if}
