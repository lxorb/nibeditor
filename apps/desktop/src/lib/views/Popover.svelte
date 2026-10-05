<script lang="ts">
  /** A small layer under a button of a view's head: the filter, the sort, the group.
   *  `.nib-layer`, rising the way every layer of the app rises (motion.ts), closed by
   *  Escape, by a press outside it, and on a phone by back. */
  import type { Snippet } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../backstack.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'

  const {
    open,
    onclose,
    label,
    children,
    start = false,
  }: {
    open: boolean
    onclose: () => void
    label: string
    children: Snippet
    /** Hung from the start of what opened it rather than its end. */
    start?: boolean
  } = $props()

  let layer = $state<HTMLElement>()

  $effect(() => closeOnBack(open, onclose))
  $effect(() => (open ? overlays.show(onclose) : undefined))
  $effect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || layer?.contains(target)) return
      // A press on what opened it is that button's own: it closes it by itself.
      if (target instanceof Element && target.closest('[data-opens-popover]')) return
      // A menu or a list a control in here dropped is part of what is being chosen.
      if (target instanceof Element && target.closest('.nib-layer, [role=listbox], [role=menu]'))
        return
      onclose()
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  })
</script>

{#if open}
  <div
    class="pop nib-layer"
    class:start
    bind:this={layer}
    role="dialog"
    aria-label={label}
    tabindex="-1"
    transition:fly={{ y: 6, duration: LAYER.rise, easing: cubicOut }}
    onkeydown={(event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onclose()
    }}
  >
    {@render children()}
  </div>
{/if}

<style>
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline-end: 0;
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(440px, calc(100vw - 32px));
    max-height: min(60vh, 520px);
    padding: var(--space-3);
    overflow-y: auto;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .pop.start {
    inset-inline-end: auto;
    inset-inline-start: 0;
  }
</style>
