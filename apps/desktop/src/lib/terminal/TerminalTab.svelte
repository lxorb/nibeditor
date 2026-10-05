<script lang="ts">
  /** A terminal in a pane: the screen, and the find bar over it when it is up.
   *
   *  The screen is not this component's. It belongs to the tab and outlives this, which is
   *  taken apart the moment another tab is in front: what is here is the place it is
   *  drawn, handed over as this arrives and taken back as it goes. See
   *  sessions.svelte.ts.
   *
   *  The keyboard comes here when the tab comes to the front of the pane that has it. It
   *  comes back when whatever was put over it - the palette, a menu, a question - goes,
   *  and when the window does, from where the window keeps it; see keyboard-home.ts.
   *
   *  A terminal on another machine that is not connected - the connection dropped, or a
   *  restart put it back - has a quiet bar at its foot, Reconnect, which Enter is too;
   *  the lines it had stay readable above it. See `offline` in sessions.svelte.ts.
   *
   *  An online terminal draws its cached screen dimmed until its session's own arrives,
   *  and again while its socket is down; and after its machine's restart stopped an agent,
   *  the same quiet bar offers Resume. See docs/online-terminal.md 4.7 and 4.10. */

  import { onMount, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import FindBar from '../FindBar.svelte'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import type { Tab } from '../workspace.svelte'
  import { sessionOf } from './sessions.svelte'

  const { tab: shown, focused }: { tab: Tab; focused: boolean } = $props()

  /** The tab this pane is for, held from the moment it is built; see WebTab.svelte for
   *  why the prop is not read after that. */
  const tab = untrack(() => shown)
  const session = sessionOf(tab)

  let place = $state<HTMLElement>()

  onMount(() => {
    if (place)
      void session.attach(
        place,
        untrack(() => focused),
      )

    return () => session.detach()
  })

  // To the front of the pane that has the keyboard: the keyboard comes with it.
  $effect(() => {
    if (focused) untrack(() => session.focus())
  })
</script>

<div class="terminal" data-region="editor">
  {#if session.finding}
    <FindBar
      query={session.query}
      count={session.found.count}
      current={session.found.at}
      onstep={(by: number) => session.step(by)}
      onclose={() => session.closeFind()}
      onquery={(typed: string) => session.look(typed)}
    />
  {/if}

  <div class="place" class:is-waiting={!session.live} bind:this={place}></div>

  {#if session.offline}
    <div class="bar offline" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <button type="button" onclick={() => session.reconnect()}>{t('Reconnect')}</button>
    </div>
  {:else if session.resumable !== null}
    <div class="bar" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <button type="button" onclick={() => session.resume()}>{t('Resume')}</button>
    </div>
  {/if}
</div>

<style>
  /* The note's ground, edge to edge, so a terminal is a page of the window rather than a
     box inside one. */
  .terminal {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    /* See-through under a translucent theme, as far as the colours a program asks for
       still read: see `--terminal-ground` in glass.css and wallpaper.css. */
    background: var(--terminal-ground, var(--bg));
  }

  .place {
    position: relative;
    flex: 1;
    min-height: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  /* A screen that is not the session as it is now: the one cached from the last visit,
     or one whose socket has dropped. */
  .place.is-waiting {
    opacity: 0.55;
  }

  /* The screen's own element, made by the session rather than by this component, so
     reached through the scope. Inset by the room a note's first line has from the edge,
     and the scrollbar left at the very edge where a pointer finds it. */
  .place :global(.nib-terminal) {
    position: absolute;
    inset: var(--space-2) 0 0 var(--space-3);
  }

  .place :global(.xterm) {
    height: 100%;
  }

  /* xterm.js's own sheet paints the viewport black, under a screen whose ground is the
     pane's: see-through under glass and the wallpaper, the paper everywhere else. */
  .place :global(.xterm-viewport) {
    background-color: transparent;
  }

  /* Over the foot of the screen, out of the way of the lines above it: a floating
     layer's surface and hairline, and one button in it. */
  .bar {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    translate: -50% 0;
    display: flex;
    padding: var(--space-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .bar button {
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .bar button:hover {
      background: var(--surface-hover);
    }
  }

  .bar button:active {
    background: var(--surface-press);
  }
</style>
