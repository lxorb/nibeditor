<script lang="ts">
  /** An extension's popup, in a bubble under its button.
   *
   *  The bubble is nib's and the page in it is the extension's: a webview of its own on
   *  `chrome-extension://<id>/<popup>`, built in the tab's store by the crate and placed
   *  over the bubble's inside; see src-tauri/src/extensions/popup.rs. It is on the overlay
   *  stack like every bubble under the bar, so the tab's page steps out of sight while it
   *  is open and its picture stands in - the popup's own webview is then the only page
   *  over the pane, and nothing of the app's is drawn under a page.
   *
   *  The bubble starts at the smallest size and grows to the size the page lays itself out
   *  at, which the crate measures; Escape, a press outside, the page closing itself and
   *  the tab going all close it. Every press inside it is the popup page's own, so the
   *  bubble itself lets the pointer through. */

  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { invoke } from '../tauri'
  import { extensions, type Popped } from './extensions.svelte'

  const {
    popped,
    /** Where the bubble hangs from, measured against the bar. */
    right,
  }: { popped: Popped; right: number } = $props()

  /** The size the page wants, once the crate has said. */
  let size = $state<{ width: number; height: number } | null>(null)
  let inside = $state<HTMLElement>()

  $effect(() => overlays.show(() => extensions.close()))

  /** Puts the popup's webview over the bubble's inside, as the window measures it. */
  function place() {
    const box = inside?.getBoundingClientRect()
    if (!box) return
    void invoke('extension_popup_place', {
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    })
  }

  onMount(() => {
    let gone = false
    let unlisten: (() => void) | null = null

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ kind: string; width?: number; height?: number }>(
          'nib://extension-popup',
          ({ payload }) => {
            if (payload.kind === 'closed') extensions.close()
            else if (payload.width && payload.height)
              size = { width: payload.width, height: payload.height }
          },
        ),
      )
      .then((stop) => {
        if (gone) stop()
        else unlisten = stop
      })
      .catch(() => undefined)

    const box = inside?.getBoundingClientRect()
    if (box) {
      void invoke('extension_popup_open', {
        id: popped.id,
        tab: popped.tab,
        store: popped.store ?? null,
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      }).catch(() => extensions.close())
    }

    // A press anywhere else closes it; a press inside the popup is the popup's own page,
    // which the window never hears.
    const pressed = (event: PointerEvent) => {
      if (inside && event.target instanceof Node && !inside.contains(event.target))
        extensions.close()
    }
    window.addEventListener('pointerdown', pressed, true)
    window.addEventListener('resize', place)

    return () => {
      gone = true
      unlisten?.()
      window.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('resize', place)
      void invoke('extension_popup_close').catch(() => undefined)
    }
  })

  // The page said how large it is: the bubble grows to it, and the page follows.
  $effect(() => {
    if (size) requestAnimationFrame(place)
  })
</script>

<div
  class="popup nib-bubble"
  class:sized={size !== null}
  style:right="{right}px"
  role="dialog"
  transition:fade={{ duration: dur(120) }}
>
  <div
    bind:this={inside}
    class="inside"
    style:width="{size?.width ?? 25}px"
    style:height="{size?.height ?? 25}px"
  ></div>
</div>

<style>
  /* Under the button it belongs to, the way Chrome hangs a popup from its toolbar. */
  .popup {
    position: absolute;
    top: 100%;
    z-index: var(--z-float);
    max-width: none;
    padding: 0;
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* Seen once the page has said its size, so the bubble never shows a box the page
     has not filled. */
  .popup.sized {
    opacity: 1;
  }

  .inside {
    max-width: 800px;
    max-height: 600px;
    background: var(--bg);
  }
</style>
