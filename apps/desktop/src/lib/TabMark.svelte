<script lang="ts">
  /** The one mark an open tab wears: what this window is looking at.
   *
   *  A file wears one mark, and the surface drawing it does not get a say. So a note
   *  that chose a rocket in the file list is the rocket in the strip as well, and one
   *  that chose nothing is its kind's own drawing in both places - which is
   *  `FileMark.svelte` in both places, asked for the same path, rather than two
   *  components that agree by being kept in step. A tab used to be the kind and
   *  nothing else, on the grounds that a strip says which kind each window is; what
   *  that cost was that the one thing somebody chose about a note was the one thing
   *  the tab would not show, and a pinned tab - which is its mark and no name at all -
   *  was a row of identical pages. See chosen-icon.ts, which is where the one answer
   *  is, and file-mark.ts for what a kind draws when nothing was chosen.
   *
   *  What is left here is the three marks a tab has and a row has not. The graph is
   *  the space's own picture, which the panel that opens it already wears; see
   *  panel-marks.ts. A website wears the picture its own page found, which is newer
   *  than anything the file says and is the reason a browser puts the site in this box
   *  rather than the word "web" - and where the page has not found one, the row's own
   *  reading of the file takes over below. While a page is loading the mark turns,
   *  which is the one moment this box says what the tab is doing rather than what it
   *  holds.
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
   *  says, and then the row's own reading of the file is what answers: the mark out of
   *  the index, else whatever the file chose, else the globe. */
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
  <!-- The file's own mark, drawn by the component the file list draws it with and
       handed the same path: a note that chose a rocket wears the rocket here too, and
       one that chose nothing wears its kind's drawing. A tab with no file yet - an
       unsaved note, a new plane - has no path to have chosen anything with, and gets
       its kind's drawing for the same reason. -->
  <FileMark {mark} path={tab.path ?? undefined} />
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
