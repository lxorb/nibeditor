<script lang="ts">
  /** A field's rows (pickers.ts), floating under the control that asked: the app's own
   *  `.nib-layer` of `.nib-row`s, so it reads as every other menu. Its own component
   *  rather than the app's context menu, which carries the workspace with it and has no
   *  place in the global window.
   *
   *  The arrows walk it, Enter takes a row, Escape and a press outside put it away. */
  import { onMount, tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import { LAYER } from '../motion'
  import { DIVIDER, type MenuEntry, walkableRows } from '../menu-item'

  const {
    rows,
    at,
    onclose,
  }: {
    rows: MenuEntry[]
    /** Where the control that asked is, on the screen. */
    at: DOMRect
    onclose: () => void
  } = $props()

  const walkable = $derived(walkableRows(rows))
  let cursor = $state(0)
  let list = $state<HTMLElement>()

  onMount(() => {
    const checked = rows.findIndex((row) => row !== DIVIDER && row.checked === true)
    cursor = Math.max(walkable.indexOf(checked), 0)
    void tick().then(() => list?.focus())
  })

  function choose(row: MenuEntry) {
    if (row === DIVIDER || row.disabled) return
    onclose()
    row.run()
  }

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step) {
      event.preventDefault()
      cursor = (cursor + step + walkable.length) % Math.max(walkable.length, 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const row = rows[walkable[cursor] ?? -1]
      if (row !== undefined) choose(row)
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
    }
  }
</script>

<!-- A press anywhere else is the same answer as Escape. -->
<div class="catch" onpointerdown={onclose}></div>
<ul
  bind:this={list}
  class="nib-layer picker"
  role="menu"
  tabindex="-1"
  style:left="{at.left}px"
  style:top="{at.bottom + 4}px"
  {onkeydown}
  transition:fade={{ duration: LAYER.fade }}
>
  {#each rows as row, index (index)}
    {#if row === DIVIDER}
      <li class="rule" role="separator"></li>
    {:else}
      <li role="none">
        <button
          type="button"
          class="nib-row is-short"
          class:is-on={walkable[cursor] === index}
          role="menuitemradio"
          aria-checked={row.checked === true}
          tabindex="-1"
          disabled={row.disabled}
          onpointerenter={() => (cursor = Math.max(walkable.indexOf(index), 0))}
          onclick={() => choose(row)}
        >
          <span class="tick">{row.checked ? '✓' : ''}</span>
          <span class="nib-row-label">{row.label}</span>
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  /* A menu's rung, over the sheet it was opened from, and the catch the step under it. */
  .catch {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-menu) - 1);
  }

  .picker {
    position: fixed;
    z-index: var(--z-menu);
    min-width: 180px;
    max-height: 280px;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    list-style: none;
    outline: none;
  }

  .rule {
    height: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--line);
  }

  .tick {
    width: 1em;
    flex: none;
    color: var(--accent);
  }
</style>
