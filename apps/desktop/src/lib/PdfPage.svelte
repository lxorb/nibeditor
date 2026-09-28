<script lang="ts">
  /** One page of a PDF: the picture of it, the words over it, and the marks
   *  under them.
   *
   *  A component per page rather than one that draws them all, because a page is
   *  what comes and goes: only the pages near the viewport exist at all, and a
   *  page that scrolls away takes its canvas, its words and its render with it.
   *  That is what keeps a document of three hundred pages costing the same as one
   *  of three.
   *
   *  Three layers, bottom to top: the canvas, the highlights, the words. The words
   *  are on top so a selection can be made anywhere on the page, and a click on a
   *  highlight is found by geometry rather than by hit testing an element - see
   *  `pick` below. */

  import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
  import {
    boxOf,
    COLOURS,
    type Highlight,
    matrixOf,
    toViewport,
    type Transform,
  } from './pdf/highlights'
  import { t } from './i18n.svelte'
  import { PDF_TO_CSS, type PageBox, sheetFor, type Size } from './pdf/pages'
  import { pdfjs } from './pdf/document'

  const {
    doc,
    number,
    count,
    box,
    zoom,
    marks,
    selected,
    onmeasure,
    onwords,
    onforget,
    onpick,
  }: {
    doc: PDFDocumentProxy
    /** Counting from one, as a reader and a link both count pages. */
    number: number
    /** How many pages the document has, mounted or not: only the ones near the
     *  view exist, so the page says where along the whole it is. */
    count: number
    box: PageBox
    zoom: number
    marks: readonly Highlight[]
    selected: string | null
    /** The page's own size and its transform, once the page has been asked for:
     *  the column is laid out at the first page's size until each page has said
     *  what it is, and a mark is placed through the transform. */
    onmeasure: (number: number, size: Size, matrix: Transform) => void
    /** The words pdf.js laid out, and the spans it laid them out in, so the find
     *  bar can paint a match over them. */
    onwords: (number: number, runs: readonly string[], divs: readonly HTMLElement[]) => void
    /** This page is going. Whatever was kept of its DOM has to go with it, or a
     *  document scrolled from end to end would hold every page it ever drew. */
    onforget: (number: number) => void
    onpick: (id: string | null) => void
  } = $props()

  /** How many pixels one page may be drawn with. A page at a high zoom on a
   *  screen with two device pixels to the CSS pixel would otherwise ask for a
   *  canvas of hundreds of megabytes, which a browser either refuses or pays for
   *  in memory nobody gets back. Past this the page is drawn a little softer
   *  rather than not at all. */
  const MOST_PIXELS = 16 * 1024 * 1024

  /** How long one page took to draw, under a name a profiler and a test can both
   *  read. */
  const DRAWN = 'nib:pdf-page'

  let canvas = $state<HTMLCanvasElement>()
  let words = $state<HTMLDivElement>()
  /** The transform the marks are placed through, so a highlight is drawn at the
   *  zoom and the rotation the page is actually showing. Absent until the page
   *  has been asked for, which is when its size is known at all. */
  let matrix = $state<Transform | null>(null)

  /** Where each mark lands on the page as it is drawn now. */
  const boxes = $derived.by(() => {
    const placed = matrix
    if (!placed) return []

    const point = toViewport(placed)
    return marks.map((mark) => ({
      mark,
      quads: mark.quads.map((quad) => boxOf(quad, point)),
    }))
  })

  /** Which draw is the current one. A number rather than a flag, because the
   *  compiler can see a flag that is only ever set in a teardown never changing,
   *  and would read every check of it as dead code. */
  let latest = 0

  // The page, drawn. Runs again on a zoom, which is a different picture of the
  // same page; the teardown cancels a render that is no longer wanted, which is
  // what keeps a fast scroll from queueing up work nobody will look at.
  $effect(() => {
    const sheet = canvas
    const layer = words
    const scale = zoom * PDF_TO_CSS
    if (!sheet || !layer) return

    const mine = ++latest
    const current = () => mine === latest
    const asked = performance.now()
    let render: RenderTask | null = null
    let page: PDFPageProxy | null = null

    const draw = async () => {
      const [library, view] = await Promise.all([pdfjs(), doc.getPage(number)])
      if (!current()) return
      page = view

      const at = view.getViewport({ scale })
      const placed = matrixOf(at.transform)
      matrix = placed
      onmeasure(number, { width: at.width / scale, height: at.height / scale }, placed)

      const context = sheet.getContext('2d', { alpha: false })
      if (!context) return

      const fit = sheetFor(at, MOST_PIXELS, window.devicePixelRatio || 1)
      sheet.width = fit.width
      sheet.height = fit.height

      render = view.render({ canvas: sheet, canvasContext: context, viewport: at, ...fit.drawn })
      await render.promise
      if (!current()) return

      // The picture is what a reader is waiting for, so the measurement stops
      // here rather than after the words. Named so a profiler and a test can
      // both read it, the way the reading view's render is.
      performance.measure(DRAWN, { start: asked, detail: { page: number, zoom } })

      // After the picture, deliberately: the words are what a selection and the
      // find bar need, and the page is worth looking at before either.
      const content = await view.getTextContent()
      if (!current()) return

      layer.textContent = ''
      const text = new library.TextLayer({
        textContentSource: content,
        container: layer,
        viewport: at,
      })
      await text.render()
      if (!current()) {
        text.cancel()
        return
      }

      onwords(number, text.textContentItemsStr, text.textDivs)
    }

    void draw().catch(() => {
      // A cancelled render throws, and so does a page that turns out to be
      // broken. Neither is worth interrupting the reader for: the page stays
      // blank, and every other page still draws.
    })

    return () => {
      latest++
      onforget(number)
      render?.cancel()
      // The picture's memory goes with the element, but the page's own working
      // set - its fonts and its images - is pdf.js's and has to be given back.
      page?.cleanup()
      // Emptied rather than left for the garbage collector, so a canvas holding
      // a hundred megabytes of bitmap is released in this frame.
      sheet.width = 0
      sheet.height = 0
      layer.textContent = ''
    }
  })

  /** A click on the page: the mark under it becomes the selected one, and a click
   *  on no mark clears the selection. Read by geometry rather than by putting the
   *  marks over the words, which would take the words out of reach of a pointer. */
  function pick(event: MouseEvent & { currentTarget: HTMLElement }) {
    // A click that ends a drag is somebody selecting text, not choosing a mark.
    if ((getSelection()?.toString() ?? '') !== '') return

    const page = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - page.left
    const y = event.clientY - page.top

    const hit = boxes.find(({ quads }) =>
      quads.some(
        (one) =>
          x >= one.left && x <= one.left + one.width && y >= one.top && y <= one.top + one.height,
      ),
    )

    onpick(hit?.mark.id ?? null)
  }
