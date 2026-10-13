<script lang="ts">
  /** The bookmarks above the file list: notes, folders, headings and searches, in
   *  the order they were put in and reorderable by dragging one over another.
   *
   *  Called Essentials on screen, Zen's word (Emil, 2026-10-13), and bookmarks in the
   *  code and in storage, so lists kept before are read as they were. The files are a
   *  grid of tiles, the rest rows under it; see essentials.ts.
   *
   *  A bookmark keeps a path the space speaks, so a note or folder that has
   *  since been deleted simply has no row. A search points at nothing on disk
   *  and is always there. */
  import { flip } from 'svelte/animate'
  import { cubicOut } from 'svelte/easing'
  import { scale } from 'svelte/transition'
  import { door } from '@nib/markdown/door'
  import BookmarkTile from './BookmarkTile.svelte'
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import { bookmarkEntry, DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import { dur } from './motion'
  import Twist from './Twist.svelte'
  import { longPress } from './longpress'
  import { howFor, middleOpens, type OpenHow, type TabAsk, tabAsk } from './new-tab'
  import { roving } from './roving'
  import { GRAPH_MARK, SEARCH_MARK } from './panel-marks'
  import { rowName } from './note-name'
  import { carryBookmark, draggedBookmark } from './drag-paths'
  import { insideSpace, samePath } from './space-paths'
  import { type Bookmark, isTile, sameBookmark } from './workspace/bookmarks.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'

  const { onsearch }: { onsearch: (query: string) => void } = $props()

  interface Row {
    mark: Bookmark
    /** Where it sits in the list, which is what a drag moves. */
    at: number
    /** How many groups deep, which is how far the row steps in. */
    depth: number
    label: string
    /** The note a heading is in, shown muted after it. Null on every other kind. */
    note: string | null
    /** The file the row opens, or the folder it shows. Null for a search. */
    path: string | null
    /** The mark in front of the name, so a bookmark reads as the same kind of
     *  thing it is in the tree below. Null for a search, which wears the
     *  magnifier instead. */
    kind: Mark | null
    active: boolean
  }

  const byPath = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const found = new Map<string, Entry>()

    const walk = (entries: Entry[]) => {
      for (const entry of entries) {
        found.set(entry.path, entry)
        if (entry.children.length) walk(entry.children)
      }
    }

    if (workspace.tree) walk(workspace.tree.children)
    return found
  })

  /** One bookmark as a row, or nothing where there is nothing left to point at:
   *  a note that has gone from the space simply has no row. */
  function rowFor(mark: Bookmark, at: number, depth: number, root: string): Row | null {
    const shared = { mark, at, depth }

    if (mark.kind === 'group' || mark.kind === 'search' || mark.kind === 'graph') {
      return { ...shared, label: mark.text, note: null, path: null, kind: null, active: false }
    }

    // A block bookmark carries the whole of what a link into it would say, so the
    // note is the part in front of the `#`; see forBlock in bookmarks.svelte.ts.
    const inside = mark.kind === 'block' ? (mark.path.split('#')[0] ?? '') : mark.path
    const entry = byPath.get(insideSpace(root, inside))
    if (!entry) return null

    const named = mark.kind === 'heading' || mark.kind === 'block'
    return {
      ...shared,
      label: named ? mark.text : rowName(entry.name, entry.is_dir),
      note: named ? rowName(entry.name, entry.is_dir) : null,
      path: entry.path,
      // The mark the file list gives the same row: a folder that a reader
      // bookmarked is a folder with no note of its own - one nib nested would have
      // been bookmarked as its note - so it wears the page with nothing written on
      // it, quietly, exactly as it does in the tree. See file-mark.ts.
      kind: entry.is_dir ? 'file' : fileMark(entry.name),
      // An essential is open while its own tab is in front.
      active:
        !entry.is_dir &&
        (mark.kind === 'note'
          ? samePath(workspace.active?.essential ?? null, entry.path)
          : workspace.active?.path === entry.path),
    }
  }

  /** The list as it is drawn: the top of it in the order it is kept, and under
   *  every open group the rows that say they are in it. One walk over a flat list
   *  rather than a tree of lists, because the order of the list is the order of
   *  the list; see bookmarks.svelte.ts. */
  const drawn = $derived.by((): Row[] => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []

    const list = workspace.bookmarks.list
    const out: Row[] = []

    const walk = (parent: string | undefined, depth: number) => {
      for (const [at, mark] of list.entries()) {
        if ((mark.parent ?? undefined) !== parent) continue

        const row = rowFor(mark, at, depth, root)
        if (!row) continue

        out.push(row)
        if (mark.kind === 'group' && workspace.isGroupOpen(mark.path)) walk(mark.path, depth + 1)
      }
    }

    walk(undefined, 0)
    return out
  })

  /** The tiles, where the grid is the look, and the rows under them. */
  const tiles = $derived(
    workspace.device.essentialTiles ? drawn.filter((row) => isTile(row.mark)) : [],
  )
  const rows = $derived(
    workspace.device.essentialTiles ? drawn.filter((row) => !isTile(row.mark)) : drawn,
  )

  /** A tab carried out of the strip that could be a first tile, which the grid keeps
   *  an empty place for while there is none. */
  const offered = $derived.by(() => {
    if (!workspace.device.essentialTiles) return false

    const id = workspace.panes.dragging?.tabId
    const path = id ? workspace.tabs.find((one) => one.id === id)?.path : null
    const mark = path ? workspace.bookmarks.forEntry({ path, is_dir: false }) : null
    return mark !== null && !workspace.bookmarks.has(mark)
  })

  /** What a drag, a key or a drop over the tiles reckons with, fetched as the pointer,
   *  a drag or the keyboard first comes to the bookmarks rather than in front of the
   *  first paint; until it lands, the grid's own keys and lines wait for it. */
  const reckoning = door(() => import('./essentials.svelte'))
  let hands = $state.raw<typeof import('./essentials.svelte') | null>(null)
  const reach = () => {
    if (!hands) void reckoning().then((one) => (hands = one))
  }
  // A drag out of the file list or the strip holds the pointer, so nothing here hears
  // it arrive; it is asked for as the drag starts.
  $effect(() => {
    if (workspace.panes.dragging) reach()
  })
  const landing = $derived(hands?.landing ?? null)

  /** Which row is being dragged. Kept here as well as in the drag itself
   *  because what a drag carries is sealed until it is dropped: while it is
   *  moving, a page may ask what kinds of thing it holds and not what they
   *  are, and the line showing where it would land has to know which way it
   *  came from. */
  let dragging = $state<number | null>(null)

  /** A row pressed: a look on one click, kept on two, and in a tab of its own with a
   *  modifier or the middle button - which only a row naming a note has; see
   *  new-tab.ts. */
  function open(row: Row, how: OpenHow) {
    const mark = row.mark

    switch (mark.kind) {
      case 'note':
        if (row.path) void workspace.openEntry(row.path, how)
        break
      case 'folder':
        if (row.path) workspace.revealFolder(row.path)
        break
      case 'heading':
        void workspace.openAtHeading(mark.path, mark.text, how)
        break
      case 'search':
        onsearch(mark.text)
        break
      case 'block':
        void workspace.openAtBlock(mark.path, how)
        break
      case 'group':
        workspace.toggleGroup(mark.path)
        break
      case 'graph':
        // The space keeps one picture and this is a way of looking at it, so the
        // view is written into the space's own settings and the graph is opened.
        // Every surface that draws a graph then reads one answer, which is what
        // it did before there were views; see workspace/graph-settings.svelte.ts.
        workspace.graphSettings.take(mark.view)
        workspace.openGraph()
        break
    }
  }

  /** A plain press shows an essential in place; one asking for a tab gets one. */
  function pressed(row: Row, ask: TabAsk) {
    if (row.mark.kind === 'note' && row.path) {
      const path = row.path
      void reckoning().then((one) =>
        ask === 'plain' ? one.openEssential(path) : one.openInStrip(path, howFor(ask)),
      )
      return
    }

    open(row, howFor(ask, { preview: true }))
  }

  function startDrag(event: DragEvent, row: Row) {
    reach()
    carryBookmark(event.dataTransfer, row.at)
    dragging = row.at
  }

  function endDrag() {
    landing?.clear()
    dragging = null
  }

  function over(event: DragEvent, row: Row) {
    if (!hands?.takes(event)) return

    // The line marks the edge the row would arrive at, which is the near side
    // of the target: its top when the row is coming down the list, its bottom
    // when it is going up.
    landing?.over(row.at, dragging !== null && dragging < row.at)
  }

  function drop(event: DragEvent, row: Row) {
    event.preventDefault()

    const after = landing?.after ?? false
    if (hands?.keepCarried(event, after ? row.at + 1 : row.at, (path) => byPath.get(path))) {
      endDrag()
      return
    }

    const from = draggedBookmark(event.dataTransfer)
    endDrag()
    if (from === null) return

    const moving = workspace.bookmarks.list[from]
    if (!moving) return

    // Onto a group is into it; anywhere else is beside the row it landed on, in
    // whatever that row is in - so a row dropped between two rows of a group
    // joins the group, which is what the line drawn there said it would do.
    if (row.mark.kind === 'group' && !sameBookmark(moving, row.mark)) {
      workspace.bookmarks.moveInto(moving, row.mark.path)
      workspace.openGroup(row.mark.path)
      return
    }

    workspace.bookmarks.moveInto(moving, row.mark.parent ?? null)
    workspace.bookmarks.move(from, row.at)
  }

  /** What the menu is about, for the sheet a phone heads its menus with. */
  const titleOf = (row: Row) => (row.mark.kind === 'search' ? t('Search') : row.label)

  /** What a row offers: keeping or dropping the bookmark, a new group to sort
   *  them into, and - for a group - the two things only a group can do. Removing
   *  a group keeps what was in it; see remove in bookmarks.svelte.ts. */
  function rowMenu(row: Row): MenuEntry[] {
    const group = row.mark.kind === 'group'

    return [
      ...(row.mark.kind === 'note' && row.path
        ? [{ label: t('Open in new tab'), run: () => pressed(row, 'front') }, DIVIDER]
        : []),
      ...(group
        ? [
            { label: t('Rename'), run: () => void renameGroup(row.mark) },
            { label: t('Remove group'), run: () => workspace.bookmarks.remove(row.mark) },
          ]
        : bookmarkEntry(row.mark)),
      ...(row.mark.parent
        ? [
            {
              label: t('Out of the group'),
              run: () => workspace.bookmarks.moveInto(row.mark, null),
            },
          ]
        : []),
      DIVIDER,
      { label: t('New group'), run: () => void newGroup() },
    ]
  }

  const showMenu = (event: MouseEvent, row: Row) =>
    menu.show(event, rowMenu(row), { title: titleOf(row) })

  async function newGroup() {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.ask({ title: t('New group'), confirmLabel: t('Make') })
    if (name) workspace.bookmarks.addGroup(name)
  }

  async function renameGroup(mark: Bookmark) {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.ask({
      title: t('Rename'),
      value: mark.text,
      confirmLabel: t('Rename'),
    })
    if (name) workspace.bookmarks.rename(mark, name)
  }

  const rowAt = (element: HTMLElement) => drawn.find((one) => one.at === Number(element.dataset.at))
