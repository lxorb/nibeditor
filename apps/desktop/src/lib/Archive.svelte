<script lang="ts">
  /** What the space has put away, at the foot of the file list: the way the bookmarks
   *  sit at its head, and the way Bear keeps its Archive at the foot of its notes.
   *  Drawn only while something is archived, and shut until somebody opens it.
   *
   *  One row per thing put away, the last put away first, each saying the folder it
   *  came out of - which is where it goes back to. An archived folder unfolds to what
   *  it holds. A press opens the row as the file list's would; the mark at its end,
   *  and its menu, take it back out. Nothing here deletes: an archived row is never
   *  deleted, and Delete on one does nothing. See archiving.ts and docs/archive.md. */
  import { flip } from 'svelte/animate'
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { standing } from './archive-plan'
  import { archiveList } from './archive-list.svelte'
  import { archive, unarchive } from './archiving'
  import { carriedRows, isTreeDrag } from './drag-paths'
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { folderNote, nestedIn } from './folder-notes'
  import { t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
  import { dur } from './motion'
  import { howFor, middleOpens, type OpenHow, tabAsk } from './new-tab'
  import { rowName } from './note-name'
  import { UNARCHIVE_MARK } from './archive-marks'
  import { roving } from './roving'
  import { folderOf, insideSpace } from './space-paths'
  import Twist from './Twist.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'

  interface Row {
    entry: Entry
    /** How many archived folders deep, which is how far the row steps in. */
    depth: number
    /** The folder it came out of, for a row put away on its own; null inside a
     *  folder that was, where the folder above already says it. */
    from: string | null
    /** What the row wears: the note a folder is drawn as, where it has one. */
    mark: Mark
    markPath: string
    /** Whether it holds rows to unfold. */
    holds: boolean
  }

  /** A folder's rows in the order a reader expects when nobody arranged them. */
  const byName = (one: Entry, other: Entry) =>
    Number(other.is_dir) - Number(one.is_dir) || one.name.localeCompare(other.name)

  function rowOf(entry: Entry, depth: number, from: string | null): Row {
    const own = folderNote(entry)
    return {
      entry,
      depth,
      from,
      mark: own ? fileMark(own.name) : entry.is_dir ? 'file' : fileMark(entry.name),
      markPath: own?.path ?? entry.path,
      holds: entry.is_dir && nestedIn(entry).length > 0,
    }
  }

  const rows = $derived.by((): Row[] => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []

    const map = workspace.archive.of(root)
    const out: Row[] = []

    const walk = (entry: Entry, depth: number) => {
      if (!archiveList.isUnfolded(entry.path)) return
      for (const child of [...nestedIn(entry)].sort(byName)) {
        const row = rowOf(child, depth, null)
        out.push(row)
        if (row.holds) walk(child, depth + 1)
      }
    }

    const newest = standing(workspace.archive.keysOf(root)).sort(
      (one, other) => (map[other] ?? 0) - (map[one] ?? 0),
    )
    for (const at of newest) {
      // A row the space has archived and this machine has not got: removed behind
      // the app's back, or not fetched yet. There is nothing to open.
      const entry = workspace.entryAt(insideSpace(root, at))
      if (!entry) continue

      const row = rowOf(entry, 0, folderOf(at) || null)
      out.push(row)
      if (row.holds) walk(entry, 1)
    }

    return out
  })

  /** Top-level rows only: what the header counts. */
  const count = $derived(rows.filter((row) => row.depth === 0).length)

  function open(row: Row, how: OpenHow) {
    if (row.entry.is_dir && !folderNote(row.entry)) {
      archiveList.unfold(row.entry.path)
      return
    }

    void workspace.openRow(row.entry.path, how)
  }

  function rowMenu(row: Row): MenuEntry[] {
    const path = row.entry.path

    return [
      { label: t('Open'), run: () => void workspace.openRow(path) },
      { label: t('Open in new tab'), run: () => void workspace.openRow(path, howFor('behind')) },
      DIVIDER,
      { label: t('Unarchive'), run: () => unarchive(path) },
    ]
  }

  /** The row a reveal asked for, scrolled to once the list is open and drawn. */
  let list = $state<HTMLElement | null>(null)
  $effect(() => {
    const wanted = archiveList.showing
    if (!wanted || !list || !archiveList.open) return

    archiveList.showing = null
    const at = rows.findIndex((row) => row.entry.path === wanted)
    list.querySelectorAll<HTMLElement>('.row')[at]?.scrollIntoView({ block: 'nearest' })
  })

  /** Rows of the file list dragged onto the archive's head are put away: the same
   *  gesture as the menu's, where the archive is. */
  let dropping = $state(false)

  function over(event: DragEvent) {
    if (!isTreeDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropping = true
  }

  function dropped(event: DragEvent) {
    dropping = false
    const carried = carriedRows(event.dataTransfer)
    if (!carried.length) return

    event.preventDefault()
    archive(carried)
  }
</script>

{#if count}
  <button
    class="nib-section archive-head"
    class:dropping
    aria-expanded={archiveList.open}
    onclick={() => archiveList.toggle()}
    ondragover={over}
    ondragleave={() => (dropping = false)}
    ondrop={dropped}
  >
    {t('Archived')}
    <span class="tail">
      {count}
      <span class="chevron"><Twist open={archiveList.open} /></span>
    </span>
  </button>

  {#if archiveList.open}
    <!-- One tab stop and the arrows inside it, like every other list; see roving.ts.
         No `remove`: an archived row is never deleted. -->
    <ul
      bind:this={list}
      transition:slide={{ duration: dur(150), easing: cubicOut }}
      use:roving={{
        rows: '.row',
        open: (element) => element.click(),
        peek: (element) => {
          element.click()
          element.focus()
        },
        menu: (element, at) => element.dispatchEvent(at),
      }}
    >
      {#each rows as row (row.entry.path)}
        <li
          animate:flip={{ duration: dur(150) }}
          transition:slide={{ duration: dur(150), easing: cubicOut }}
        >
          <div class="line" class:holds={row.holds}>
            <button
              class="nib-row row"
              class:is-on={workspace.active?.path === row.markPath}
              style:--level={row.depth}
              onclick={(event) => open(row, howFor(tabAsk(event), { preview: true }))}
              ondblclick={(event) => tabAsk(event) === 'plain' && open(row, {})}
              use:middleOpens={(event) => open(row, howFor(tabAsk(event)))}
              oncontextmenu={(event) =>
                menu.show(event, rowMenu(row), {
                  title: rowName(row.entry.name, row.entry.is_dir),
                })}
              use:longPress={(event) =>
                menu.show(event, rowMenu(row), {
                  title: rowName(row.entry.name, row.entry.is_dir),
                })}
            >
              <FileMark mark={row.mark} path={row.markPath} />
              <span class="nib-row-label">{rowName(row.entry.name, row.entry.is_dir)}</span>
              {#if row.from}<span class="nib-row-meta">{row.from}</span>{/if}
            </button>

            {#if row.holds}
              <button
                class="end twist"
                aria-expanded={archiveList.isUnfolded(row.entry.path)}
                aria-label={rowName(row.entry.name, row.entry.is_dir)}
                onclick={() => archiveList.unfold(row.entry.path)}
              >
                <Twist open={archiveList.isUnfolded(row.entry.path)} />
              </button>
            {/if}

            <!-- Taking it back, one press away where the pointer already is, over the
                 row's end so every name keeps its column; the menu says it in a word. -->
            <button
              class="end back"
              title={t('Unarchive')}
              aria-label={t('Unarchive')}
              onclick={() => unarchive(row.entry.path)}
            >
              <svg viewBox="0 0 13 13"><path d={UNARCHIVE_MARK} /></svg>
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .archive-head {
    width: 100%;
    border: none;
    background: none;
    text-align: start;
    cursor: default;
  }

  .archive-head:hover {
    color: var(--text);
  }

  .archive-head.dropping {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: var(--radius-row);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .tail {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .chevron {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  ul {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    overflow: hidden;
  }

  .line {
    position: relative;
    display: flex;
    align-items: center;
  }

  .row {
    flex: 1;
    min-width: 0;
    padding-inline-start: calc(var(--row-pad) + var(--level, 0) * var(--row-indent));
  }

  /* The marks at the end of a row, over its trailing edge rather than beside it, so
     every name in the list keeps the column the file list reads in. */
  .end {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    padding: calc((var(--row-height-sm) - var(--icon-sm)) / 2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .end:hover {
    color: var(--text);
  }

  .end:active {
    transform: scale(0.94);
  }

  /* The way back shows where the pointer is, and always under a finger, over the end
     of the row and in front of a twist where the row has one. */
  .back {
    position: absolute;
    inset-inline-end: 0;
    background: var(--side-bar-bg-color);
    opacity: 0;
  }

  .line:hover .back {
    background: var(--item-hover-bg-color);
  }

  .line.holds .back {
    inset-inline-end: var(--row-height-sm);
  }

  .line:hover .back,
  .line:focus-within .back,
  :global([data-touch]) .back {
    opacity: 1;
  }

  svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
