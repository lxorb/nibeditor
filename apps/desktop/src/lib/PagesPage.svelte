<script lang="ts">
  /** One sheet of paper: its edge, its ruling, and the page of a PDF behind it
   *  where there is one.
   *
   *  A component per page, like the PDF viewer's, because a page is what comes and
   *  goes: the picture of a page is drawn when the page is near the view and let go
   *  of when it is not, which is what keeps a note made from a four hundred page
   *  scan costing the same as one made from four. Nothing here handles a pointer -
   *  the surface above owns every gesture - so the whole sheet can be inert and
   *  never be in the way of a stroke.
   *
   *  The ruling is four CSS gradients and no drawing at all. Lines, a grid and dots
   *  are exactly what a repeating gradient is for, they are crisp at every zoom
   *  because the transform above scales them, and the colour is the canvas's own
   *  `--canvas-dot`, which is the token that already answers "a faint rule, in
   *  whichever theme is on". Dark and light are therefore honest without this file
   *  knowing which it is in.
   *
   *  The pitch is the paper's and not the screen's: 8mm ruled lines and a 5mm grid,
   *  which is what school paper and graph paper are, so a page printed out has the
   *  ruling it had on screen.
   *
   *  What is *not* the paper's is sized in screen pixels instead: the edge round the
   *  sheet, its shadow, the number in its corner and the one sentence a sheet says
   *  when its paper is missing. Those are the app talking rather than something
   *  printed, and a column of sheets reads as a stack of paper at every zoom only if
   *  they hold their size while the paper changes its. See `unit`. */

  import { onDestroy } from 'svelte'
  import type { PageNode } from './canvas/format'
  import { t } from './i18n.svelte'
  import { paperOf } from './pages/paper'

  const {
    page,
    number,
    unit,
    notePath,
    root,
  }: {
    page: PageNode
    /** Counting from one, which is what a page's label says. */
    number: number
    /** One screen pixel in plane units.
     *
     *  The whole column is inside one transform, so everything in here is drawn at
     *  the zoom - which is right for the paper and for the ruling printed on it, and
     *  wrong for the two things that are not on the paper at all. The page's number
     *  and the edge that separates one sheet from the next are the app talking, not
     *  the page, and they are sized in these so they are the same size on screen at
     *  every zoom: the number used to be 44 pixels high on a page zoomed in and four
     *  tenths of one on a note seen whole, which is a label that is either shouting
     *  or gone. The same unit the canvas sizes a handle and a name in. */
    unit: number
    /** The note this page belongs to, and the space it is in. A page's `file` is a
     *  relative path - the two things it can be relative to are these - so a sheet
     *  cannot find its own paper without them; see pages/paper.ts. */
    notePath: string | null
    root: string | null
  } = $props()

  /** The ruling pitches, in the pixels everything else on the plane is in: 8mm and
   *  5mm at 96 to the inch. */
  const LINES = 30
  const GRID = 19

  /** The page of the PDF behind this sheet, once it has been drawn. */
  let paper = $state.raw<ImageBitmap | null>(null)
  /** Whether the paper was asked for and could not be read. A sheet with no picture is
   *  either still drawing or has nothing to draw, and those look the same; a page that
   *  came out blank because nothing could read its PDF is the bug this says out loud. */
  let lost = $state(false)
  let sheet = $state<HTMLCanvasElement>()

  /** Whether this page wants a picture at all. */
  const backed = $derived(!!page.file && !!page.page)

  $effect(() => {
    if (!backed) return

    const file = page.file
    const at = page.page
    if (!file || !at) return

    let alive = true
    void paperOf({ file, note: notePath, root }, at).then((drawn) => {
      if (!alive) return

      paper = drawn?.image ?? null
      lost = !drawn
    })

    return () => {
      alive = false
      paper = null
      lost = false
    }
  })

  // The picture onto the sheet, at the size the page is. Drawn once per page rather
  // than per frame: the transform above is what a zoom does to it, exactly as it is
  // for the ink.
  $effect(() => {
    const element = sheet
    const image = paper
    if (!element || !image) return

    element.width = image.width
    element.height = image.height
    element.getContext('2d')?.drawImage(image, 0, 0)
  })

  onDestroy(() => (paper = null))

  /** The ruling, as the background of the sheet. `blank` is no gradient at all,
   *  which is a sheet of paper. */
  const ruling = $derived.by(() => {
    switch (page.pattern) {
      case 'lines':
        return `repeating-linear-gradient(to bottom, transparent 0, transparent ${LINES - 1}px, var(--canvas-dot) ${LINES - 1}px, var(--canvas-dot) ${LINES}px)`
      case 'grid':
        return [
          `repeating-linear-gradient(to bottom, transparent 0, transparent ${GRID - 1}px, var(--canvas-dot) ${GRID - 1}px, var(--canvas-dot) ${GRID}px)`,
          `repeating-linear-gradient(to right, transparent 0, transparent ${GRID - 1}px, var(--canvas-dot) ${GRID - 1}px, var(--canvas-dot) ${GRID}px)`,
        ].join(', ')
      case 'dots':
        return `radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1.2px)`
      // No gradient at all, which is a sheet of paper.
      case 'blank':
        return 'none'
    }
  })

  const ruled = $derived(page.pattern === 'dots' ? `${GRID}px ${GRID}px` : 'auto')
