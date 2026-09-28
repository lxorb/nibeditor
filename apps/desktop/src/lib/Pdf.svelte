<script lang="ts">
  /** A PDF in a pane, read the way a note is read.
   *
   *  One column of pages in the app's own scroller, drawn as they come into view
   *  and given back as they leave, so a paper of three hundred pages costs what
   *  one of three costs. The words are real words: they select, they copy, and
   *  Ctrl+F finds them through the whole document in the same small bar a note
   *  being read uses.
   *
   *  What a reader marks is kept beside the PDF and never inside it; see
   *  pdf/highlights.ts. The PDF stays the file they put in the space.
   *
   *  This component owns the column, the zoom, the find bar and the selection.
   *  One page - its picture, its words, its marks - is PdfPage.svelte, and the
   *  arithmetic under both is pdf/pages.ts. */

  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import { tick } from 'svelte'
  import { copyText } from './clipboard'
  import FindBar from './FindBar.svelte'
  import { t } from './i18n.svelte'
  import { type OpenPdf, openDocument, textOf } from './pdf/document'
  import { textOfRuns, wordsOfRuns } from './pdf/find'
  import { paperOpened, paperRead } from './pdf/papers'
  import {
    type Box,
    citation,
    emptySheet,
    frozen,
    type Highlight,
    joinRuns,
    quadOf,
    type Quad,
    type Sheet,
    toPdf,
    type Transform,
  } from './pdf/highlights'
  import {
    GAP,
    heightOf,
    heldZoom,
    nearby,
    nextZoom,
    pageAt,
    stack,
    topOfPage,
    type Size,
  } from './pdf/pages'
  import { loadHighlights, saveHighlights } from './pdf/sidecar'
  import PdfPage from './PdfPage.svelte'
  import { paint, placesOf, rangeOf } from './reading/find'
  import { scrollbar } from './scrollbar'
  import { shortcuts } from './shortcuts.svelte'
  import { workspace, type Tab } from './workspace.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  /** A page that has never been measured is laid out at this, which is US Letter
   *  in PDF points: the first page replaces it before anything is drawn, so it is
   *  only ever the size of a column nobody has seen. */
  const LETTER: Size = { width: 612, height: 792 }

  /** How long a match waits for its page to be drawn before the find bar gives up
   *  on painting it. The page is already scrolled to; this is the render. */
  const PATIENCE = 2000

  /** How long it took to open the document, under a name a profiler and a test
   *  can both read. */
  const OPENED = 'nib:pdf-open'

  let doc = $state<PDFDocumentProxy | null>(null)
  let broken = $state(false)
  let scroller = $state<HTMLDivElement>()

  /** Every page's size once it is known, and the one they are laid out at until
   *  then; see pdf/pages.ts. */
  let sizes = $state<(Size | undefined)[]>([])
  let fallback = $state<Size>(LETTER)
  /** Each page's transform, for placing a mark and for reading one back. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; the marks come off `sheet`
  const matrices = new Map<number, Transform>()

  const zoom = $derived(tab.zoom ?? 1)
  const boxes = $derived(stack(sizes, fallback, zoom))
  const height = $derived(heightOf(boxes))

  let at = $state(0)
  let viewHeight = $state(0)

  const shown = $derived(nearby(boxes, at, viewHeight))
  /** The pages to draw, counting from one. */
  const drawn = $derived(
    Array.from(
      { length: Math.max(0, shown.to - shown.from) },
      (_unused, index) => shown.from + index + 1,
    ),
  )
  /** How wide the column has to be for the widest page to fit in it, which is what
   *  gives the scroller something to scroll sideways once a page is zoomed past
   *  the pane. */
  const columnWidth = $derived(Math.max(0, ...boxes.map((box) => box.width)) + GAP * 2)

  let sheet = $state<Sheet>(emptySheet())
  let picked = $state<string | null>(null)

  const marksByPage = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const out = new Map<number, Highlight[]>()
    for (const mark of sheet.highlights) {
      const held = out.get(mark.page)
      if (held) held.push(mark)
      else out.set(mark.page, [mark])
    }
    return out
  })

  // ── The document ───────────────────────────────────────────────────

  /** Which opening is the current one; see PdfPage.svelte for why this is a
   *  number and not a flag. */
  let opening = 0

  $effect(() => {
    const path = tab.path
    if (path === null) return

    const mine = ++opening
    const current = () => mine === opening
    const asked = performance.now()
    let opened: OpenPdf | null = null

    const open = async () => {
      const held = await openDocument(path)
      if (!current()) {
        void held.close()
        return
      }
      opened = held

      // Which file these pages belong to, so the words taken down below outlive
      // the sitting: the hash says they are this paper's, and the listing says
      // when the file was last written. See pdf/papers.ts.
      const listed = workspace.files.find((one) => one.path === path)
      paperOpened(path, held.hash, listed?.modified ?? 0)

      // The first page settles the column: every other page is laid out at its
      // size until it says otherwise, which is what lets a page be drawn before
      // three hundred of them have been asked how big they are.
      const first = await held.doc.getPage(1)
      const view = first.getViewport({ scale: 1 })
      if (!current()) return

      fallback = { width: view.width, height: view.height }
      sizes = Array.from({ length: held.doc.numPages }, (_unused, index) =>
        index === 0 ? { width: view.width, height: view.height } : undefined,
      )
      doc = held.doc

      // Opening is what stands between the tab appearing and the first page, so
      // it is worth being able to ask how long it took. The same measurement the
      // reading view takes of a render; see reading/render.ts.
      performance.measure(OPENED, { start: asked, detail: { pages: held.doc.numPages } })
    }

    void open().catch(() => {
      if (current()) broken = true
    })

    return () => {
      opening++
      doc = null
      matrices.clear()
      runs.clear()
      layers.clear()
      void opened?.close()
    }
  })

  // What the reader has marked, read once per PDF.
  $effect(() => {
    const path = tab.path
    if (path === null) return

    let mine = true
    void loadHighlights(path).then((found) => {
      if (mine) sheet = found
    })

    return () => {
      mine = false
    }
  })

  /** Where the reader was left: the page a link asked for, or the page the tab
   *  was last on. Once per document, since after that the scroll is theirs. */
  let landed = false

  $effect(() => {
    const box = scroller
    if (!doc || !box || landed || !boxes.length) return

    landed = true
    box.scrollTop = topOfPage(boxes, tab.page ?? 1)
    at = box.scrollTop
  })

  // A link into a page of a PDF that is already open. Taken down as it is read,
  // the way a followed link into a note is; see App.svelte.
  $effect(() => {
    const asked = workspace.gotoPage
    const box = scroller
    if (!asked || !box || asked.path !== tab.path || !boxes.length) return

    workspace.gotoPage = null
    landed = true
    box.scrollTop = topOfPage(boxes, asked.page)
    at = box.scrollTop
  })

  function measured(number: number, size: Size, matrix: Transform) {
    matrices.set(number, matrix)

    // A page that has already said this changes nothing: the column is laid out
    // again on every zoom, and every page reports the same size each time.
    const held = sizes[number - 1]
    if (held?.width === size.width && held.height === size.height) return

    const next = [...sizes]
    next[number - 1] = size
    sizes = next
  }

  // ── Scrolling ──────────────────────────────────────────────────────

  let frame = 0

  function moved() {
    if (frame) return

    frame = requestAnimationFrame(() => {
      frame = 0
      const box = scroller
      if (!box) return

      at = box.scrollTop
      // The page the reader is on, so the tab opens here next time and a link
      // copied from the selection names the right one.
      workspace.notePdf(tab.id, pageAt(boxes, at, viewHeight), zoom)
    })
  }

  $effect(() => () => cancelAnimationFrame(frame))

  // The pane that is being read takes the keyboard, so the arrows and Page Down
  // reach the column the way they reach an editor.
  $effect(() => {
    if (focused) scroller?.focus({ preventScroll: true })
  })

  // ── Zoom ───────────────────────────────────────────────────────────

  /** Zooms, keeping whatever was under `anchor` where it was: the pointer for a
   *  wheel, the middle of the page for a key. Without this a zoom reads as the
   *  document jumping somewhere else. */
  async function zoomTo(next: number, anchor?: number) {
    const box = scroller
    const wanted = heldZoom(next)
    // The tab is what holds the zoom, and setting it there is also what writes it
    // down; see `notePdf`, which does nothing when nothing changed.
    if (!box || !height) {
      workspace.notePdf(tab.id, tab.page ?? 1, wanted)
      return
    }

    const focus =
      anchor === undefined ? box.clientHeight / 2 : anchor - box.getBoundingClientRect().top
    const along = (box.scrollTop + focus) / height

    workspace.notePdf(tab.id, tab.page ?? 1, wanted)

    // The column is laid out again by the change above; the scroll can only be
    // put back once it has been.
    await tick()
    box.scrollTop = Math.max(0, along * heightOf(boxes) - focus)
    at = box.scrollTop
  }

  function wheeled(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) return

    // The browser's own page zoom is what this replaces: inside a PDF, Ctrl and
    // the wheel means the document rather than the app around it.
    event.preventDefault()
    void zoomTo(zoom * Math.pow(0.999, event.deltaY), event.clientY)
  }

  // ── Finding ────────────────────────────────────────────────────────

  interface Match {
    page: number
    offset: number
  }

  let finding = $state(false)
  let query = $state('')
  let current = $state(0)
  let matches = $state<Match[]>([])

  /** Each page's words, read once. A page's text costs no drawing, which is what
   *  lets a query be counted through a document nobody has scrolled through. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; the bar reads `matches`
  const runs = new Map<number, string[]>()
  /** The text layers on screen, which is where a match can actually be painted. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- the nodes these name are not something to render from
  const layers = new Map<number, { runs: readonly string[]; divs: readonly HTMLElement[] }>()
  /** Who is waiting for a page's words to arrive. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- promises, not anything on screen
  const waiting = new Map<number, () => void>()
  /** Which search is the current one, so an older one stops rather than filling
   *  the list behind the newer. */
  let searching = 0

  function words(number: number, found: readonly string[], divs: readonly HTMLElement[]) {
    layers.set(number, { runs: found, divs })
    if (!runs.has(number)) runs.set(number, [...found])
    // And the space search keeps them too, so a paper that has been read answers
    // a query about it; see pdf/papers.ts.
    if (tab.path) paperRead(tab.path, number, found)

    waiting.get(number)?.()
    waiting.delete(number)

    // A page arriving under the current match is a match that can now be shown.
    if (finding && matches[current]?.page === number) void reveal()
  }

  /** A page that has gone takes what was kept of its DOM with it. The words
   *  themselves stay: they are a few hundred bytes a page, they are what the find
   *  bar counts with, and reading them again would be a round trip to the worker
   *  for every page a scroll passes. */
  function forget(number: number) {
    layers.delete(number)
    matrices.delete(number)
    waiting.get(number)?.()
    waiting.delete(number)
  }

  async function runsOf(number: number): Promise<string[]> {
    const held = runs.get(number)
    if (held) return held

    const document = doc
    if (!document) return []

    const page = await document.getPage(number)
    const read = await textOf(page)
    // Read for its words and not to be looked at, so what pdf.js kept for it
    // goes straight back.
    page.cleanup()
    runs.set(number, read)
    if (tab.path) paperRead(tab.path, number, read)

    return read
  }

  /** Every place the query appears, page by page, in reading order. Counted as it
   *  goes: the first match is shown while the last pages are still being read. */
  async function search(wanted: string) {
    const token = ++searching
    matches = []
    current = 0

    const document = doc
    if (!wanted || !document) {
      paint('nib-find', [])
      paint('nib-find-here', [])
      return
    }

    let shownFirst = false

    for (let page = 1; page <= document.numPages; page++) {
      const found = placesOf(textOfRuns(await runsOf(page)), wanted).map((offset) => ({
        page,
        offset,
      }))
      if (token !== searching) return
      if (!found.length) continue

      matches = [...matches, ...found]
      if (!shownFirst) {
        shownFirst = true
        void reveal()
      }
    }
  }

  /** Waits for a page's words to be laid out, which happens when the page is
   *  drawn. Gives up rather than hanging, so a page that will not draw leaves the
   *  find bar counting instead of stuck. */
  function layerOf(
    number: number,
  ): Promise<{ runs: readonly string[]; divs: readonly HTMLElement[] } | null> {
    const held = layers.get(number)
    if (held) return Promise.resolve(held)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(number)
        resolve(null)
      }, PATIENCE)

      waiting.set(number, () => {
        clearTimeout(timer)
        resolve(layers.get(number) ?? null)
      })
    })
  }

  /** Brings the current match into view and paints it. Only its own page is
   *  painted: the others are not on the page to paint. */
  async function reveal() {
    const match = matches[current]
    const box = scroller
    if (!match || !box) return

    const top = topOfPage(boxes, match.page)
    // Only when the page is not already the one being looked at, so stepping
    // between two matches on one page does not jump the column.
    if (
      top + (boxes[match.page - 1]?.height ?? 0) < box.scrollTop ||
      top > box.scrollTop + box.clientHeight
    ) {
      box.scrollTop = top
      at = top
    }

    const layer = await layerOf(match.page)
    if (!layer || matches[current] !== match) return

    const page = wordsOfRuns(layer.runs, layer.divs)
    const here = rangeOf(page, match.offset, query.length)
    const all = matches
      .filter((one) => one.page === match.page)
      .flatMap((one) => rangeOf(page, one.offset, query.length) ?? [])

    paint('nib-find', all)
    paint('nib-find-here', here ? [here] : [])
    if (!here) return

    // Into the middle, by the box's own scroll rather than scrollIntoView, which
    // would move whatever else on the page happens to scroll.
    const offset = here.getBoundingClientRect().top - box.getBoundingClientRect().top
    if (offset < 0 || offset > box.clientHeight - 40) {
      box.scrollTop += offset - box.clientHeight / 2
      at = box.scrollTop
    }
  }

  function step(by: number) {
    if (!matches.length) return

    current = (current + by + matches.length) % matches.length
    void reveal()
  }

  function typed(what: string) {
    query = what
    void search(what)
  }

  function closeFind() {
    finding = false
    query = ''
    searching++
    matches = []
    paint('nib-find', [])
    paint('nib-find-here', [])
    scroller?.focus({ preventScroll: true })
  }

  // A pane that has gone has no matches to paint.
  $effect(() => () => {
    paint('nib-find', [])
    paint('nib-find-here', [])
  })

  // ── Selecting, and marking ─────────────────────────────────────────

  /** The floating control over a selection: where it is, which page it is on, and
   *  what was selected. Null whenever there is no selection to act on. */
  let control = $state<{ x: number; y: number; page: number; text: string; quads: Quad[] } | null>(
    null,
  )

  /** The page element a node sits in, or null for a node outside one. */
  function sheetOf(node: Node | null): HTMLElement | null {
    const element = node instanceof Element ? node : node?.parentElement
    return element?.closest<HTMLElement>('[data-page]') ?? null
  }

  /** Reads the selection: which page, the words, and the boxes they cover in PDF
   *  user space, so a mark made now lands on the same words at any zoom. */
  function selected() {
    const selection = getSelection()
    const text = selection?.toString() ?? ''
    if (!selection?.rangeCount || !text.trim()) {
      control = null
      return
    }

    const range = selection.getRangeAt(0)
    const page = sheetOf(range.commonAncestorContainer)
    const number = Number(page?.dataset.page ?? 0)
    const matrix = matrices.get(number)
    if (!page || !matrix) {
      control = null
      return
    }

    const box = page.getBoundingClientRect()
    const rects = [...range.getClientRects()]
    const runs = joinRuns(
      rects.map((rect): Box => ({
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      })),
    )
    if (!runs.length) {
      control = null
      return
    }

    const point = toPdf(matrix)
    const top = Math.min(...rects.map((rect) => rect.top))
    const middle =
      (Math.min(...rects.map((rect) => rect.left)) + Math.max(...rects.map((rect) => rect.right))) /
      2

    control = {
      // Kept clear of either edge, the way the format bar over a selection is.
      x: Math.min(Math.max(middle, 60), window.innerWidth - 60),
      y: top,
      page: number,
      text,
      quads: runs.map((run) => quadOf(run, point)),
    }
  }

  /** Marks what is selected. Drawn at once and written down after, so the click
   *  is answered in the frame it happened in. */
  async function highlight() {
    const asked = control
    const path = tab.path
    if (!asked || path === null) return

    const mark: Highlight = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      page: asked.page,
      text: asked.text,
      quads: asked.quads,
      colour: 0,
      created: Date.now(),
    }

    sheet = { ...sheet, highlights: [...sheet.highlights, mark] }
    control = null
    getSelection()?.removeAllRanges()

    await saveHighlights(path, sheet)
  }

  /** The link and the words, as a citation to paste into a note. */
  async function copyLink() {
    const asked = control
    const path = tab.path
    if (!asked || path === null) return

    control = null
    await copyText(citation(path.split(/[\\/]/).pop() ?? '', asked.page, asked.text))
  }

  async function remove(id: string) {
    const path = tab.path
    if (path === null) return

    sheet = { ...sheet, highlights: sheet.highlights.filter((one) => one.id !== id) }
    picked = null
    await saveHighlights(path, sheet)
  }

  // ── Keys ───────────────────────────────────────────────────────────

  /** Read off the window because there is no editor here to read them: an editor
   *  binding never reaches a pane without one. The same shape Reading.svelte
   *  uses, and the same find key. */
  function onKeydown(event: KeyboardEvent) {
    if (!focused) return

    if (shortcuts.pressed('edit.find', event)) {
      event.preventDefault()
      finding = true
      return
    }
    if (finding && event.key === 'Escape') {
      event.preventDefault()
      closeFind()
      return
    }
    if (finding && shortcuts.pressed('edit.find-next', event)) {
      event.preventDefault()
      step(1)
      return
    }
    if (event.key === 'Escape' && (picked || control)) {
      picked = null
      control = null
      return
    }
    if (picked && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      void remove(picked)
      return
    }

    // The document's own zoom. Ctrl and a digit or a sign is a heading level in
    // an editor, and there is no editor in this pane, so the keys are free.
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return

    if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      void zoomTo(nextZoom(zoom, 1))
    } else if (event.key === '-') {
      event.preventDefault()
      void zoomTo(nextZoom(zoom, -1))
    } else if (event.key === '0') {
      event.preventDefault()
      void zoomTo(1)
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="pdf">
  {#if finding}
    <FindBar
      {query}
      count={matches.length}
      {current}
      onstep={step}
      onclose={closeFind}
      onquery={typed}
    />
  {/if}

  <!-- Focusable, so the keys that move a page reach it. Nothing in it is a field,
       and the words over each page are what a pointer selects. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scroller nib-host"
    tabindex="-1"
    use:scrollbar={tab.id}
    bind:this={scroller}
    bind:clientHeight={viewHeight}
    onscroll={moved}
    onwheel={wheeled}
    onmouseup={selected}
    ontouchend={selected}
  >
    {#if broken}
      <p class="trouble">{t('That PDF could not be opened')}</p>
    {:else}
      <!-- A list, and only the pages near the view are in it: each one says which
           page it is and how many there are, the way the rows of the file list do,
           or a reader is handed four sheets out of three hundred with nothing to
           say so. See row-window.ts and docs/tree.md. -->
      <div
        class="column"
        role="list"
        aria-label={t('Pages')}
        style:height="{height}px"
        style:min-width="{columnWidth}px"
      >
        {#if doc}
          {#each drawn as number (number)}
            {@const box = boxes[number - 1]}
            {#if box}
              <PdfPage
                {doc}
                {number}
                {box}
                {zoom}
                count={sizes.length}
                marks={marksByPage.get(number) ?? []}
                selected={picked}
                onmeasure={measured}
                onwords={words}
                onforget={forget}
                onpick={(id: string | null) => (picked = id)}
              />
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  {#if control}
    <!-- Two actions on what is selected, in the shape the format bar over a
         selection already has; see `.nib-bar` in the theme. Both of them run on
         the click, which is how a pointer and a key both arrive - they used to run
         on the press as well, so a mouse asked for each of them twice. -->
    <div
      class="nib-bar nib-bar-at"
      role="toolbar"
      aria-label={t('What is selected')}
      style:left="{control.x}px"
      style:top="{control.y}px"
    >
      <button
        class="pen"
        title={t('Highlight')}
        aria-label={t('Highlight')}
        disabled={frozen(sheet)}
        onmousedown={(event: MouseEvent) => {
          // The selection has to survive the press, or there is nothing to mark.
          event.preventDefault()
        }}
        onclick={() => void highlight()}
      >
        <svg viewBox="0 0 14 14"
          ><path d="M2 11.5h10M3.2 9.2 9.6 2.8a1.7 1.7 0 0 1 2.4 2.4L5.6 11.6H3.2z" /></svg
        >
      </button>
      <button
        title={t('Copy a link')}
        aria-label={t('Copy a link')}
        onmousedown={(event: MouseEvent) => event.preventDefault()}
        onclick={() => void copyLink()}
      >
        <svg viewBox="0 0 14 14">
          <path
            d="M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6"
          />
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .pdf {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .scroller {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: auto;
    /* The pages are a stack of sheets on a surface, not paper on paper. */
    background: var(--surface);
  }

  .column {
    position: relative;
    width: 100%;
    margin: 0 auto;
  }

  .trouble {
    margin: var(--space-6) auto;
    max-width: 24rem;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  /* The two actions a selection offers, drawn rather than written. */
  .nib-bar svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The pen says what colour it would leave, so the button is the answer. */
  .pen svg path:first-child {
    stroke: var(--accent);
    stroke-width: 2.4;
  }

  .pen:hover svg path:first-child,
  .pen:active svg path:first-child {
    stroke: #fff;
  }
</style>
