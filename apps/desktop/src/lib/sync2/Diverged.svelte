<script lang="ts">
  /** The one question sync v2 asks: two devices rewrote the same passage of a note
   *  while apart, so which stands? (docs/sync-v2.md section 4, "The divergence modal".)
   *
   *  The note's name, then the two versions side by side as cards - this device's at
   *  the start, headed by the device and the time it last wrote there, with the words
   *  that differ in the highlight ink a `==highlight==` wears - and three answers:
   *  Keep on either card, Keep both under them. Nothing else is said, because the two
   *  passages are the whole of what there is to decide. Whatever does not stand is a
   *  version in the history, so no answer loses words.
   *
   *  The shared sheet, so it rises, closes and holds the keyboard the way the Share
   *  and Publish sheets do; Escape, the scrim, the cross and back close it and change
   *  nothing. Where the keyboard lands is the newer version's Keep, Left and Right go
   *  between the two, and Enter keeps the one it is on.
   *
   *  When it comes up is not this component's: see asking.svelte.ts. */
  import { tick } from 'svelte'
  import { steppedKey } from '../direction'
  import { t } from '../i18n.svelte'
  import Sheet from '../Sheet.svelte'
  import { withinSpace } from '../space-paths'
  import { readableSize } from '../usage.svelte'
  import { when } from '../when'
  import { workspace } from '../workspace.svelte'
  import { asking, type Held, type HeldAnswer, type Side } from './asking.svelte'
  import { runsOf } from './runs'

  /** How long after the sheet came up a key is taken for one that was meant for the
   *  note. The typing has paused before it asks (see `QUIET`), but a hand that starts
   *  again the moment it appears must not have its Enter taken for an answer. */
  const ARMING = 400

  /** The note being asked about, and the last one while the sheet is on its way out,
   *  so it leaves with its cards rather than as an empty frame. */
  let last: Held | null = null
  const shown = $derived.by(() => {
    const now = asking.asked
    if (now) last = now
    return now ?? last
  })

  /** The version the keyboard lands on: the one written last. */
  const newer = $derived<HeldAnswer>(shown && shown.mine.at >= shown.theirs.at ? 'mine' : 'theirs')

  let since = 0
  $effect(() => {
    if (asking.asked) since = performance.now()
  })

  /** A press of Keep or Keep both. A click the keyboard made (`detail` 0) in the
   *  first moment is dropped; one a pointer made never is, because aiming at a button
   *  is not an accident. */
  function keep(event: MouseEvent, answer: HeldAnswer) {
    if (!shown) return
    if (event.detail === 0 && performance.now() - since < ARMING) return
    void asking.answer(shown, answer)
  }

  /** Left and Right between the two cards, in reading order: in a language that reads
   *  the other way the first card is on the right, and so is the key towards it. */
  function stepping(node: HTMLElement) {
    const step = (event: KeyboardEvent) => {
      const key = steppedKey(event.key)
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
      const keeps = [...node.querySelectorAll<HTMLButtonElement>('.keep')]
      const next = keeps[key === 'ArrowRight' ? 1 : 0]
      if (!next) return
      event.preventDefault()
      next.focus()
    }
    node.addEventListener('keydown', step)
    return { destroy: () => node.removeEventListener('keydown', step) }
  }

  /** A canvas's or a page note's contested cards, drawn as the canvas's own picture
   *  draws them (`canvasSvg`, in its plain reading, as an embed in a note is). Both
   *  halves are fetched with the first plane asked about. */
  function planeOf(node: HTMLElement, text: string) {
    void (async () => {
      const path = shown?.path ?? null
      const space = path
        ? workspace.spaces.find((one) => withinSpace(one.root, path) !== null)
        : null
      const [{ drawingOf }, { canvasSvg }] = await Promise.all([
        import('../export/drawing'),
        import('../canvas/picture'),
      ])
      const drawing = drawingOf({
        text,
        name: shown?.name ?? '',
        path: space && path ? withinSpace(space.root, path) : null,
        root: space?.root ?? null,
      })
      await tick()
      // A sheet that closed while the picture was on its way has nowhere to put it.
      if (!node.isConnected) return
      // Every value a note wrote is escaped in the plain reading, and it holds no HTML.
      node.innerHTML = canvasSvg(drawing.canvas, drawing.palette, drawing.path, drawing.root, true)
      const picture = node.firstElementChild
      picture?.removeAttribute('width')
      picture?.removeAttribute('height')
    })()
  }
</script>

<Sheet
  open={asking.asked !== null}
  title={shown?.name ?? ''}
  width="46rem"
  onclose={() => asking.dismiss()}
