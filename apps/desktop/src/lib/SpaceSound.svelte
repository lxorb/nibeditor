<script lang="ts">
  /** The tab's speaker on a space's row in the switcher, while a set of that space out of
   *  sight has a page playing, so a page left running is never one nobody can find: the
   *  row is the way back to it. Vivaldi marks a workspace that plays the same way. See
   *  workspace/sets.svelte.ts and workspace/hidden-tabs.svelte.ts. */
  import SoundMark from './SoundMark.svelte'
  import { sets } from './workspace/sets.svelte'

  const { id }: { id: string } = $props()
</script>

{#if sets.playing.includes(id)}<SoundMark />{/if}
