<script lang="ts">
  /** A host's mark: the server a remote terminal's tab wears, in the colour Settings
   *  gave the host, or in the row's own ink where it has none. Every list of hosts
   *  draws it - the picker, Settings, the palette - so a host is the same shape and the
   *  same colour wherever it is named. See terminal/TerminalMark.svelte for the tab's. */
  import Server from 'lucide/dist/esm/icons/server.mjs'
  import Icon from '../Icon.svelte'
  import type { Colour } from './hosts'

  const { colour = null }: { colour?: Colour | null } = $props()
</script>

<span
  class="mark"
  style:color={colour === null ? undefined : `var(--canvas-${colour})`}
  aria-hidden="true"
>
  <Icon icon={null} fallback={Server} />
</span>

<style>
  /* FileMark's box and stroke. */
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }
</style>
