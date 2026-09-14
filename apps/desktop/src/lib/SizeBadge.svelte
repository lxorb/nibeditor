<script lang="ts">
  /** What the text size has just become, said once and then gone.
   *
   *  A gesture that changes the size of every word on screen needs a number
   *  somewhere, or a reader who has pinched twice cannot tell how far from normal
   *  they are - and 100% is the one value worth naming, because it is the one to
   *  get back to. Said and not shown permanently: a badge that stayed would be a
   *  thing to close.
   *
   *  Watches the size rather than being told: the keys, the slider, the wheel and
   *  the menu rows all set the same value, so all four are answered by one
   *  effect. */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { modes } from './modes.svelte'

  /** How long it stays. Long enough to read a number, short enough that a reader
   *  stepping through sizes sees one badge rather than a queue of them. */
  const HELD = 900

  let shown = $state(false)
  let last = modes.zoom
  let timer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const size = modes.zoom
    if (size === last) return

    last = size
    shown = true

    clearTimeout(timer)
    timer = setTimeout(() => {
      shown = false
    }, HELD)

    return () => clearTimeout(timer)
  })

  const percent = $derived(Math.round(modes.zoom * 100))
</script>

<!-- Over the note, at the top, where nothing else in the app sits: the title bar
     is above it and the words start below it. `role="status"` so a reader who is
     listening is told the size changed, which is the same sentence the badge
     draws. -->
{#if shown}
  <div
    class="size nib-pill"
    role="status"
    in:scale={{ duration: dur(140), start: 0.94, easing: cubicOut }}
    out:fade={{ duration: dur(180) }}
  >
    {t('{percent}% text', { percent })}
  </div>
{/if}

<style>
  /* Where it sits. What it looks like is `.nib-pill` in the themes package, which
     is the same shape the page note's zoom wears; see base.css. */
  .size {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-4));
    left: 50%;
    translate: -50% 0;
    z-index: 30;
  }
</style>
