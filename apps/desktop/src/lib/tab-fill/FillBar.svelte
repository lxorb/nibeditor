<script lang="ts">
  /** What a window a tab fills keeps of its chrome: the window's own bar, out of sight
   *  until the pointer reaches the top edge, and then down over the top of the tab.
   *
   *  The way Edge brings its bar back in full screen, the way a Mac brings its menu bar
   *  back and Arc its sidebar: over what fills rather than pushing it, so nothing is
   *  resized by a pointer passing by - a web page least of all, which is a native webview
   *  the crate would have to place again. The bar is the whole of it, whole: the menu,
   *  the pane's tabs, the stretch the window is dragged by and its three buttons. So the
   *  window can always be moved and closed, which is where Windows Terminal's focus mode
   *  leaves people stuck ("Dragging the windows around is not really possible in focus
   *  mode", microsoft/terminal#20573). A strip kept for good was the other choice, and it
   *  would have held nothing: the window's buttons do not fit in a strip thin enough to
   *  be worth keeping.
   *
   *  It stays down while anything holds it - the pointer, the keyboard, a menu opened
   *  from it - and slides back up a moment after nothing does.
   *
   *  Mounted for exactly as long as a tab fills the window, which makes it the place the
   *  fill's own ends are kept: the pane stops being the one worked in or shows nothing,
   *  Escape where nothing else wants it, and the chrome coming back however it ended. See
   *  rules.ts and fill.ts. */

  import { onDestroy, type Snippet, tick, untrack } from 'svelte'
  import { focusEditor } from '../focus'
  import { overlays } from '../overlays'
  import { workspace } from '../workspace.svelte'
  import { chromeComes } from './chrome'
  import { unfill } from './fill'
  import { atEdge, escapeLeaves, mayHide, stillFills } from './rules'

  const { children }: { children: Snippet } = $props()

  /** How long the pointer rests at the top edge before the bar comes: long enough that a
   *  pointer on its way past the top of the window, to a screen above or the taskbar of
   *  one, brings nothing down. */
  const COMES_AFTER = 120

  /** How long the bar stays once nothing holds it: long enough to cross a gap to a menu it
   *  opened, or to come back to it from a pointer that overshot. */
  const GOES_AFTER = 500

  /** Whether the bar is down over the tab. */
  let shown = $state(false)
  /** What holds it down, besides a menu it opened. Plain fields: nothing is drawn from
   *  them, they are asked when the bar would go. */
  let pointer = false
  let keyboard = false
  /** The bar, which the pointer is measured against. */
  let bar = $state<HTMLElement>()

  let coming: ReturnType<typeof setTimeout> | undefined
  let going: ReturnType<typeof setTimeout> | undefined

  /** A Mac keeps its three lights at the top left of the window, over whatever is there,
   *  and they are the system's to show. So there the row they sit in is kept, and is what
   *  the window is dragged by; see Titlebar.svelte, which says it on the root. */
  const lights = document.documentElement.hasAttribute('data-lights')

  /** Where the pointer is, from every move over the window. Measured rather than heard
   *  from the bar's own enter and leave, because the bar arrives under a pointer that has
   *  stopped, and a browser says nothing about an element that came to the pointer. */
  function moved(y: number) {
    if (shown) {
      pointer = y >= 0 && y < (bar?.getBoundingClientRect().bottom ?? 0)
      if (pointer) hold()
      else letGo()
      return
    }

    if (!atEdge(y)) {
      clearTimeout(coming)
      coming = undefined
      return
    }
    coming ??= setTimeout(() => {
      coming = undefined
      shown = true
      pointer = true
    }, COMES_AFTER)
  }

  /** The bar goes, a moment after the last thing holding it has let go. Counted from the
   *  first moment nothing held it, not from the last move: a pointer moving about the
   *  page below has let go however long it keeps moving. */
  function letGo() {
    going ??= setTimeout(() => {
      going = undefined
      if (mayHide({ pointer, keyboard, layers: overlays.depth })) shown = false
    }, GOES_AFTER)
  }

  function hold() {
    clearTimeout(going)
    going = undefined
  }

  /** Escape, where nothing on the page wanted it: after every layer has had its turn
   *  (overlays.ts, in App.svelte's own handler, which runs first) and only while the
   *  keyboard is in no document and no field; see `escapeLeaves`. Decided once the
   *  press has been everywhere it goes, because a surface that reads it off the window
   *  too - the graph, a PDF - may be told of it after this: one it spent is not this
   *  one's as well. */
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return

    const holder = document.activeElement
    queueMicrotask(() => {
      if (!event.defaultPrevented && escapeLeaves(holder)) unfill()
    })
  }

  // The fill ends by itself when its pane is no longer the one worked in, or shows
  // nothing; see `stillFills`. Decided from what is read here and written through
  // `unfill`, which reads nothing, so the effect cannot run away with itself.
  $effect(() => {
    const panes = workspace.panes
    const holds = stillFills({
      fills: panes.fills,
      focusedId: panes.focusedId,
      showing: panes.focused.activeTabId,
    })
    if (!holds) untrack(unfill)
  })

  // A menu opened from the bar closing is the last thing letting go of it, when the
  // pointer went somewhere else meanwhile.
  $effect(() =>
    overlays.watch(() => {
      if (shown && overlays.depth === 0) letGo()
    }),
  )

  // However the fill ended, the chrome comes back from its edges once it is on the page;
  // and a keyboard that was in the bar, which has gone, goes to the document.
  onDestroy(() => {
    clearTimeout(coming)
    clearTimeout(going)
    const stranded = keyboard
    void tick().then(() => {
      chromeComes()
      if (stranded) focusEditor()
    })
  })
</script>

<svelte:window
  onpointermove={(event: PointerEvent) => moved(event.clientY)}
  onkeydown={onKeydown}
/>

{#if lights}
  <div class="lights" data-tauri-drag-region></div>
{/if}

<!-- Inert while it is up out of sight: nothing in it can be reached by a key it cannot
     be seen taking. The pointer only holds it; what is pressed is the bar inside. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bar"
  class:shown
  inert={!shown}
  bind:this={bar}
  onpointerleave={() => {
    // Off the window altogether, or onto a web page, which is a window of its own that
    // the page is told nothing about.
    pointer = false
    letGo()
  }}
  onfocusin={() => {
    keyboard = true
    hold()
  }}
  onfocusout={() => {
    keyboard = false
    letGo()
  }}
>
  {@render children()}
</div>

<style>
  /* Over the top of what fills, and above everything it draws over itself: the canvas's
     tools, a pane's own bars. Under every layer, which a menu opened from it is. */
  .bar {
    position: absolute;
    inset: 0 0 auto;
    z-index: var(--z-float);
    transform: translateY(-100%);
    visibility: hidden;
    transition:
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      visibility 0s linear var(--dur-fast);
  }

  .bar.shown {
    transform: none;
    visibility: visible;
    box-shadow: var(--shadow-md);
    transition:
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  /* The lights' own row, and nothing else in it. */
  .lights {
    flex: none;
    height: var(--titlebar-height);
  }
</style>
