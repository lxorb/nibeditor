<script lang="ts">
  /** The one mark an open tab wears: what this window is looking at.
   *
   *  A tab is not a row in the file list, and that is the whole of why this exists
   *  beside `FileMark.svelte`. A row is the file, so it wears whatever icon the file
   *  chose for itself; a tab is a window onto one kind of thing, and what it owes the
   *  reader is which kind - at a glance, along a full strip. So a note is the page
   *  with writing on it however the note dressed its row, a canvas is the two cards,
   *  a PDF is the book: the marks the lists already draw, asked of the kind and never
   *  of the path. See file-mark.ts.
   *
   *  Two are drawn here rather than there. The graph is the space's own picture, which
   *  the panel that opens it already wears; see panel-marks.ts. And a website wears
   *  the site's own favicon, because every browser for thirty years has put the site
   *  in this box and not the word "web" - the globe stands in only where there is no
   *  picture to be had. While a page is loading the mark turns, which is the one
   *  moment this box says what the tab is doing rather than what it holds.
   *
   *  Everything here is the box and the hairline `FileMark.svelte` draws, because most
   *  of the time that component is what is in this slot. One size and one weight, so a
   *  strip of every kind at once reads as a strip rather than as a row of unrelated
   *  pictures. */
  import LoaderCircle from 'lucide/dist/esm/icons/loader-circle.mjs'
  import { markOf } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { GRAPH_MARK } from './panel-marks'
  import { type Page, pages } from './web-tab/pages.svelte'
  import { iconOf } from './web-tab/shortcut'
  import type { Tab } from './workspace.svelte'

  const { tab }: { tab: Tab } = $props()

  /** What the document in this tab is, as a mark. Null for the graph, which is the
   *  one tab that is not a file; see `markOf`. */
  const mark = $derived(markOf(tab.kind))

  /** The page behind a website, and nothing for any other kind: asking for one makes
   *  it, and a note has no page to make. */
  const page = $derived<Page | null>(mark === 'web' ? pages.of(tab.id) : null)

  /** The picture to draw for a website: the one the page found while it was loading,
   *  else the one its file wrote down - which is the only one a tab has before the page
   *  is there and on a machine that has never opened the site. Nothing where neither
   *  says, and then the globe is what a website wears. */
  const found = $derived(page ? (page.icon ?? iconOf(tab.path, tab.doc)) : null)

  /** Whether the picture refused to arrive. A site whose mark has moved, or one the
   *  content policy will not fetch, leaves a broken picture where a mark should be,
   *  and the globe reads better than that. The bar over the page falls back the same
   *  way, for the same reason; see web-tab/WebBar.svelte. */
  let broken = $state(false)

  // Somewhere else is another picture to look for.
  $effect(() => {
    if (found) broken = false
  })
</script>

{#if page?.loading}
  <!-- A page on its way, said in the box the mark is in, which is where a browser
       says it. One turn a second - the speed the reload glyph over the page turns
       at, and slow enough to read as waiting rather than as an animation. -->
  <span class="mark quiet turning" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      {#each LoaderCircle as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </span>
{:else if found && !broken}
  <span class="mark" aria-hidden="true">
    <img src={found} alt="" onerror={() => (broken = true)} />
  </span>
{:else if mark}
  <!-- The kind's own drawing, with no path behind it: a note that chose a rocket
       wears the rocket in the file list and the page here, because a tab has to say
       what it is a tab of. -->
  <FileMark {mark} />
{:else}
  <!-- Three notes and the edges between them: the space's own picture, which is what
       the panel that opens the graph and the bookmark that keeps a view of it already
       wear. See panel-marks.ts. -->
  <span class="mark quiet" aria-hidden="true">
    <svg class="graph" viewBox="0 0 13 13"><path d={GRAPH_MARK} /></svg>
  </span>
{/if}

<style>
  /* FileMark's box, to the pixel, because that component is what fills this slot for
     most kinds: `--icon-md` is 16px under a pointer and 20px under a thumb, and the
     tokens restate it once. */
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  /* A favicon is somebody's finished picture in its own colours, so it is drawn at
     full strength - the rule FileMark draws an emoji by, for the same reason. Square,
     and never letterboxed: a site that serves a wide image for its mark is cropped to
     the box every other tab keeps rather than being allowed to sit off centre. */
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* A stroke is held back and a picture is not: FileMark's own rule, in FileMark's
     own word, because it is the same fact about the same marks. */
  .quiet {
    opacity: 0.8;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The weight a Lucide mark is drawn at here, which is FileMark's own number. */
  .turning svg {
    stroke-width: 1.6;
    animation: turn 1s linear infinite;
  }

  /* The same hairline on the panel's 13 unit grid rather than Lucide's 24: a stroke
     is in the grid's units, so 1.6 of 24 and this of 13 are the same fraction of the
     box and come out at the same fraction of a pixel. Written as the sum it is, so
     the graph cannot drift heavier than the note beside it. */
  .graph {
    stroke-width: calc(1.6 * 13 / 24);
  }

  /* Movement is a preference, and a mark that turns forever is exactly what it is
     about. Still there, a shade quieter, so the tab goes on saying the page is on
     its way. */
  @media (prefers-reduced-motion: reduce) {
    .turning svg {
      animation: none;
      opacity: 0.6;
    }
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
</style>
