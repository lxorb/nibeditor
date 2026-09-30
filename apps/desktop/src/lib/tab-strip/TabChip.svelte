<script lang="ts">
  /** A tab carried out over the panes: the tab itself, lifted off its strip and held
   *  where it was grabbed. At the end of the page, so nothing clips it and nothing is
   *  drawn over it. Only ever on screen during a drag, so it is fetched with the first
   *  press on a tab rather than carried into the first paint; see Tabs.svelte. */

  import TabMark from '../TabMark.svelte'
  import type { Tab } from '../workspace.svelte'

  const { tab, left, top, width }: { tab: Tab; left: number; top: number; width: number } = $props()

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }
</script>

<div
  class="chip"
  class:onbar={tab.kind === 'web'}
  use:portal
  style:width="{width}px"
  style:transform="translate({left}px, {top}px)"
  aria-hidden="true"
>
  <TabMark {tab} />
  {#if !tab.pinned}<span class="label">{tab.shown}</span>{/if}
</div>

<style>
  /* Its body, lifted - rounded all round, since it is off the bar it would have
     flared into, with the small shadow of a thing held just above the page. */
  .chip {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-carried);
    height: calc(var(--titlebar-height) - var(--tab-top, 5px));
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
    pointer-events: none;
    will-change: transform;
  }

  .chip.onbar {
    background: var(--surface);
  }

  /* The name fades out at its end as it does on the tab, Chrome's FADE_TAIL. */
  .label {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    unicode-bidi: isolate;
    --fade: min(24px, 33%);
    mask-image: linear-gradient(to right, #000 calc(100% - var(--fade)), transparent);
  }

  :global(:root[dir='rtl']) .label {
    mask-image: linear-gradient(to left, #000 calc(100% - var(--fade)), transparent);
  }
</style>
