<script lang="ts">
  /** A terminal tab's mark: the program in front of its shell where that has one of its
   *  own - Claude Code, Codex, Node, Python, git, SSH, Docker, Vim - and the shell's own
   *  otherwise, as VS Code's terminal tabs wear. In FileMark's box at FileMark's weight,
   *  so it is a tab's mark like any other; see marks.ts and naming.ts.
   *
   *  What runs in the tab is its session's to know, and a tab put back after a restart
   *  that nobody has looked at yet runs nothing: it wears its shell's. A terminal on
   *  another machine wears a server in the colour Settings gave its host - the session's
   *  once it has one, the host list's before; see remote/hosts.ts.
   *
   *  An online terminal wears the same marks with a small cloud in the corner, so it never
   *  reads as a local shell, and its machine's state as a dot over the other corner: none
   *  while awake, hollow while asleep, turning while it starts, amber near the month's
   *  hours. See docs/online-terminal.md 4.10. */

  import Icon from '../Icon.svelte'
  import { marks } from '../online/marks.svelte'
  import { isTermTarget } from '../online/path'
  import { remote } from '../remote/hosts.svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import { TERMINAL_MARKS } from './marks'
  import { terminalMark } from './naming'
  import { hostIdOf, readSpec } from './spec'

  // What it reads of a tab, which the question before quitting also hands it for a tab
  // of another window; see lib/quitting.
  const { tab }: { tab: Pick<Tab, 'doc' | 'running'> & { id?: string; path?: string | null } } =
    $props()

  const online = $derived(isTermTarget(tab.path ?? null))
  const shell = $derived(online ? '' : (readSpec(tab.doc)?.shell ?? ''))
  const mark = $derived(terminalMark(shell, tab.running?.program ?? null))
  const host = $derived(hostIdOf(shell))
  const colour = $derived(
    tab.running?.colour ?? (host === null ? null : (remote.byId(host)?.colour ?? null)),
  )
  const machine = $derived(online ? (marks.get(tab.id ?? '') ?? 'asleep') : null)

  $effect(() => {
    if (host !== null) void remote.ready()
  })
</script>

<span
  class="mark"
  class:is-coloured={colour !== null}
  class:is-online={online}
  style:--host={colour === null ? undefined : `var(--canvas-${colour})`}
  data-mark={mark}
  data-machine={machine}
  aria-hidden="true"
>
  <span class="drawn"><Icon icon={null} fallback={TERMINAL_MARKS[mark]} /></span>
  {#if online}
    <svg class="cloud" viewBox="0 0 24 24"
      ><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></svg
    >
    {#if machine !== 'awake'}<span class="state"></span>{/if}
  {/if}
</span>

<style>
  /* FileMark's box and stroke, to the pixel, and its quiet: a stroke is held back. */
  .mark {
    position: relative;
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
    opacity: 0.8;
  }

  .drawn {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* A host's colour is the whole of what it says, so it is not held back. */
  .mark.is-coloured {
    color: var(--host);
    opacity: 1;
  }

  /* The corner the cloud sits in is cut out of the program's mark, so the two never
     cross whatever is behind the tab. */
  .is-online .drawn {
    mask: radial-gradient(circle at 100% 100%, transparent 46%, #000 47%);
  }

  .cloud {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 58%;
    height: 58%;
    fill: none;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The machine's state over the other corner: hollow asleep, turning while it starts,
     amber near the month's hours, nothing at all while it is simply awake. */
  .state {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 5px;
    height: 5px;
    border: 1.2px solid currentColor;
    border-radius: 50%;
    box-sizing: border-box;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  [data-machine='starting'] .state,
  [data-machine='stopping'] .state {
    border-right-color: transparent;
    animation: turn 0.9s linear infinite;
  }

  [data-machine='near'] .state {
    border-color: var(--callout-warning);
    background: var(--callout-warning);
  }

  [data-machine='down'] .state {
    border-color: var(--danger);
  }

  @keyframes turn {
    to {
      rotate: 1turn;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-machine='starting'] .state,
    [data-machine='stopping'] .state {
      animation: none;
    }
  }
</style>
