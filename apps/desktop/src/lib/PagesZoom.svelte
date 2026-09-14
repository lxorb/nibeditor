<script lang="ts">
  /** How far the paper is zoomed, said while it is being zoomed and then gone.
   *
   *  A page note's zoom is a gesture with no number in it: a pinch, Ctrl and the
   *  wheel, two keys. The bar carries the percentage, but the bar is at the bottom
   *  of the pane and a hand that is pinching the middle of a page is not looking
   *  there - so the number comes to the paper for as long as the zoom is happening,
   *  and goes. Exactly what the text size does after a pinch; it is the same shape
   *  in the same place, out of the themes package, because it is the same thing
   *  said about something else. See SizeBadge.svelte and `.nib-pill` in base.css.
   *
   *  Watches the scale rather than being told, so the wheel, the keys, the pinch,
   *  the bar's buttons and the menu rows are all answered by one effect. */

  import { onDestroy } from 'svelte'
  import { fade, scale as growing } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { dur } from './motion'

  const { zoom }: { zoom: number } = $props()

  /** How long it stays after the last change. Long enough to read, short enough
   *  that a reader stepping through zooms sees one badge rather than a queue. */
  const HELD = 600

  let shown = $state(false)
  /** The scale the badge last said. Not state: it is read and written inside the
   *  effect below, and state there is an effect that depends on what it writes. */
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const now = zoom
    // The zoom a page note opens at is not a zoom somebody asked for, so the badge
    // says nothing until the first change.
    if (!last) {
      last = now
      return
    }
    if (now === last) return

    last = now
    shown = true

    clearTimeout(timer)
    timer = setTimeout(() => {
      shown = false
    }, HELD)
  })

  /** The waiting hide dropped when the surface goes, and never before.
   *
   *  Deliberately not the effect's own cleanup. A cleanup runs before every re-run
   *  of the effect, not only on the way out, so a re-run for any other reason
   *  cleared the timer that hides the badge - and the effect then returned early
   *  because the zoom had not changed, leaving the number on the paper for good. */
  onDestroy(() => clearTimeout(timer))

  const percent = $derived(Math.round(zoom * 100))
</script>

<!-- Over the paper, at the top of the pane: clear of the bar at the bottom and of
     the words on the page. `role="status"` so a reader who is listening is told how
     far the paper is zoomed, which is the same sentence the badge draws. -->
{#if shown}
  <div
    class="zoom nib-pill"
    role="status"
    in:growing={{ duration: dur(120), start: 0.94, easing: cubicOut }}
    out:fade={{ duration: dur(180) }}
  >
    {percent}%
  </div>
{/if}

<style>
  /* Where it sits. What it looks like is `.nib-pill` in the themes package. */
  .zoom {
    position: absolute;
    top: var(--space-3);
    left: 50%;
    translate: -50% 0;
    z-index: 7;
  }
</style>
