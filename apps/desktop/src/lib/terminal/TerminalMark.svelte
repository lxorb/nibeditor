<script lang="ts">
  /** A terminal tab's mark: the program in front of its shell where that has one of its
   *  own - Claude Code, Codex, Node, Python, git, SSH, Docker, Vim - and the shell's own
   *  otherwise, as VS Code's terminal tabs wear. In FileMark's box at FileMark's weight,
   *  so it is a tab's mark like any other; see marks.ts and naming.ts.
   *
   *  What runs in the tab is its session's to know, and a tab put back after a restart
   *  that nobody has looked at yet runs nothing: it wears its shell's. */

  import Icon from '../Icon.svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import { TERMINAL_MARKS } from './marks'
  import { terminalMark } from './naming'
  import { readSpec } from './spec'

  const { tab }: { tab: Tab } = $props()

  const shell = $derived(readSpec(tab.doc)?.shell ?? '')
  const mark = $derived(terminalMark(shell, tab.running?.program ?? null))
</script>

<span class="mark" data-mark={mark} aria-hidden="true">
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
</style>
