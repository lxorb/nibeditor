<script lang="ts">
  /** The pages of the note in front, as thumbnails, in the outline panel.
   *
   *  In the outline's place rather than in a panel of its own, because it is the
   *  same thing: the shape of what is open, and a row that goes to a part of it. A
   *  note has headings, a page note has pages, and the panel shows whichever the
   *  thing in front has.
   *
   *  A thumbnail is the page drawn small: the ruling, the PDF page behind it where
   *  there is one, and the ink on it. Drawn with the same `paintInk` the surface
   *  paints with - one ink engine, one picture of a stroke - at the scale the
   *  thumbnail is, so what the panel shows is what the page says and not a cartoon
   *  of it.
   *
   *  Redrawn when the pages change and not while somebody is drawing on one. A page
   *  of five thousand strokes takes a sixth of a second to rasterise, and the panel
   *  is not what the hand is looking at; the surface's own layer is. So this waits
   *  for the drawing to stop, the way the file does.
   *
   *  Reordering is a drag, the way moving a section in the outline is. Dropping a
   *  page between two others moves the page and everything written on it. */

  import { added, moved, removed, reshaped } from '@nib/markdown/pages'
  import type { Canvas } from './canvas/format'
  import { PATTERNS, type PageNode, type Pattern } from './canvas/format'
  import { paintInk } from './canvas/paint'
  import { readPalette } from './canvas/palette'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import { paperOf } from './pages/paper'
  import { pages as showing } from './pages/showing.svelte'
  import { workspace } from './workspace.svelte'

  /** How wide a thumbnail is, in pixels. Narrow enough that a panel holds six or
   *  seven of them and wide enough that a page of handwriting is recognisable as the
   *  page it is. */
  const WIDE = 104

  /** How long after the last change the thumbnails are drawn again. The same pause
   *  the file waits, so a page being written on is rasterised once when the hand
   *  stops rather than on every stroke. */
  const SETTLE = 600

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  const store = $derived(showing.current?.store ?? null)
  const pages = $derived(store?.pages ?? [])
  /** The space the note is in, which is the other place a page's `file` can point. */
  const spaceRoot = $derived(workspace.activeSpace?.root ?? null)
  /** Which page is being looked at, read off the store the way the status bar reads it. */
  const on = $derived(store?.showing ?? 0)

  /** Which page a drag is over, and whether it would land above it. */
  let over = $state<number | null>(null)
  let above = $state(true)

  let host = $state<HTMLElement>()
  let palette = $state<Record<string, string>>({})

  $effect(() => {
    const element = host
    if (element) palette = readPalette(element)
  })

  /** The canvas element each thumbnail is drawn on, by the page's id. Bound as the rows
   *  are made, so a page taken away takes its element with it.
   *
   *  Deliberately not state. The drawing below reads it, and `bind:this` writes it on
   *  every render: state here is an effect that reads and writes the same value, which
   *  is a loop the framework stops by throwing. Nothing renders from it - it is a
   *  handful of elements to paint on - so what redraws the thumbnails is the canvas
   *  changing, and by the time the pause is over every row is mounted. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- painted into, never rendered from; see above
  const sheets = new Map<string, HTMLCanvasElement>()

  function keep(id: string, element: HTMLCanvasElement | undefined) {
    if (element) sheets.set(id, element)
    else sheets.delete(id)
  }

  /** One thumbnail, drawn: the sheet, the PDF page behind it, then the ink. */
  async function draw(page: PageNode, element: HTMLCanvasElement) {
    const canvas = store?.canvas
    if (!canvas) return

    const scale = WIDE / page.width
    const tall = page.height * scale
    const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    element.width = Math.max(1, Math.round(WIDE * ratio))
    element.height = Math.max(1, Math.round(tall * ratio))

    const ctx = element.getContext('2d')
    if (!ctx) return

    // The camera the painter wants names the middle of the view, so the middle of
    // this page is where it points; see camera.ts.
    const view = {
      camera: { x: page.x + page.width / 2, y: page.y + page.height / 2, scale },
      width: WIDE,
      height: tall,
      ratio,
    }

    // The same paper the sheet in the pane draws, asked for the same way: the page's
    // `file` is relative to the note, and the store is what knows which note that is.
    const paper =
      page.file && page.page
        ? await paperOf({ file: page.file, note: store.path, root: spaceRoot }, page.page)
        : null

    // The ink through the same painter the surface uses, pointed at this page: one
    // description of what a stroke looks like, here as well. Onto a layer of its own
    // when there is a paper under it, because the painter wipes what it is given -
    // the surface's own ink layer is a layer of its own for the same reason.
    const inked = paper ? document.createElement('canvas') : element
    if (paper) {
      inked.width = element.width
      inked.height = element.height
    }

    const into = paper ? inked.getContext('2d') : ctx
    if (into) paintInk(into, canvas.ink, view, palette)

    if (!paper) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, element.width, element.height)
    ctx.drawImage(paper.image, 0, 0, element.width, element.height)
    ctx.drawImage(inked, 0, 0)
  }

  /** The pages drawn again once the changes have stopped. Watched through the
   *  canvas, which is replaced whole by every edit, so this fires once per edit and
   *  not once per stroke of a rub. */
  let timer = 0
  $effect(() => {
    follows(store?.canvas)
    follows(palette)

    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      for (const page of pages) {
        const element = sheets.get(page.id)
        if (element) void draw(page, element)
      }
    }, SETTLE)

    return () => window.clearTimeout(timer)
  })

  function edit(next: Canvas) {
    store?.edit(next)
  }

  function add(after: string | null) {
    const held = store
    if (!held) return

    const { canvas: next, id } = added(held.canvas, after)
    held.edit(next)
    // To the page that was just made, which is where somebody who added one is
    // about to write.
    const at = next.nodes.filter((node) => node.type === 'page').findIndex((one) => one.id === id)
    if (at >= 0) held.turnTo(at + 1)
  }

  /** What each ruling is called. Words rather than an app's name, so they are asked
   *  for in whatever language the app is in. */
  const WORDS: Record<Pattern, string> = {
    blank: 'Blank',
    lines: 'Lines',
    grid: 'Grid',
    dots: 'Dots',
  }

  /** What the menu on a page offers: the two things somebody does to a page, and the
   *  four rulings, with the one it wears already disabled - there is no tick in this
   *  menu, and a row that would do nothing says so the way every other one does. */
  function pageMenu(page: PageNode): MenuEntry[] {
    return [
      { label: t('Add a page after this'), run: () => add(page.id) },
      {
        label: t('Delete this page'),
        danger: true,
        disabled: pages.length < 2,
        run: () => {
          const canvas = store?.canvas
          if (canvas) edit(removed(canvas, page.id))
        },
      },
      DIVIDER,
      ...PATTERNS.map((pattern) => ({
        label: t(WORDS[pattern]),
        disabled: page.pattern === pattern,
        run: () => {
          const canvas = store?.canvas
          if (canvas) edit(reshaped(canvas, page.id, { pattern }))
        },
      })),
    ]
  }

  function start(event: DragEvent, at: number) {
    event.dataTransfer?.setData('application/nib-page', String(at))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function overPage(event: DragEvent, at: number) {
    if (!event.dataTransfer?.types.includes('application/nib-page')) return

    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    over = at
    above = event.clientY < box.top + box.height / 2
  }

  function drop(event: DragEvent, at: number) {
    const said = event.dataTransfer?.getData('application/nib-page')
    over = null
    if (said === undefined || said === '') return

    event.preventDefault()
    const from = Number(said)
    const page = pages[from]
    const canvas = store?.canvas
    if (!page || !canvas || Number.isNaN(from)) return

    // Where it lands, counted in pages after the one being moved has been taken out,
    // which is what `moved` expects.
    const to = above ? at : at + 1
    edit(moved(canvas, page.id, to > from ? to - 1 : to))
  }
</script>

{#if store}
  <div class="navigator" bind:this={host}>
    <ul>
      {#each pages as page, at (page.id)}
        <li>
          <button
            class="page"
            class:is-on={at + 1 === on}
            class:above={over === at && above}
            class:below={over === at && !above}
            draggable="true"
            aria-label={t('Page {number}', { number: at + 1 })}
            aria-current={at + 1 === on ? 'true' : undefined}
            onclick={() => store.turnTo(at + 1)}
            oncontextmenu={(event) =>
              menu.show(event, pageMenu(page), { title: t('Page {number}', { number: at + 1 }) })}
            use:longPress={(event) =>
              menu.show(event, pageMenu(page), { title: t('Page {number}', { number: at + 1 }) })}
            ondragstart={(event) => start(event, at)}
            ondragover={(event) => overPage(event, at)}
            ondragleave={() => (over = null)}
            ondragend={() => (over = null)}
            ondrop={(event) => drop(event, at)}
          >
            <!-- The sheet, drawn small. `aria-hidden`, because what the row is is
                 said by its label: a picture of handwriting reads out as nothing. -->
            <canvas
              aria-hidden="true"
              style:aspect-ratio="{page.width} / {page.height}"
              bind:this={
                () => sheets.get(page.id),
                (element: HTMLCanvasElement | undefined) => keep(page.id, element)
              }
            ></canvas>
            <span class="number">{at + 1}</span>
          </button>
        </li>
      {/each}
    </ul>

    <button class="add" onclick={() => add(null)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {t('Add a page')}
    </button>
  </div>
{/if}

<style>
  .navigator {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .navigator ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* A thumbnail is the row: the whole sheet is the target, which is what a finger
     wants, and the number sits in its corner the way it does on the page itself. */
  .page {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }

  .page canvas {
    display: block;
    width: 100%;
    border-radius: inherit;
  }

  .page .number {
    position: absolute;
    inset-inline-end: 3px;
    bottom: 2px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1;
  }

  /* The page being looked at, in the accent: the same way the outline marks the
     heading somebody is under. */
  .page.is-on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  @media (hover: hover) {
    .page:hover {
      border-color: var(--line-strong);
    }
  }

  /* Where a dragged page would land, as a line above or below the row it is over,
     which is the same mark the file list and the outline use. */
  .page.above::before,
  .page.below::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
  }

  .page.above::before {
    top: -3px;
  }

  .page.below::after {
    bottom: -3px;
  }

  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px dashed var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    cursor: pointer;
  }

  .add svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>