>
  {#if shown}
    <div class="sides" use:stepping>
      {@render card(shown.mine, 'mine')}
      {@render card(shown.theirs, 'theirs')}
    </div>
    {#if asking.wrong}<p class="wrong">{asking.wrong}</p>{/if}
  {/if}

  {#snippet foot()}
    <button
      class="nib-button is-quiet both"
      class:is-pressing={asking.answering === 'both'}
      aria-busy={asking.answering === 'both'}
      disabled={asking.answering !== null && asking.answering !== 'both'}
      onclick={(event) => keep(event, 'both')}
    >
      {t('Keep both')}
    </button>
  {/snippet}
</Sheet>

{#snippet card(side: Side, whose: HeldAnswer)}
  {@const head = `diverged-${whose}`}
  <section class="card side" aria-labelledby={head}>
    <header id={head}>
      <span class="device">
        {whose === 'mine' ? t('This {device}', { device: side.device }) : side.device}
      </span>
      <time datetime={new Date(side.at).toISOString()}>{when(side.at, 'short')}</time>
    </header>

    {#if side.plane !== undefined}
      <div class="plane" use:planeOf={side.plane}></div>
    {:else if side.file}
      <div class="file">
        {#if side.file.picture}
          <img src={side.file.picture} alt="" draggable="false" />
        {/if}
        <span class="called">{side.file.name}</span>
        <span class="size">{readableSize(side.file.size)}</span>
      </div>
    {:else}
      <!-- Its own direction, as a note's block is: the words are the note's, not the
           interface's. -->
      <p class="excerpt" dir="auto">
        {#each runsOf(side.excerpt) as run, at (at)}{#if run.marked}<mark>{run.text}</mark
            >{:else}{run.text}{/if}{/each}
      </p>
    {/if}

    <button
      class="nib-button keep"
      class:is-pressing={asking.answering === whose}
      aria-busy={asking.answering === whose}
      aria-describedby={head}
      disabled={asking.answering !== null && asking.answering !== whose}
      data-lands={whose === newer ? '' : undefined}
      onclick={(event) => keep(event, whose)}
    >
      {t('Keep')}
    </button>
  </section>
{/snippet}

<style>
  /* Side by side while two fit, one over the other where they do not: a phone, or a
     window narrower than two passages. */
  .sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--space-3);
  }

  /* `.card` is the sheet's own filled surface; see Sheet.svelte. Its padding is a
     step wider here, and said through the list so it outweighs the sheet's. */
  .sides > .side {
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3);
  }

  /* Whose, then when: the device is what tells the two apart. */
  header {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .device {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    unicode-bidi: isolate;
  }

  time {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* The passage as the note reads, in the note's own face, and a passage long enough
     to need it scrolls inside its card rather than stretching the sheet. */
  .excerpt {
    flex: 1;
    min-height: 3lh;
    max-height: 14rem;
    margin: 0;
    overflow-y: auto;
    font-family: var(--font-content);
    font-size: var(--text-base);
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* The highlight ink, as `==highlight==` draws it in a note; see base.css. Its room
     is taken back on either side, so a marked word sits where the plain one would
     and a comma after it is not pushed off. */
  mark {
    margin: 0 -0.18em;
    padding: 0.1em 0.18em;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--text-strong);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  /* The contested cards, the width of the card and no taller than a passage. */
  .plane {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 6rem;
    max-height: 14rem;
    overflow: hidden;
    border-radius: var(--radius-row);
  }

  .plane :global(svg) {
    display: block;
    max-width: 100%;
    max-height: 14rem;
  }

  .file {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text);
  }

  .file img {
    max-width: 100%;
    max-height: 10rem;
    object-fit: contain;
    border-radius: var(--radius-row);
  }

  /* Not `.name`, which the sheet dresses as a row's two lines; see Sheet.svelte. */
  .file .called {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file .size {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .keep {
    align-self: flex-end;
  }

  /* Keep both is the quieter of the three, under both cards rather than beside one. */
  .both {
    margin-inline: auto;
  }

  /* The answer being carried out looks pressed until it has been, the way a button
     under a finger does; see `.nib-button:active` in base.css. */
  .keep.is-pressing {
    background: var(--accent-press);
    transform: none;
  }

  .both.is-pressing {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  /* A thumb's answer is as wide as the card it is in. */
  :global([data-touch]) .keep {
    align-self: stretch;
  }

  /* A step up under a thumb, and still a step under the sheet's own title. */
  :global([data-touch]) header {
    font-size: var(--text-base);
  }
</style>
