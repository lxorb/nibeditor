<script lang="ts">
  /** The list layout: the view's groups, each a head with its count and its rows, the
   *  sub-tasks under their parents, and an add row at the end (docs/tasks.md 5.9).
   *
   *  Every item is one row tall, so the list keeps a window of what is on screen and a
   *  Logbook of ten thousand lines mounts thirty (row-window.ts). The keyboard walks
   *  the rows and every key of row-keys.ts works on the one it is on. A row carried
   *  onto another group is written into it; onto another task of its own note, it
   *  moves its lines there. */
  import { groupName, type Row, rowId, type Value } from '@nib/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { currentPlatform } from '../keys'
  import { ListView, tokenRow } from '../row-window.svelte'
  import { windowFor } from '../row-window'
  import Twist from '../Twist.svelte'
  import { samePath } from '../space-paths'
  import { viewport } from '../viewport.svelte'
  import { moveBeside, writeRows } from './act'
  import AddRow from './AddRow.svelte'
  import { droppable, type Point } from './drag.svelte'
  import { type Kit, runKey } from './kit'
  import { EMPTY, listItems, toggled } from './list-items'
  import { rowKey } from './row-keys'
  import RowLine from './RowLine.svelte'
  import { groupLabel } from './words'

  const {
    kit,
    dated = true,
    where = true,
  }: {
    kit: Kit
    /** Whether a row says its date: not where the groups are the days. */
    dated?: boolean
    /** Whether a row says which note it is in: not in a project's own view. */
    where?: boolean
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const property = $derived(view?.groupBy?.property)

  /** Groups folded, and parents whose sub-tasks are folded: replaced whole on each
   *  press (`toggled`), so plain state is all they need. */
  let folded = $state.raw<ReadonlySet<string>>(EMPTY)
  let shut = $state.raw<ReadonlySet<string>>(EMPTY)
  let selected = $state<string | null>(null)
  /** The add row Q asked for, by group name, and how many times; see AddRow's `asked`. */
  let adding = $state({ group: '', count: 0 })

  const items = $derived(
    listItems(live.answer?.groups ?? [], {
      grouped: property !== undefined,
      folded,
      shut,
      hidden: view?.nib.hidden ?? [],
      adding: true,
    }),
  )
  const rows = $derived(items.flatMap((item) => (item.kind === 'row' ? [item] : [])))

  let list = $state<HTMLElement>()
  const win = new ListView()
  $effect(() => {
    const box = list
    if (!box) return
    const touch = viewport.touch
    return untrack(() => win.follow(box, () => tokenRow(touch)))
  })
  const shown = $derived(
    windowFor({
      count: items.length,
      height: win.row || 28,
      top: win.top,
      room: win.room || 600,
      overscan: 8,
      pinned: selected === null ? [] : [items.findIndex((item) => item.id === selected)],
    }),
  )

  /** A row let go over another row: within its own note, its lines move beside that
   *  one's; anywhere else, it joins that row's group. */
  function landOnRow(target: Row, key: Value, carried: Row, at: Point, box: HTMLElement) {
    if (carried === target) return
    const rect = box.getBoundingClientRect()
    const after = at.y > rect.top + rect.height / 2
    const sameNote = carried.space === target.space && samePath(carried.path, target.path)
    if (carried.task && target.task && sameNote && property !== 'formula.overdue') {
      const sameGroup = groupOf(carried) === groupName(key)
      if (sameGroup || property === undefined || property === 'task.section') {
        void moveBeside(carried, target, after)
        return
      }
    }
    if (property !== undefined) kit.drop(carried, key)
  }

  function groupOf(row: Row): string | null {
    const found = rows.find((one) => one.row === row)
    return found ? groupName(found.group.key) : null
  }

  function keydown(event: KeyboardEvent) {
    const key = rowKey(event, currentPlatform() === 'mac')
    if (!key) return
    const at = rows.findIndex((one) => one.id === selected)
    if (key.kind === 'add') {
      event.preventDefault()
      const row = rows[at]
      adding = { group: row ? groupName(row.group.key) : '', count: adding.count + 1 }
      return
    }
    if (key.kind === 'step') {
      event.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + key.by))]
      if (next) select(next.id)
      return
    }
    const row = rows[at]?.row
    if (row && runKey(kit, row, key)) event.preventDefault()
  }

  function select(id: string) {
    selected = id
    queueMicrotask(() =>
      list?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"] [role=option]`)?.focus(),
    )
  }

  /** Today's overdue tasks moved to today, as one write. */
  function rescheduleToday(rows: readonly Row[]) {
    void writeRows(rows, { task: { due: live.today } })
  }
</script>

<div
  class="list"
  bind:this={list}
  role="listbox"
  tabindex={selected === null ? 0 : -1}
  aria-label={view?.name ?? ''}
  onkeydown={keydown}
  onfocus={(event) => {
    if (event.target === event.currentTarget && rows[0]) select(rows[0].id)
  }}
  style:padding-top="{shown.above}px"
  style:padding-bottom="{shown.below}px"
>
  {#each items.slice(shown.first, shown.last + 1) as item (item.id)}
    <div class="item" data-item={item.id}>
      {#if item.kind === 'head'}
        {@const name = groupName(item.group.key)}
        <div class="nib-section head" use:droppable={(row) => kit.drop(row, item.group.key)}>
          <button
            type="button"
            class="fold"
            aria-expanded={!item.folded}
            onclick={() => (folded = toggled(folded, name))}
          >
            <span class="twist"><Twist open={!item.folded} /></span>
            {groupLabel(property, item.group.key, live.today)}
            <span class="count">{item.count}</span>
          </button>
          {#if property === 'formula.overdue' && item.group.key === true && item.count}
            <button
              type="button"
              class="nib-chip is-quiet act"
              onclick={() => rescheduleToday(item.group.rows)}>{t('Reschedule to today')}</button
            >
          {/if}
        </div>
      {:else if item.kind === 'row'}
        {@const row = item.row}
        {@const key = item.group.key}
        <div
          class="drop"
          use:droppable={(carried, at, box) => landOnRow(row, key, carried, at, box)}
        >
          <RowLine
            {row}
            {kit}
            {dated}
            {where}
            depth={item.depth}
            twist={item.twist}
            ontwist={() => (shut = toggled(shut, rowId(row)))}
            selected={selected === item.id}
            onselect={() => (selected = item.id)}
          />
        </div>
      {:else}
        <AddRow
          {kit}
          group={item.group}
          asked={adding.group === (item.group ? groupName(item.group.key) : '') ? adding.count : 0}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding-inline: var(--space-2);
  }

  .item {
    flex: none;
  }

  .head {
    min-height: var(--row-height);
    margin: 0;
    padding-block: 0;
  }

  .fold {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: default;
  }

  .twist {
    width: 10px;
    height: 10px;
    display: grid;
    color: var(--muted);
  }

  .count {
    color: var(--muted);
    font-weight: var(--weight-row);
    font-variant-numeric: tabular-nums;
  }

  .act {
    padding-block: 0;
    font-size: var(--text-xs);
    text-transform: none;
    letter-spacing: 0;
  }

  .head:global(.is-taking),
  .drop:global(.is-taking) {
    border-radius: var(--radius-row);
    background: var(--surface-selected);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
