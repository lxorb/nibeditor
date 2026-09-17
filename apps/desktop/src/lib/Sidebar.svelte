<script lang="ts">
  import {
    carried,
    carrySection,
    dragged,
    draggedSection,
    isSectionDrag,
    isTreeDrag,
  } from './drag-paths'
  import { movesSection } from './sections'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { movesInto } from './move-targets'
  import {
    FILES_MARK,
    FOOTNOTES_MARK,
    GRAPH_MARK,
    LINKS_MARK,
    ORDER_MARK,
    OUTLINE_MARK,
    SEARCH_MARK,
  } from './panel-marks'
  import { newSpace } from './space-actions'
  import {
    canRecord,
    canTakeMeetingNotes,
    meeting,
    meetingLabel,
    record,
    recordLabel,
  } from './recorder/commands'
  import { arriving } from './arriving.svelte'
  import { arrive, leave, segmented } from './slide'
  import { headingAt, lineOf } from './outline'
  import { pages } from './pages/showing.svelte'
  import { pagesNavigator, searchPanel } from './surfaces.svelte'
  import { bookmarkEntry, DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { roving } from './roving'
  import type { Panel, PanelSide } from './workspace.svelte'
  import { pullable } from './pull.svelte'
  import { scrollbar } from './scrollbar'
  import { workspace } from './workspace.svelte'
  import { DEEPEST, SHALLOWEST } from './workspace/graph-settings.svelte'
  import { search, type SearchSort } from './search.svelte'
  import { SidebarWidth } from './sidebar-width.svelte'
  import { viewport } from './viewport.svelte'
  import Bookmarks from './Bookmarks.svelte'
  import Links from './Links.svelte'
  import SidebarFoot from './SidebarFoot.svelte'
  import SidebarToggle from './SidebarToggle.svelte'
  import SpaceSwitcher from './SpaceSwitcher.svelte'
  import { dropTarget } from './drop-target.svelte'
  import Tree from './Tree.svelte'
  import { dur } from './motion'

  const {
    side = 'left',
    ongoto,
    onmovesection,
  }: {
    /** Which side of the window this one is. The left side is the sidebar the app
     *  has always had; the right side is drawn only once a panel has been moved
     *  over to it, and holds only those. See workspace.movePanel. */
    side?: PanelSide
    ongoto?: (line: number) => void
    /** Moves a whole section of the open note, by the two places in the outline
     *  it came from and landed on. The app owns the editor, so the edit is made
     *  there; see `moveSection` in sections.ts for what a section is. */
    onmovesection?: (from: number, to: number) => void
  } = $props()

  /** Lit while a drop would land in the space itself: over the empty stretch
   *  below the last row, and over a row at the top of the space, which stands for
   *  the space the way every row stands for the folder it sits in. One answer for
   *  the whole list; see drop-target.svelte.ts. */
  const rootDrop = $derived.by(() => {
    const root = workspace.activeSpace?.root
    return root !== undefined && dropTarget.lit(root)
  })

  /** The space below the tree lights only where a drop would do something: a row
   *  already at the top of the space is not moving. The same rule the rows
   *  themselves follow; see `takes` in Tree.svelte. */
  function overRoot(event: DragEvent) {
    const root = workspace.activeSpace?.root
    if (!isTreeDrag(event.dataTransfer) || !root) return

    const paths = carried()
    if (paths.length && !movesInto(paths, root)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropTarget.over(root)
  }

  function dropOnRoot(event: DragEvent) {
    event.preventDefault()
    dropTarget.clear()

    const paths = dragged(event.dataTransfer)
    const root = workspace.activeSpace?.root
    if (paths.length && root) void workspace.moveMany(paths, root)
  }

  /** A tack, seen from the side: the head, the shaft, the plate and the needle.
   *  Here rather than in panel-marks.ts because one surface draws it; see the
   *  note at the top of that file. */
  const HOLD_MARK = 'M4.6 2h4M6.6 2v3.2M4 5.2h5.2M6.6 5.2v5.6'

  /** An arrow down to a line: what a footnote's definition is, which is at the foot
   *  of the note. Here for the reason the tack above is: one surface draws it. */
  const DOWN_MARK = 'M6.5 2.4v5.2M4.3 5.6l2.2 2.2 2.2-2.2M3.4 10.6h6.2'

  /** The panel showing on this side, which every row below reads instead of
   *  `workspace.panel`: the left side's is that, and the right side's is its
   *  own. */
  const showing = $derived(workspace.openOn(side))

  const PANELS: { id: Panel; label: string; path: string }[] = [
    { id: 'tree', label: t('Files'), path: FILES_MARK },
    { id: 'outline', label: t('Outline'), path: OUTLINE_MARK },
    { id: 'search', label: t('Search'), path: SEARCH_MARK },
    { id: 'links', label: t('Links'), path: LINKS_MARK },
    { id: 'footnotes', label: t('Footnotes'), path: FOOTNOTES_MARK },
  ]

  /** The tabs this side holds, in the order it shows them; see
   *  workspace.panelsOn. */
  const mine = $derived.by(() => {
    const held = workspace.panelsOn(
      side,
      PANELS.map((one) => one.id),
    )

    return held.flatMap((id) => PANELS.filter((one) => one.id === id))
  })

  /** Whether the Links panel is showing the picture. Held here because the switch
   *  for it is in the row of panel tabs above.
   *
   *  How far out it reaches is the space's, not this window's: it is a fact about
   *  how the space is read, and the picture in the tab and the one in the panel are
   *  two views of the same setting. See workspace/graph-settings.svelte.ts. */
  let graphing = $state(false)
  const depth = $derived(workspace.graphSettings.here.depth)

  /** What the file list draws: the listing off the disk with the rows an account's
   *  first pass has named grafted into it. See `shownTree` in workspace.svelte.ts. */
  const listing = $derived(workspace.shownTree)

  /** The order the file list is read in, offered by the press that asks for it.
   *
   *  The rows and their seven words are next door in order-menu.ts and arrive with the
   *  press: a window draws its file list before it does anything else, and the order in
   *  force is already on screen without the menu being built - it is what the rows are
   *  in. The same seam lib/ai/ask.ts holds in front of answering.ts.
   *
   *  The press is spent here rather than left to `menu.show`, because after the await
   *  it is too late to stop a browser showing its own menu. */
  function showOrder(event: MouseEvent) {
    event.preventDefault()
    void import('./order-menu').then(({ orderMenu, orderTitle }) =>
      menu.show(event, orderMenu(), { title: orderTitle() }),
    )
  }

  /** A press on a panel's own tab. The file list's tab leads with the order rows,
   *  which is where the list's sorting has always been, so that one press fetches them
   *  and every other tab answers at once. */
  function showTabMenu(event: MouseEvent, id: Panel, label: string) {
    event.preventDefault()
    if (id !== 'tree') {
      menu.show(event, tabMenu(id), { title: label })
      return
    }

    void import('./order-menu').then(({ orderMenu }) =>
      menu.show(event, [...orderMenu(), DIVIDER, ...tabMenu(id)], { title: label }),
    )
  }

  /** What the Files tab offers besides the order: which files are shown at all, and
   *  what the list makes. */
  function sortMenu(): MenuEntry[] {
    return [
      {
        label: workspace.treeOptions.showHidden ? t('Hide hidden files') : t('Show hidden files'),
        run: () => workspace.toggleHidden(),
      },
      DIVIDER,
      { label: t('New note'), run: () => void workspace.createNote() },
      { label: t('New canvas'), run: () => void workspace.createCanvas() },
      ...(viewport.device === 'phone'
        ? []
        : [{ label: t('New web note'), run: () => void workspace.createWebsite() }]),
    ]
  }

  /** The order the results are read in. The same menu the file list's sort is,
   *  in the same place - a press on the tab - because it is the same question
   *  about the same space asked of a different list. */
  function resultsMenu(): MenuEntry[] {
    const arrow = (key: SearchSort) =>
      search.ordering.sort === key ? (search.ordering.descending ? '↓' : '↑') : undefined

    return [
      {
        label: t('Sort by relevance'),
        hint: arrow('relevance'),
        run: () => search.setSort('relevance'),
      },
      { label: t('Sort by name'), hint: arrow('name'), run: () => search.setSort('name') },
      {
        label: t('Sort by modified'),
        hint: arrow('modified'),
        run: () => search.setSort('modified'),
      },
      {
        label: t('Sort by created'),
        hint: arrow('created'),
        run: () => search.setSort('created'),
      },
    ]
  }

  /** What a press on a panel's own tab offers, for the two panels that have
   *  something to say about the order of what they show. */
  function tabMenu(id: Panel): MenuEntry[] {
    const own = id === 'tree' ? sortMenu() : id === 'search' ? resultsMenu() : []
    const there: PanelSide = side === 'right' ? 'left' : 'right'

    // On every tab, and last: which side a panel sits on is a thing to do to the
    // tab rather than a thing the panel is about, so it goes under whatever the
    // panel's own rows are. A phone has no two sides to speak of - the right one
    // is a drawer of its own there - and the row is offered all the same: the
    // choice travels with the window, and a phone in a dock is a wide screen.
    return [
      ...own,
      ...(own.length ? [DIVIDER] : []),
      {
        label: there === 'right' ? t('Move to the right') : t('Move to the left'),
        run: () => workspace.movePanel(id, there),
      },
    ]
  }

  /** What the space itself offers, wherever in the panel you ask for it.
   *
   *  Two things to make, and two to record. A folder is not one of them: a note
   *  that holds notes is how a space is organised, and that is a note made inside
   *  another note's row. See folder-notes.ts and docs/tree.md.
   *
   *  The plus at the top of this panel is the only one on a phone, which makes this
   *  the whole of what a thumb can reach without the keyboard: a recording and a
   *  meeting belong on it, and both make their own note where there is none. See
   *  recorder/commands.ts and docs/mobile.md. */
  function spaceMenu(): MenuEntry[] {
    return [
      { label: t('New note'), run: () => void workspace.createNote() },
      { label: t('New canvas'), run: () => void workspace.createCanvas() },
      ...(viewport.device === 'phone'
        ? []
        : [{ label: t('New web note'), run: () => void workspace.createWebsite() }]),
      ...(canRecord() ? [{ label: recordLabel(), run: () => void record() }] : []),
      ...(canTakeMeetingNotes() ? [{ label: meetingLabel(), run: () => void meeting() }] : []),
    ]
  }

  /** What a phone's menu sheet is headed with. Left out entirely when there is
   *  no space to name, since `title: undefined` is not the same as no title. */
  function titleOfSpace(): { title?: string } {
    const name = workspace.activeSpace?.name
    return name === undefined ? {} : { title: name }
  }

  /** A bookmarked search puts its words back in the box and runs them. The
   *  panel is named rather than shown, because `showPanel` is a switch and
   *  would shut a search panel that was already open. */
  function runBookmarked(text: string) {
    if (showing !== 'search') workspace.showPanel('search')
    search.ask(text)
  }

  $effect(() => {
    if (showing === 'search') void workspace.loadTags()
  })

  /** Whether the panels are held on a tab, and whether this side's panel is one that
   *  can be held at all. Both the workspace's own answers, because the palette offers
   *  the same hold and two copies of one rule is one of them going stale; see
   *  `holdable` there for which panels and which machines. */
  const held = $derived(workspace.held)
  const holdable = $derived(workspace.holdable(showing))

  /** Takes the reader to a line of the note the panel is about.
   *
   *  A panel held on a note open in another pane takes them to that pane first: a
   *  row is pressed to go somewhere, and going somewhere means being there. */
  function jump(line: number) {
    const tab = workspace.panelTab
    if (tab && tab.id !== workspace.activeTabId) workspace.activate(tab.id)
    ongoto?.(line)
  }

  /** The outline steps in and fades from the shallowest heading the note
   *  has, so a note that starts at "##" is not drawn as one missing its
   *  title. */
  const shallowest = $derived(
    workspace.headings.reduce((least, heading) => Math.min(least, heading.level), 6),
  )

  /** The heading the caret is under: the last one that starts on or above
   *  the caret's line. The editor keeps the caret up to date as it moves, and
   *  on a phone it is also the only thing that says where in the note you
   *  were, since the drawer covers the note. */
  const current = $derived.by(() => {
    if (showing !== 'outline') return -1

    const tab = workspace.panelTab
    const headings = workspace.headings
    if (!tab || !headings.length) return -1

    // The editor says which line the caret is on; only a session written by an
    // older build has to have it worked out from the newlines before it.
    const line = tab.line ?? lineOf(tab.doc, tab.cursor ?? 0)
    return headingAt(headings, line)
  })

  let outline = $state<HTMLElement>()

  /** The row a drop would land on, which side of it the line sits, and which row
   *  is being dragged. The same three the bookmarks keep, and for the same
   *  reason: a drag under way will not say what it carries, only what kind of
   *  thing it is, so the row it came from has to be remembered here. */
  let dropAt = $state<number | null>(null)
  let dropAbove = $state(false)
  let dragging = $state<number | null>(null)

  function startSection(event: DragEvent, at: number) {
    carrySection(event.dataTransfer, at)
    dragging = at
  }

  function endSection() {
    dropAt = null
    dragging = null
  }

  function overSection(event: DragEvent, at: number) {
    // Only where the drop would move something: a section held over itself, or
    // over a heading inside it, lights nothing because it would do nothing.
    if (!isSectionDrag(event.dataTransfer)) return
    if (dragging !== null && !movesSection(workspace.headings, dragging, at)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    dropAt = at
    // The line marks the edge the section arrives at: the top of the row when it
    // is coming down the list, the bottom when it is going up.
    dropAbove = dragging !== null && dragging > at
  }

  function dropSection(event: DragEvent, at: number) {
    event.preventDefault()

    const from = draggedSection(event.dataTransfer)
    endSection()
    if (from !== null) onmovesection?.(from, at)
  }

  /** What a heading's own menu offers: bookmarking it, and on a touch screen the
   *  move a drag would have made. */
  function headingMenu(at: number, text: string): MenuEntry[] {
    return [
      ...bookmarkEntry(workspace.bookmarks.forHeading(workspace.panelNote, text)),
      ...moveSectionEntries(at),
    ]
  }

  /** Moving a section where a drag is not available. A held finger opens the
   *  menu before a drag could start and a browser fires no drag events from a
   *  touch at all, so the menu offers the move, in the sheet every other question
   *  uses. The same call the drop makes, so it is the same move and the same
   *  undo. See Tree.svelte, which answers the same problem the same way. */
  function moveSectionEntries(at: number): MenuEntry[] {
    if (!viewport.touch) return []

    const targets = workspace.headings
      .map((heading, index) => ({ id: String(index), label: heading.text, index }))
      .filter((one) => movesSection(workspace.headings, at, one.index))
    if (!targets.length) return []

    return [
      {
        label: t('Move'),
        run: () => {
          void (async () => {
            const { prompt } = await import('./prompt.svelte')
            const to = await prompt.find({
              title: t('Move after'),
              options: targets.map((one) => ({ id: one.id, label: one.label })),
              placeholder: t('Heading'),
            })
            if (to !== null) onmovesection?.(at, Number(to))
          })()
        },
      },
    ]
  }

  // The caret's heading is in view the moment the panel opens and stays there
  // as the caret moves. Nearest, so a row already showing does not pull the
  // list around under the finger.
  $effect(() => {
    const list = outline
    if (!list || current < 0) return
    // `is-on` is what the row wears; it was `.active` before the row moved into
    // the themes package, and a selector nothing matched meant the outline
    // quietly stopped following the caret.
    list.querySelector('.row.is-on')?.scrollIntoView({ block: 'nearest' })
  })

  /** Which way the panel's contents come in when the space changes: from
   *  below when the new space sits lower in the switcher, from above when it
   *  sits higher, so the motion agrees with the row that was pressed.
   *
   *  Kept by an effect rather than worked out in a derived. A derived is read on
   *  demand and may be read twice or not at all, so a "previous value" written
   *  down inside one is not the previous value: the direction came out wrong
   *  whenever the panel happened to read it an extra time. Before the paint, so
   *  the transition that is about to start is the one this decided. */
  const place = $derived(workspace.spaces.findIndex((one) => one.id === workspace.activeSpaceId))
  let direction = $state(1)
  let lastPlace = -1

  $effect.pre(() => {
    direction = place >= lastPlace ? 1 : -1
    lastPlace = place
  })

  const size = new SidebarWidth(() => side)
  let aside = $state<HTMLElement>()
  /** How wide it is drawn right now, which is what the handle says it is. Measured
   *  rather than read off the store, because until somebody has moved it the width
   *  is the theme's and the store holds null - and a handle that says nothing about
   *  where it is is a slider with no value. */
  let asideWidth = $state(0)

  // The edge can go while a finger is still on it - Escape, the back gesture, a
  // note chosen on a phone - and then no pointerup ever reaches it.
  $effect(() => () => size.release())

  /** The edge, moved with a key. What a press means is sidebar-width.svelte.ts,
   *  which is where the drag's own bounds already are; this only keeps the press. */
  function onEdgeKey(event: KeyboardEvent) {
    if (viewport.touch) return
    if (size.step(event.key, aside)) event.preventDefault()
  }
</script>

<!-- On a desktop the sidebar slides open and shut, and the document slides
     with it, because the width is what animates rather than the opacity. On
     a phone the drawer it sits in is what moves, and this must be its full
     width the moment it exists, or the drag that opened it measures a
     sidebar still growing. -->
<!-- Named, because a region of the page that has no name is one a reader cannot
     tell from the next: the words are the space's, which is what the panel is
     about. -->
<aside
  bind:this={aside}
  bind:clientWidth={asideWidth}
  data-region={side === 'right' ? 'right' : undefined}
  aria-label={t('{space} panel', { space: workspace.activeSpace?.name ?? t('Space') })}
  class:resizing={size.dragging}
  class:right={side === 'right'}
  style:width={size.pixels !== null && !viewport.touch ? `${size.pixels}px` : undefined}
  transition:slide={{ axis: 'x', duration: dur(viewport.touch ? 0 : 210), easing: cubicOut }}
>
  <!-- The strip along the right edge that changes the width. Not on a phone,
       where the drawer is as wide as the drawer is.

       A separator, which is what it is, and one a key can move: the arrows widen
       and narrow it a step at a time, Home and End take it to either end and Enter
       puts it back where it started - the same thing a double click does. It was a
       `div` with a tooltip on it before, which is a control only a hand can reach
       and nothing at all can read.

       A separator that can be moved is a focusable separator, which is what a
       window splitter is and what the practices call for; the rule below knows
       only the kind that divides two things and is never touched. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="edge"
    role="separator"
    aria-orientation="vertical"
    aria-label={t('Panel width')}
    aria-valuemin={size.narrowest}
    aria-valuemax={size.widest}
    aria-valuenow={Math.round(size.pixels ?? asideWidth) || size.narrowest}
    tabindex="0"
    title={t('Drag to resize')}
    onpointerdown={(event) => size.start(event, aside)}
    ondblclick={() => size.reset()}
    onkeydown={onEdgeKey}
  ></div>

  <!-- Which space this is. A panel with no subject is a list of names belonging
       to nobody, so the name comes first and is itself the switcher: every other
       space is a row in it, with its own mark, and there is no second column of
       wordless squares saying the same thing. See SpaceSwitcher.svelte. -->
  <!-- The regions of the window carry one attribute each, so the order F6 walks is
       the order the sidebar is built in and cannot drift from it; see focus.ts.

       The space's name, its switcher and the plus belong to one side of the
       window: a second identity row on the right would be a second switcher for
       the same space, and the right side is one region of its own. -->
  {#if side === 'left'}
    <div class="head" data-region="space">
      <!-- Where the panel is a drawer over the note it covers the bar the sidebar
         button sits in, so the drawer carries the same button at the same corner
         of the screen - one component, one glyph, one movement; see
         SidebarToggle.svelte. A docked panel leaves the bar's own button where
         it is and has none of its own. -->
      {#if viewport.drawer}
        <SidebarToggle />
      {/if}

      <!-- It takes the width the head has left, so the whole row is the control
         that opens the list of spaces; the plus below is what "the width left"
         means. There used to be an empty span here holding the two apart, which
         was the same arrangement with a spacer in the middle. -->
      <SpaceSwitcher />

      <!-- The one plus. A desktop's lives at the end of the tab strip, where a
         browser puts it; a handheld has no tab strip, so it is here. Either way
         a plain press makes a note and a held finger offers the other two kinds,
         which is what the strip's plus does; see Tabs.svelte. -->
      {#if viewport.touch}
        <button
          class="new"
          title={t('New note')}
          aria-label={t('New note')}
          onclick={() => void workspace.createNote()}
          oncontextmenu={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
          use:longPress={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
        >
          <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
        </button>
      {/if}
    </div>
  {/if}

  <div class="switch">
    <!-- Four tabs are one tab stop, and left and right move between them. They
         change as they are arrived at, because what each of them shows is already
         worked out and arrives without a wait - which is the rule the ARIA practices
         give for choosing on arrival. See roving.ts. -->
    <div
      class="nib-segmented"
      data-region={side === 'left' ? 'panels' : undefined}
      use:roving={{
        across: true,
        rows: '[role=tab]',
        current: '[aria-selected=true]',
        wrap: true,
        follow: (tab) => tab.click(),
      }}
      role="tablist"
      aria-label={t('Panels')}
      use:segmented
    >
      {#each mine as item (item.id)}
        <button
          class:on={showing === item.id}
          role="tab"
          title={item.label}
          aria-label={item.label}
          aria-selected={showing === item.id}
          onclick={() => workspace.showPanel(item.id)}
          oncontextmenu={(event) => showTabMenu(event, item.id, item.label)}
          use:longPress={(event) => showTabMenu(event, item.id, item.label)}
        >
          <svg viewBox="0 0 13 13"><path d={item.path} /></svg>
        </button>
      {/each}
    </div>

    <!-- What a panel has to offer goes at the other end of the row its tabs are
         in: whether a panel about one note stays on it, and whether the Links
         panel says what it has to say as a list or as a picture. -->
    {#if holdable}
      <div class="tools">
        <!-- A panel about one note usually means the note being worked in. Held,
             it means the note it was held on, so an outline can be read on the
             left while another note is written on the right. It lasts for the
             sitting: a panel held on a note nobody remembers holding it on is
             worse than one that simply follows. -->
        <button
          class="nib-glyph tool"
          class:active={held}
          title={held ? t('Follow the open note') : t('Stay on this note')}
          aria-label={held ? t('Follow the open note') : t('Stay on this note')}
          aria-pressed={held}
          onclick={() => workspace.holdPanel(held ? null : (workspace.panelTab?.id ?? null))}
        >
          <svg viewBox="0 0 13 13"><path d={HOLD_MARK} /></svg>
        </button>
      </div>
    {/if}
    <!-- Which order the file list is read in. At the end of the header row, where
         every other panel's own tools are, because it is a fact about the list under
         it rather than about the space: one glyph, one press, seven rows, and the one
         that is in force wears the tick. Remembered per space on this machine; the
         order somebody arranged by hand travels with the space instead. See
         tree-order.ts and docs/tree.md. -->
    {#if showing === 'tree' && listing}
      <div class="tools">
        <button
          class="nib-glyph tool"
          title={t('Order of the files')}
          aria-label={t('Order of the files')}
          aria-haspopup="menu"
          onclick={showOrder}
        >
          <svg viewBox="0 0 13 13"><path d={ORDER_MARK} /></svg>
        </button>
      </div>
    {/if}
    {#if showing === 'links'}
      <div class="tools">
        {#if graphing}
          <!-- How far out the picture reaches, one link at a press and round again.
               The same setting the slider on the graph's own card writes, so the two
               are never out of step; see GraphControls.svelte, which is where the
               whole range is. A stepper here rather than a second slider: this is one
               glyph in a row of them, and the panel's tools are all presses. -->
          <button
            class="nib-glyph depth"
            title={t('Depth')}
            aria-label={t('Depth')}
            onclick={() =>
              workspace.graphSettings.set({
                depth: depth >= DEEPEST ? SHALLOWEST : depth + 1,
              })}
            transition:fly={{ x: 10, duration: dur(130), easing: cubicOut }}
          >
            {depth}
          </button>
        {/if}
        <button
          class="nib-glyph tool"
          class:active={graphing}
          title={t('Graph')}
          aria-label={t('Graph')}
          aria-pressed={graphing}
          onclick={() => (graphing = !graphing)}
        >
          <svg viewBox="0 0 13 13"><path d={GRAPH_MARK} /></svg>
        </button>
      </div>
    {/if}
  </div>

  <!-- The one thing you can do from anywhere in the app. Outside the Search
       panel it is the door to it; inside, the panel's own field stands in the
       same place, at the same height and in the same box - one control that
       becomes editable rather than two that look alike.

       On the side the Search panel lives on, and only there: a door on one side
       that opens a panel on the other is a door that moves the reader's eye
       across the window for no reason. -->
  {#if showing !== 'search' && workspace.sideOf('search') === side}
    <div class="hunt" data-region={side === 'left' ? 'search' : undefined}>
      <button class="nib-field" onclick={() => workspace.showPanel('search')}>
        <svg class="nib-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
        <span class="nib-row-label">{t('Search this space')}</span>
      </button>
    </div>
  {/if}

  <!-- Rebuilt for each space, arriving from the side of the switcher the new
       space is on; and inside that, one panel crossing with the next. The two
       are stacked rather than in a column, so the one going and the one coming
       occupy the same place and the list under them does not jump; only their
       transforms and their opacities change, which is the compositor's work
       alone. -->
  {#key workspace.activeSpaceId}
    <div class="stack" in:fly={{ y: 16 * direction, duration: dur(220), easing: cubicOut }}>
      {#key showing}
        <!-- Which panel this is holding, because the body crossfades: for a moment
             there are two of it on screen and only one of them is the one that is
             arriving. See boxOf in focus.ts. -->
        <div
          class="body"
          data-region={side === 'left' ? 'list' : undefined}
          data-panel={showing}
          use:scrollbar={showing}
          use:pullable
          in:arrive
          out:leave
        >
          <!-- Which note the panel is held on. Only while it is held, and only
               where holding means anything: the panel is already full of that
               note, so this is the one line that says whose. -->
          {#if held && holdable}
            <p class="holding">{workspace.panelTab?.shown ?? ''}</p>
          {/if}

          {#if showing === 'tree'}
            {#if listing}
              <Bookmarks onsearch={runBookmarked} />

              <!-- A word in capitals over each group, the way every list worth
               reading is cut up; see docs/design.md. -->
              <p class="nib-section">{t('Files')}</p>

              <!-- The listing plus a row for every note an account's first pass has
                   named and not fetched yet, which is what makes a fresh sign-in a
                   file list rather than a wait; see `shownTree` in
                   workspace.svelte.ts. -->
              <Tree tree={listing} />

              <!-- A space with nothing in it says what to do about it. Folders can
             still be there, which is why this counts files and not rows. Nor is a
             space with notes on their way an empty one. -->
              {#if !workspace.files.length && !arriving.coming.size}
                <button class="empty" onclick={() => workspace.createNote()}>{t('New note')}</button
                >
              {/if}

              <!-- The space below the last row still belongs to the space, so it
             takes the same menu instead of swallowing the click, and accepts a
             note dropped on it as "out of whatever folder it was in". -->
              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
              <div
                class="rest"
                class:dropping={rootDrop}
                oncontextmenu={(event) => menu.show(event, spaceMenu(), titleOfSpace())}
                onclick={() => workspace.cancelNaming()}
                ondragover={overRoot}
                ondragleave={() => dropTarget.clear()}
                ondrop={dropOnRoot}
              ></div>
            {:else}
              <button class="empty" onclick={() => newSpace()}>{t('Create a space')}</button>
            {/if}
          {:else if showing === 'outline'}
            <!-- A page note has pages where a note has headings, and they are the
                 same thing: the shape of what is open, and a row that goes to a part
                 of it. So the panel shows whichever the thing in front has, in the
                 same place, rather than growing a fourth panel nobody asked for. -->
            {#if pages.current}
              <!-- Fetched the first time a page note is in front. It draws its
                   thumbnails with the surface's own ink engine - one picture of a
                   stroke - and that engine is the larger half of the canvas; see
                   surfaces.svelte.ts, where the pages surface itself is. -->
              {#await pagesNavigator() then PagesNavigator}
                <PagesNavigator />
              {/await}
            {:else if workspace.headings.length}
              <!-- The same walk and the same one tab stop every list in the app
                   has; see roving.ts. Enter goes to the heading and hands the
                   keyboard to the note, Space goes to it and stays here, so a note
                   can be read down heading by heading without leaving the outline. -->
              <ul
                bind:this={outline}
                use:roving={{
                  current: '.is-on',
                  open: (row) => jump(Number(row.dataset.line ?? 0)),
                  peek: (row) => {
                    // Going to a heading hands the note the keyboard, so Space takes
                    // it straight back: the point of Space is to stay here.
                    jump(Number(row.dataset.line ?? 0))
                    row.focus()
                  },
                  menu: (row, at) => row.dispatchEvent(at),
                }}
              >
                {#each workspace.headings as heading, index (index)}
                  <li>
                    <button
                      class="nib-row is-short row heading"
                      class:is-on={index === current}
                      class:above={dropAt === index && dropAbove}
                      class:below={dropAt === index && !dropAbove}
                      data-line={heading.line}
                      style:--level={heading.level - shallowest}
                      draggable="true"
                      onclick={() => jump(heading.line)}
                      oncontextmenu={(event) =>
                        menu.show(event, headingMenu(index, heading.text), { title: heading.text })}
                      use:longPress={(event) =>
                        menu.show(event, headingMenu(index, heading.text), { title: heading.text })}
                      ondragstart={(event) => startSection(event, index)}
                      ondragover={(event) => overSection(event, index)}
                      ondragleave={() => (dropAt = null)}
                      ondragend={endSection}
                      ondrop={(event) => dropSection(event, index)}
                    >
                      <span class="nib-row-label">{heading.text}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="empty-text">{t('No headings in this note')}</p>
            {/if}

            <!-- Under the headings, because they are the same kind of thing: the
                 shape of the note being read, and a row that jumps within it. Only
                 when the note has any; a heading over nothing is a wall. -->
            {#if workspace.footnotes.length}
              <p class="nib-section">{t('Footnotes')}<span>{workspace.footnotes.length}</span></p>
              <ul>
                {#each workspace.footnotes as note (note.id)}
                  <li>
                    <button
                      class="nib-row is-short row note"
                      class:is-quiet={!note.used}
                      onclick={() => jump(note.line)}
                    >
                      <span class="nib-row-mark note-id">{note.id}</span>
                      <span class="nib-row-label">{note.text}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if showing === 'footnotes'}
            <!-- The note's footnotes, on a panel of their own. The same rows the
                 Outline draws under its headings, plus the one thing a section inside
                 another panel had no room to offer: the definition. A footnote is two
                 things in two places, and this is the panel that reaches both - the row
                 goes to the mark in the words, the sign at its end to what it says at
                 the bottom. The count is in the heading, as it is in the Outline. -->
            <p class="nib-section">
              {t('Footnotes')}<span>{workspace.footnotes.length}</span>
            </p>
            {#if workspace.footnotes.length}
              <ul use:roving={{ rows: '.row', open: (row) => row.click() }}>
                {#each workspace.footnotes as note (note.id)}
                  <li class="footnote">
                    <button
                      class="nib-row is-short row note"
                      class:is-quiet={!note.used}
                      onclick={() => jump(note.line)}
                      title={note.used ? t('Go to the mark') : t('Nothing points at this one')}
                    >
                      <span class="nib-row-mark note-id">{note.id}</span>
                      <span class="nib-row-label">{note.text}</span>
                    </button>
                    {#if note.defined !== null}
                      <button
                        class="nib-glyph to-definition"
                        title={t('Go to the definition')}
                        aria-label={t('Go to the definition')}
                        onclick={() => jump(note.defined ?? 0)}
                      >
                        <svg viewBox="0 0 13 13"><path d={DOWN_MARK} /></svg>
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="empty-text">{t('No footnotes in this note')}</p>
            {/if}
          {:else if showing === 'links'}
            <Links {ongoto} graph={graphing} {depth} onlist={() => (graphing = false)} />
          {:else if showing === 'search'}
            <!-- The one panel with a ranking engine behind it, fetched the first time
                 the tab is chosen rather than carried into the first paint; see
                 surfaces.svelte.ts. Preloaded once the launch is over, so the tab
                 that is a keystroke away is never a wait. -->
            {#await searchPanel() then SearchPanel}
              <SearchPanel {ongoto} />
            {/await}
          {/if}
        </div>
      {/key}
    </div>
  {/key}

  <!-- Who is at this device, the theme and the settings, in a quiet row at the
       bottom of the panel: the three things the column of spaces used to carry
       under it, which belong to the app rather than to any one note. The same
       row on a desktop and in a drawer; see SidebarFoot.svelte.

       One row for the window, on the side that has always had it: two would be
       two accounts to read and two gears to press. -->
  {#if side === 'left'}
    <SidebarFoot />
  {/if}
</aside>

<style>
  aside {
    position: relative;
    width: var(--sidebar-width);
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-inline-end: 1px solid var(--line);
    background: var(--side-bar-bg-color);
  }

  /* The hairline belongs between the panel and the note, so on the right side it
     is the other edge. Nothing else about the panel changes: it is the same
     column of the same rows, which is the whole point of one component. */
  aside.right {
    border-inline-end: 0;
    border-inline-start: 1px solid var(--line);
  }

  /* Wider than the line it sits on, so it can be caught, and drawn only while
     it is being used: a handle that is always visible is a stripe. */
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-end: -4px;
    width: 8px;
    z-index: 2;
    cursor: col-resize;
  }

  /* The right side's handle faces the note too, which is its left edge. Both
     the strip and the hairline inside it go over. */
  aside.right .edge {
    inset-inline-end: auto;
    inset-inline-start: -4px;
  }

  aside.right .edge::after {
    inset-inline-start: auto;
    inset-inline-end: 3px;
  }

  .edge::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: 3px;
    width: 2px;
    background: transparent;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .edge:hover::after,
  aside.resizing .edge::after {
    background: var(--accent);
  }

  /* The three rows of chrome above the list, in the order identity, action,
     view. Each is `--space-1` in from the panel's edge and everything inside
     them is `--row-pad` in from that, so the words in the header, the words in
     the search pill and the marks in the rows below all start on one line down
     the panel; see docs/design.md. */
  /* Positioned, because the list of spaces drops out of it: the head spans the
     panel, so a list hung from it lines up with the search pill and the rows
     under it without anything being measured. See SpaceSwitcher.svelte. */
  .head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height);
    padding: 0 var(--space-1);
  }

  .new {
    flex: none;
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .new:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .new:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .hunt {
    flex: none;
    padding: 0 var(--space-1) var(--space-2);
  }

  /* The pill's words are the placeholder they stand in for; the magnifier is
     what says what it is. */
  .hunt .nib-row-label {
    color: var(--muted);
  }

  .switch {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-1) var(--space-2);
  }

  /* The tabs are the segmented control the settings sheet already uses: one
     shape, so "this one" looks the same wherever the app says it. */
  .switch .nib-segmented {
    flex: 1;
    min-width: 0;
  }

  /* And the tabs in it give way, which is the only thing in this row that can.
     A flex child will not shrink below what is in it unless it is told to, and a
     tab here is an icon with the shared control's own padding either side of it:
     five of those do not fit beside a panel's tools, so the control shrank and its
     tabs stayed the size they were - out of its box, over the tools, and with a
     z-index that made them win the press. Pressing the Links panel's depth stepper
     opened the Footnotes panel instead.
     How wide a shared shape is in the row it sits in is this file's to say; how it
     is drawn is not. See test/one-of-each.test.ts. */
  .switch .nib-segmented button {
    min-width: 0;
  }

  /* The mark in a tab is the one thing in the row that does not give: a squeezed
     row is one with narrower tabs in it, not one with smaller icons. */
  .switch .nib-segmented button svg {
    flex: none;
  }

  /* The tools keep their size: they are square glyph buttons, and a row that has
     to give somewhere gives from the tabs above. */
  .tools {
    flex: none;
  }

  /* At the far end of the row, so the tabs keep their place whether or not the
     panel showing has anything to offer. */
  /* The note a held panel is about, over the panel that is about it. Quiet: the
     panel says the same thing in more detail, and this is only here to say whose
     note that is. */
  .holding {
    margin: 0;
    padding: 0 var(--row-pad) var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }

  /* What is at the far end of the tab row is `.nib-glyph` in the themes package,
     the same square as every other icon button. They used to be drawn here with
     a width and no height and nothing said about padding, so each of them wore
     the browser's own `1px 6px` and stretched to the row; and their hover went
     to `--text` where every other glyph button's goes to `--text-strong`.
     What is left is the one that says a number rather than a mark. */
  .tools button {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .tools button.active {
    background: var(--surface-selected);
    color: var(--accent);
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  /* What is left of the panel once the head, the tabs and the search entry have
     had theirs - and the ground the panels cross over. Positioned, so the one
     going and the one coming can be in the same place for the moment they are
     both here; a column would put them one above the other and shove the list
     around. */
  .stack {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* A column so the filler below the tree can take the leftover height. */
  .body {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    /* A list that runs out of rows stops there, rather than handing the
       scroll on to whatever is behind the drawer. */
    overscroll-behavior: contain;
    padding: 0 var(--space-1) var(--space-4);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The row is `.nib-row`, drawn once in the themes package. Each level of the
     outline steps in and fades a little, and that is the whole hierarchy; both
     hang off `--level`, so a phone takes a deeper step without a second set of
     numbers in the markup. The tree is indented the same way. */
  .heading {
    position: relative;
    padding-inline-start: calc(var(--row-pad) + var(--level) * var(--row-indent));
    opacity: calc(1 - var(--level) * 0.09);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  /* A footnote's own label, in the mark's box so every one of them starts where
     a heading's words do. Raised and in the accent, which is how the note itself
     draws the mark this row stands for. */
  .note-id {
    align-self: start;
    margin-top: 0.3em;
    color: var(--accent);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  /* A footnote's row on its own panel: the words, and the sign that goes to what it
     says at the bottom. The sign sits at the end of the row rather than in it, quiet
     until the row is pointed at, because the row's own press is the one somebody came
     for - the mark in the words is where they were reading. */
  .footnote {
    display: flex;
    align-items: center;
  }

  .footnote .row {
    flex: 1;
    min-width: 0;
  }

  .to-definition {
    flex: none;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .footnote:hover .to-definition {
      opacity: 1;
    }
  }

  /* A finger has no hover, and a keyboard says where it is. */
  :global([data-touch]) .to-definition,
  .to-definition:focus-visible {
    opacity: 1;
  }

  /* Where a section being dragged would land: along the edge it arrives at,
     rather than a box around the row it is passing. The same line the bookmarks
     draw for a row on its way somewhere. */
  .heading.above::before,
  .heading.below::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .heading.above::before {
    top: -1px;
  }

  .heading.below::after {
    bottom: -1px;
  }

  .heading.is-on {
    opacity: 1;
  }

  /* Only where there is a pointer to hover with: on a touch screen the nudge
     would stick to whatever was tapped last. */
  @media (hover: hover) {
    .heading:hover {
      transform: translateX(calc(var(--dir) * 2px));
    }
  }

  /* Fills whatever is left, so the whole panel responds. */
  .rest {
    flex: 1;
    min-height: var(--space-6);
  }

  .empty-text {
    margin: var(--space-3) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  /* Says the drop will land, without pretending to be a row. */
  .rest.dropping {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: var(--radius-row);
    background: var(--accent-soft);
  }

  .empty {
    width: 100%;
    min-height: var(--row-height);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      border-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  .empty:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty:active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* One weight for every drawing in the panel; how big each is comes from what
     it is: a tab and a button wear `--icon-lg`, a mark beside words wears
     `--icon-md`, and the chevron after a name is the smallest of the three. */
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .switch svg,
  .new svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }

  /* A drawer is as wide as it needs to be to read a list of names in, and it
     is never dragged wider: there is no pointer to grab the edge with. */
  :global([data-drawer]) aside {
    width: min(78vw, 20rem);
  }

  :global([data-touch]) .edge {
    display: none;
  }

  /* Past this width the drawer is the whole screen rather than a panel over the
     note, and the panel is the whole of the drawer. Only where the sidebar is a
     drawer at all: `data-narrow` is the width alone, and a desktop window
     dragged this narrow keeps its columns. */
  :global([data-drawer][data-narrow]) aside {
    flex: 1;
    width: auto;
    min-width: 0;
    /* The whole screen, so it is a page of its own rather than a panel beside
       the note, and takes the note's ground rather than the lighter surface a
       panel has next to it. */
    background: var(--bg);
  }

  /* Docked beside the note on a tablet held sideways. It arrives rather than
     appears, and on the compositor: the column itself is not animated, because
     animating a width relays out the editor beside it on every frame.

     As wide as the drawer, rather than a pointer's 252px: every part of a panel
     read with a thumb is bigger, so the column holding them has to be. At the
     narrower width the foot's own name ran out of room before it was finished. */
  :global([data-touch]:not([data-drawer])) aside {
    width: 20rem;
    animation: dock var(--dur-base) var(--ease-out);
  }

  @keyframes dock {
    from {
      opacity: 0;
      transform: translateX(calc(var(--dir) * -12px));
    }
  }

  /* Clear of the status bar, the way the titlebar is on the other side. That is
     the whole of what a finger changes here: the header, the pill, the tabs and
     every row read the row scale, and the row scale is restated from the touch
     scale once, in tokens.css. */
  :global([data-touch]) .head {
    padding-top: var(--inset-top);
  }

  /* Room under the last row. What clears the gesture bar is the foot below
     this, which is the thing actually at the bottom of the screen. */
  :global([data-touch]) .body {
    padding-bottom: var(--space-4);
  }

  :global([data-touch]) .empty-text,
  :global([data-touch]) .empty {
    font-size: var(--touch-text);
  }
</style>
