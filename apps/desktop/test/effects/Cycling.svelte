<script lang="ts">
  /** A pane as Pane.svelte has it for a web tab: the tab in front, given a surface of its
   *  own, so every switch takes one surface down and puts the next one up. */
  import WebTab from '../../src/lib/web-tab/WebTab.svelte'
  import { workspace } from '../../src/lib/workspace.svelte'

  const tab = $derived(workspace.active)
</script>

{#if tab?.kind === 'web'}
  {#key tab.id}
    <WebTab {tab} focused />
  {/key}
{/if}