</script>

{#if drawn.length || offered}
  <!-- One tab stop for the tiles and the rows together, and the arrows inside it, the
       same as every other list in the app; see roving.ts. Enter opens and the note
       takes the keyboard, Space opens and leaves the keyboard here. -->
  <div
    class="bookmarks"
    onpointerenter={reach}
    onfocusin={reach}
    ondragenter={reach}
    use:roving={{
      current: '.is-on',
      rows: '.tile, .row',
      label: (element) => element.getAttribute('aria-label') ?? element.textContent,
      sideways: (key, element) => {
        if (element.classList.contains('tile')) return hands?.along(key, element) ?? false

        const row = rowAt(element)
        if (row?.mark.kind !== 'group') return false

        const open = workspace.isGroupOpen(row.mark.path)
        if (key === 'ArrowRight' && !open) workspace.toggleGroup(row.mark.path)
        else if (key === 'ArrowLeft' && open) workspace.toggleGroup(row.mark.path)
        else return false

        return true
      },
      remove: (element) => {
        const row = rowAt(element)
        if (row) workspace.bookmarks.remove(row.mark)
      },
      open: (element) => element.click(),
      peek: (element) => {
        element.click()
        element.focus()
      },
      menu: (element, at) => element.dispatchEvent(at),
    }}
  >
    {#if tiles.length || offered}
      <!-- Zen's grid; a tab carried over it is asked about in tab-strip/bookmark-drop.ts.
           Its keys and drops are its tiles'. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <ul
        class="nib-tiles tiles"
        class:is-taking={(landing?.at ?? null) !== null && !tiles.length}
        data-bookmark-drop
        aria-label={t('Essentials')}
        onkeydown={(event) => hands?.gridKey(event)}
        ondragover={(event) => hands?.overGrid(event)}
        ondragleave={(event) => hands?.leaving(event)}
        ondrop={(event) => hands?.dropOnGrid(event, (path) => byPath.get(path))}
      >
        {#each tiles as tile (`${tile.mark.kind}:${tile.mark.path}`)}
          <li
            animate:flip={{ duration: dur(150), easing: cubicOut }}
            in:scale={{ start: 0.9, duration: dur(150), easing: cubicOut }}
          >
            <BookmarkTile
              path={tile.path ?? ''}
              name={tile.label}
              mark={tile.kind ?? 'note'}
              active={tile.active}
              slot={landing?.at === tile.at ? (landing.after ? 'after' : 'before') : null}
              data-at={tile.at}
              onopen={(ask: TabAsk) => pressed(tile, ask)}
              onmenu={(event: MouseEvent) => showMenu(event, tile)}
              ondragstart={(event: DragEvent) => startDrag(event, tile)}
              ondragend={endDrag}
            />
          </li>
        {:else}
          <li class="is-empty" aria-hidden="true"></li>
        {/each}
      </ul>
    {/if}

    {#if rows.length}
      <p class="nib-section">{t('Essentials')}</p>

      <ul class="list" data-bookmark-drop={workspace.device.essentialTiles ? undefined : ''}>
        {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
          <!-- Whether a group is showing what is in it, once rather than twice. -->
          {@const showing = workspace.isGroupOpen(row.mark.path)}
          {@const lands = landing?.at === row.at}
          <li>
            <!-- A group's twist and its name are two buttons rather than one,
                 because they do two things: opening a group is not renaming it. The
                 shape is the tag tree's, which answers the same question one panel
                 along. -->
            <div class="line">
              {#if row.mark.kind === 'group'}
                <button
                  class="twist"
                  style:--level={row.depth}
                  aria-expanded={showing}
                  aria-label={row.label}
                  onclick={() => workspace.toggleGroup(row.mark.path)}
                >
                  <span class="chevron"><Twist open={showing} /></span>
                </button>
              {/if}
              <button
                class="nib-row row"
                class:is-quiet={row.mark.kind === 'folder'}
                class:is-on={row.active}
                class:above={lands && !landing.after}
                class:below={lands && landing.after}
                class:nested={row.mark.kind !== 'group'}
                style:--level={row.depth}
                data-at={row.at}
                draggable="true"
                onclick={(event) => pressed(row, tabAsk(event))}
                ondblclick={(event) =>
                  tabAsk(event) === 'plain' && row.mark.kind !== 'note' && open(row, {})}
                use:middleOpens={(event) => pressed(row, tabAsk(event))}
                oncontextmenu={(event) => showMenu(event, row)}
                use:longPress={(event) => showMenu(event, row)}
                ondragstart={(event) => startDrag(event, row)}
                ondragover={(event) => over(event, row)}
                ondragleave={(event) => hands?.leaving(event)}
                ondragend={endDrag}
                ondrop={(event) => drop(event, row)}
              >
                <!-- Every row wears one, so every name in the panel starts at the
                     same place: the kind the file is in the tree below, the
                     magnifier for a search, which points at no file at all, and
                     nothing at all for a group, whose twist is in front of it. -->
                {#if row.kind && row.path}
                  <FileMark mark={row.kind} path={row.path} />
                {:else if row.kind}
                  <FileMark mark={row.kind} />
                {:else if row.mark.kind === 'graph'}
                  <!-- The graph's own mark, which is what its tab and its command
                       already wear: a view of the space reads as the space's picture
                       rather than as a search. -->
                  <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={GRAPH_MARK} /></svg>
                {:else if row.mark.kind !== 'group'}
                  <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
                {/if}
                <span class="nib-row-label">{row.label}</span>
                {#if row.note}<span class="nib-row-meta">{row.note}</span>{/if}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .list {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
  }

  /* The row is `.nib-row`, drawn in the themes package. What is left here is the
     line saying where a dragged row would land: along the edge it arrives at,
     rather than a box around the row it is passing. */
  /* The twist and the name, side by side. */
  .line {
    display: flex;
    align-items: center;
  }

  .twist {
    flex: none;
    min-height: var(--row-height-sm);
    display: flex;
    align-items: center;
    padding-inline-start: calc(var(--space-1) + var(--level, 0) * var(--row-indent));
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
  }

  .chevron {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  /* One step in per group, and in front of the name the width of a twist: held
     empty for a row that has none, so every name in the list starts at the same
     place. The tag tree does the same thing one panel along. */
  .row {
    --lead: 2px;

    position: relative;
    flex: 1;
    min-width: 0;
    padding-inline-start: calc(var(--level, 0) * var(--row-indent) + var(--lead));
  }

  .row.nested {
    --lead: calc(var(--icon-md) + var(--space-1));
  }

  .row.above::before,
  .row.below::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .row.above::before {
    top: -1px;
  }

  .row.below::after {
    bottom: -1px;
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.8;
  }
</style>