</script>

<div
  class="sheet"
  class:ruled={page.pattern !== 'blank'}
  style:left="{page.x}px"
  style:top="{page.y}px"
  style:width="{page.width}px"
  style:height="{page.height}px"
  style:background-image={ruling}
  style:background-size={ruled}
  style:--unit={unit}
  aria-hidden="true"
>
  {#if backed}
    <!-- The page of the paper, at whatever resolution it was drawn at, scaled to
         the page. A sheet whose PDF has gone stays a sheet: what is written on it
         is still readable, which is the point of keeping the ink beside the paper
         rather than in it. -->
    <canvas bind:this={sheet} class:there={!!paper}></canvas>
  {/if}
  {#if lost}
    <!-- Said on the sheet, quietly and once. A page whose paper cannot be read used
         to be indistinguishable from a page with nothing on it, which is how a whole
         note of blank sheets read as a note of blank sheets rather than as a paper
         nothing had resolved. -->
    <span class="missing">{t('The paper could not be read')}</span>
  {/if}
  <span class="number">{number}</span>
</div>

<style>
  /* One sheet: white paper in the light and a dark sheet in the dark, with an edge
     rather than a shadow at the top so a column of them reads as separate pages
     without a stack of blurs to composite. */
  .sheet {
    position: absolute;
    background-color: var(--surface);
    background-repeat: repeat;
    border: calc(1px * var(--unit)) solid var(--line);
    border-radius: calc(2px * var(--unit));
    box-shadow: 0 calc(1px * var(--unit)) calc(3px * var(--unit)) rgb(0 0 0 / 0.08);
    pointer-events: none;
    overflow: hidden;
  }

  .sheet canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  /* Faded in when it arrives, so a page that took a moment to rasterise does not
     appear with a snap under the nib. */
  .sheet canvas.there {
    opacity: 1;
  }

  /* What a page says when its paper is not there: at the top of the sheet, in the
     muted shade every other aside is in, and out of the way of the writing. */
  .missing {
    position: absolute;
    inset-inline: 0;
    top: calc(12px * var(--unit));
    color: var(--muted);
    font: calc(12px * var(--unit)) / 1.4 var(--font-ui, inherit);
    text-align: center;
    user-select: none;
  }

  /* The page's number, in the corner of the sheet, quiet enough to be ignored and
     there so somebody scrolling knows where they are without the bar. */
  .number {
    position: absolute;
    inset-inline-end: calc(10px * var(--unit));
    bottom: calc(6px * var(--unit));
    color: var(--muted);
    font: calc(11px * var(--unit)) / 1 var(--font-ui, inherit);
    opacity: 0.55;
    user-select: none;
  }
</style>