</script>

<!-- The page itself is not interactive: the words over it are what a pointer
     reaches, and this only reads where a click landed.

     Which page this is and how many there are, because only the pages near the
     view exist at all: without the two a reader is given a handful of sheets and
     no idea where in the document they are. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
  class="sheet"
  role="listitem"
  aria-setsize={count}
  aria-posinset={number}
  aria-label={t('Page {number} of {count}', { number, count })}
  style:top="{box.top}px"
  style:width="{box.width}px"
  style:height="{box.height}px"
  style:--total-scale-factor={zoom * PDF_TO_CSS}
  data-page={number}
  onclick={pick}
>
  <!-- The drawing of the page. What a reader gets instead is the words over it,
       which are real text in `.words`; the picture of them says nothing twice. -->
  <canvas bind:this={canvas} aria-hidden="true"></canvas>

  <div class="marks" aria-hidden="true">
    {#each boxes as { mark, quads } (mark.id)}
      {#each quads as quad, run (run)}
        <div
          class="mark"
          class:picked={mark.id === selected}
          style:left="{quad.left}px"
          style:top="{quad.top}px"
          style:width="{quad.width}px"
          style:height="{quad.height}px"
          style:background={COLOURS[mark.colour] ?? COLOURS[0]}
        ></div>
      {/each}
    {/each}
  </div>

  <div class="words" bind:this={words}></div>
</div>

<style>
  .sheet {
    position: absolute;
    left: 50%;
    translate: -50%;
    /* A sheet of paper, which is white whichever way the app is dressed: a PDF
       carries its own colours and tinting the paper would change them. */
    background: #fff;
    border-radius: 2px;
    /* A hairline as well as the shadow: on the light surface a white sheet has
       almost no edge, and a page has to read as a sheet of paper. */
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-sm);
    /* Each page is its own layer, so the browser has nothing to repaint outside
       the one that changed. */
    contain: content;
    --scale-round-x: 1px;
    --scale-round-y: 1px;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .marks {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .mark {
    position: absolute;
    border-radius: 1px;
    opacity: 0.3;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* The one that is chosen, which Delete would remove. */
  .mark.picked {
    opacity: 0.5;
    outline: 1px solid var(--accent);
  }

  /* The words pdf.js lays out over the picture: invisible, selectable, and
     exactly where the glyphs are. The rules are the ones pdf.js's own viewer
     stylesheet carries, kept here rather than by importing six thousand lines of
     it into the app: only the text layer is wanted, and everything else in that
     file has an opinion about buttons. */
  .words {
    position: absolute;
    inset: 0;
    overflow: clip;
    text-align: initial;
    line-height: 1;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    z-index: 1;
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }

  .words :global(span),
  .words :global(br) {
    position: absolute;
    color: transparent;
    white-space: pre;
    cursor: text;
    transform-origin: 0 0;
    user-select: text;
  }

  .words > :global(:not(.markedContent)),
  .words :global(.markedContent span:not(.markedContent)) {
    --font-height: 0;
    --scale-x: 1;
    --rotate: 0deg;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }

  .words :global(.markedContent) {
    display: contents;
  }
</style>
