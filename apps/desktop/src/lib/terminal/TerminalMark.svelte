<script lang="ts">
  /** A terminal tab's mark: the program in front of its shell where that has one of its
   *  own - Claude Code, Codex, Node, Python, git, SSH, Docker, Vim - and the shell's own
   *  otherwise, as VS Code's terminal tabs wear. In FileMark's box at FileMark's weight,
   *  so it is a tab's mark like any other; see marks.ts and naming.ts.
   *
   *  What runs in the tab is its session's to know, and a tab put back after a restart
   *  that nobody has looked at yet runs nothing: it wears its shell's. A terminal on
   *  another machine wears a server in the colour Settings gave its host - the session's
   *  once it has one, the host list's before; see remote/hosts.ts. */

  import Icon from '../Icon.svelte'
  import { remote } from '../remote/hosts.svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import { TERMINAL_MARKS } from './marks'
  import { terminalMark } from './naming'
  import { hostIdOf, readSpec } from './spec'

  // What it reads of a tab, which the question before quitting also hands it for a tab
  // of another window; see lib/quitting.
  const { tab }: { tab: Pick<Tab, 'doc' | 'running'> } = $props()

  const shell = $derived(readSpec(tab.doc)?.shell ?? '')
  const mark = $derived(terminalMark(shell, tab.running?.program ?? null))
  const host = $derived(hostIdOf(shell))
  const colour = $derived(
    tab.running?.colour ?? (host === null ? null : (remote.byId(host)?.colour ?? null)),
  )

  $effect(() => {
    if (host !== null) void remote.ready()
  })
</script>

<span
  class="mark"
  class:is-coloured={colour !== null}
  style:--host={colour === null ? undefined : `var(--canvas-${colour})`}
  data-mark={mark}
  aria-hidden="true"
>
  <Icon icon={null} fallback={TERMINAL_MARKS[mark]} />
</span>

<style>
  /* FileMark's box and stroke, to the pixel, and its quiet: a stroke is held back. */
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
    opacity: 0.8;
  }

  /* A host's colour is the whole of what it says, so it is not held back. */
  .mark.is-coloured {
    color: var(--host);
    opacity: 1;
  }
</style>
