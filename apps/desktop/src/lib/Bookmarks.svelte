<script lang="ts">
  /** The row of bookmarks above the file list: notes, folders, headings and
   *  searches, in the order they were put in and reorderable by dragging one
   *  over another.
   *
   *  A bookmark keeps a path the space speaks, so a note or folder that has
   *  since been deleted simply has no row. A search points at nothing on disk
   *  and is always there. */
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import { bookmarkEntry, DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import Twist from './Twist.svelte'
  import { longPress } from './longpress'
  import { roving } from './roving'
  import { GRAPH_MARK, SEARCH_MARK } from './panel-marks'
  import { rowName } from './note-name'
  import { carryBookmark, draggedBookmark, isBookmarkDrag } from './drag-paths'
  import { insideSpace } from './space-paths'
  import { type Bookmark, sameBookmark } from './workspace/bookmarks.svelte'
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
      active: !entry.is_dir && workspace.active?.path === entry.path,
    }
  }

  /** The list as it is drawn: the top of it in the order it is kept, and under
   *  every open group the rows that say they are in it. One walk over a flat list
   *  rather than a tree of lists, because the order of the list is the order of
   *  the list; see bookmarks.svelte.ts. */
  const rows = $derived.by((): Row[] => {
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

  /** The row a drop would land on, and whether the line showing that sits above
   *  it or below: above when the row being dragged comes from further down. */
  let dropAt = $state<number | null>(null)
  let dropAbove = $state(false)
  /** Which row is being dragged. Kept here as well as in the drag itself
   *  because what a drag carries is sealed until it is dropped: while it is
   *  moving, a page may ask what kinds of thing it holds and not what they
   *  are, and the line showing where it would land has to know which way it
   *  came from. */
  let dragging = $state<number | null>(null)

  function open(row: Row, preview: boolean) {
    const mark = row.mark

    switch (mark.kind) {
      case 'note':
        if (row.path) void workspace.openEntry(row.path, preview ? { preview: true } : {})
        break
      case 'folder':
        if (row.path) workspace.revealFolder(row.path)
        break
      case 'heading':
        void workspace.openAtHeading(mark.path, mark.text)
        break
      case 'search':
        onsearch(mark.text)
        break
      case 'block':
        void workspace.openAtBlock(mark.path)
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

  function startDrag(event: DragEvent, row: Row) {
    carryBookmark(event.dataTransfer, row.at)
    dragging = row.at
  }

  function endDrag() {
    dropAt = null
    dragging = null
  }

  function over(event: DragEvent, row: Row) {
    if (!isBookmarkDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    dropAt = row.at
    // The line marks the edge the row would arrive at, which is the near side
    // of the target: its top when the row is coming down the list, its bottom
    // when it is going up.
    dropAbove = dragging !== null && dragging > row.at
  }

  function drop(event: DragEvent, row: Row) {
    event.preventDefault()

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
</script>

{#if rows.length}
  <p class="nib-section">{t('Bookmarks')}</p>

  <!-- One tab stop for the whole list, and the arrows inside it, the same as every
       other list in the app; see roving.ts. Enter opens and the note takes the
       keyboard, Space opens and leaves the keyboard here. -->
  <ul
    use:roving={{
      current: '.is-on',
      rows: '.row',
      sideways: (key, element) => {
        const row = rows.find((one) => one.at === Number(element.dataset.at))
        if (row?.mark.kind !== 'group') return false

        const open = workspace.isGroupOpen(row.mark.path)
        if (key === 'ArrowRight' && !open) workspace.toggleGroup(row.mark.path)
        else if (key === 'ArrowLeft' && open) workspace.toggleGroup(row.mark.path)
        else return false

        return true
      },
      remove: (element) => {
        const row = rows.find((one) => one.at === Number(element.dataset.at))
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
    {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
      <!-- Whether a group is showing what is in it, once rather than twice. -->
      {@const showing = workspace.isGroupOpen(row.mark.path)}
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
            class:above={dropAt === row.at && dropAbove}
            class:below={dropAt === row.at && !dropAbove}
            class:nested={row.mark.kind !== 'group'}
            style:--level={row.depth}
            data-at={row.at}
            draggable="true"
            onclick={() => open(row, true)}
            ondblclick={() => open(row, false)}
            oncontextmenu={(event) => menu.show(event, rowMenu(row), { title: titleOf(row) })}
            use:longPress={(event) => menu.show(event, rowMenu(row), { title: titleOf(row) })}
            ondragstart={(event) => startDrag(event, row)}
            ondragover={(event) => over(event, row)}
            ondragleave={() => (dropAt = null)}
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
            {#if row.path !== null && workspace.leftOut.isArchived(row.path)}
              <!-- A bookmark still opens what it points at, even once that has been put away:
               the archive hides things from the lists that speak for the space, and a
               bookmark is the reader saying they want this one. So the row stays and wears
               the word, which is why the row is not simply missing. -->
              <span class="nib-row-meta">{t('Archived')}</span>
            {/if}
            {#if row.note}<span class="nib-row-meta">{row.note}</span>{/if}
          </button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
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
