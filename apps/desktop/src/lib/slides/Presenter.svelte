<script lang="ts">
  /** What the presenter reads while the audience reads the stage.
   *
   *  Its own window on its own screen, and its own page rather than the app
   *  again: nothing here opens a note, syncs anything or holds a workspace. It
   *  listens on the channel the stage talks over, draws the slide that is up, the
   *  one after it, the notes and a clock, and sends back which way to go so the
   *  deck can be moved from here. See slides/presenter.ts.
   *
   *  Nothing is labelled. The big frame is now, the small one is next, the prose
   *  is what to say, and the numbers are the numbers.
   */

  import { onDestroy } from 'svelte'
  import { fitSurface } from './fit'
  import { presenterChannel, type Stage } from './presenter'
  import { STAGE_HEIGHT, stageScale, STAGE_WIDTH } from './stage'

  let stage = $state<Stage | null>(null)
  let gone = $state(false)
  let elapsed = $state(0)

  let big = $state<HTMLElement>()
  let small = $state<HTMLElement>()
  let bigPage = $state<HTMLElement>()
  let smallPage = $state<HTMLElement>()

  const channel = presenterChannel((message) => {
    if (message.kind === 'stage') {
      stage = message.stage
      document.documentElement.dataset.theme = message.stage.scheme
      return
    }

    // The stage has left presenting, so this window has nothing left to show.
    // A window a script opened may close itself; one the app opened is closed
    // by the app.
    if (message.kind === 'gone') {
      gone = true
      window.close()
    }
  })

  // The deck is already up by the time this window opens, and nothing about it
  // is about to change, so it is asked where it has got to.
  channel.send({ kind: 'here' })

  onDestroy(() => channel.close())

  // The clock runs here off the moment the stage started, so nothing has to be
  // sent once a second.
  $effect(() => {
    const from = stage?.started
    if (from === undefined) return

    const tick = () => (elapsed = Math.max(0, Math.floor((Date.now() - from) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  })

  const clock = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`)

  /** Both frames are the stage at its own size, scaled down to the box they are
   *  in, so what is shown here is exactly what is on the other screen. */
  function scaleInto(box: HTMLElement | undefined) {
    if (!box) return

    box.style.setProperty('--stage-scale', String(stageScale(box.clientWidth, box.clientHeight)))
  }

  $effect(() => {
    const boxes = [big, small]
    for (const box of boxes) scaleInto(box)

    const watcher = new ResizeObserver(() => {
      for (const box of boxes) scaleInto(box)
    })
    for (const box of boxes) if (box) watcher.observe(box)
    return () => watcher.disconnect()
  })

  /** Sized by the same ladder the stage uses, so a slide shrunk to fit over
   *  there is shrunk by the same rung here; see slides/fit.ts. */
  function fitBoth() {
    if (bigPage) fitSurface(bigPage)
    if (smallPage) fitSurface(smallPage)
  }

  $effect(() => {
    // Read, not used: a new slide is what this waits for.
    const reasons = [stage?.slide, stage?.next]
    if (!reasons.length) return

    fitBoth()
    // A maths font arriving changes how tall a slide is, and this window opens
    // with its own stylesheet still loading.
    void document.fonts.ready.then(fitBoth)
  })

  function move(by: number) {
    channel.send({ kind: 'move', by })
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        event.preventDefault()
        move(1)
        return
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault()
        move(-1)
        return
      default:
        return
    }
  }

  const style = `--stage-width: ${STAGE_WIDTH}px; --stage-height: ${STAGE_HEIGHT}px`
</script>

<svelte:window onkeydown={onKeydown} />

{#if stage && !gone}
  <div class="presenter" {style}>
    <div class="screens">
      <div class="frame deck-frame now" bind:this={big}>
        <div class="stage">
          <div class="slide" data-shape={stage.shape}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- the slide the stage sent, already rendered by it -->
            <div class="nib-write" bind:this={bigPage}>{@html stage.slide}</div>
          </div>
        </div>
      </div>

      <div class="frame deck-frame then" bind:this={small}>
        <div class="stage">
          <div class="slide" data-shape={stage.nextShape}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- the next slide, from the same place -->
            <div class="nib-write" bind:this={smallPage}>{@html stage.next}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="aside">
      <div class="bar">
        <span class="clock">{clock}</span>
        <span class="at">{stage.at}/{stage.count}</span>
      </div>
      <div class="notes">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, the part only this window shows -->
        {@html stage.notes}
      </div>
    </div>
  </div>
{/if}

<style>
  .presenter {
    display: grid;
    grid-template-columns: 1fr minmax(240px, 32%);
    gap: var(--space-4);
    height: 100dvh;
    padding: var(--space-4);
    box-sizing: border-box;
    background: var(--bg);
  }

  .screens {
    display: grid;
    /* The slide that is up, and under it a smaller one that is next. */
    grid-template-rows: 2fr 1fr;
    gap: var(--space-4);
    min-width: 0;
    min-height: 0;
  }

  /* Each frame holds a stage of the real size, shrunk to fit: what is here is
     what is on the other screen, not a second layout of it. */
  /* The stage pins itself to the middle of this; see slides.css. */
  .frame {
    position: relative;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .frame.then {
    opacity: 0.62;
  }

  .aside {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--font-ui);
    font-variant-numeric: tabular-nums;
  }

  .clock {
    font-size: 1.9rem;
    color: var(--text-strong);
    letter-spacing: -0.02em;
  }

  .at {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .notes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-family: var(--font-content);
    /* Read at a glance from a lectern, not at a desk. */
    font-size: 1.1rem;
    line-height: 1.6;
    color: var(--text);
  }

  .notes :global(> :first-child) {
    margin-top: 0;
  }

  .notes :global(> :last-child) {
    margin-bottom: 0;
  }
</style>
