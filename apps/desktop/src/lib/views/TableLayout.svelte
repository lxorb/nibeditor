<script lang="ts">
  /** The table: a row per row, a column per property, every row one row tall so a
   *  window of what is on screen is all that is mounted (docs/tasks.md 5.9).
   *
   *  A spreadsheet's keys: the arrows move between cells, Enter edits the cell in the
   *  control its kind asks for (Cell.svelte), Escape leaves. A header pressed sorts by
   *  its column, dragged by its edge resizes it (Obsidian's `columnSize`), dragged by
   *  its name moves it; its menu hides it, sorts it, and puts a summary under it. The
   *  summaries sit in a row under the last row. */
  import { DEFAULT_SUMMARIES, groupName, type Row, rowId } from '@nib/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
  import { windowFor } from '../row-window'
  import { ListView, tokenRow } from '../row-window.svelte'
  import { viewport } from '../viewport.svelte'
  import Cell from './Cell.svelte'
  import { valueText } from './chips'
  import { displayName, editorOf, knownProperties } from './columns'
  import { draggable } from './drag.svelte'
  import { setColumns, setSort, setSummary, setViewOption } from './edit'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import { groupLabel, propertyName, summaryName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const columns = $derived(live.columns)
  const property = $derived(view?.groupBy?.property)

  /** The rows in order, a group's head before its rows where the view groups. */
  type Line =
    | { kind: 'head'; id: string; label: string; count: number }
    | { kind: 'row'; id: string; row: Row }
  const lines = $derived.by((): Line[] => {
    const out: Line[] = []
    for (const group of live.answer?.groups ?? []) {
      if (property !== undefined) {
        out.push({
          kind: 'head',
          id: `head:${groupName(group.key)}`,
          label: groupLabel(property, group.key, live.today),
          count: group.rows.length,
        })
      }
      for (const row of group.rows) out.push({ kind: 'row', id: `${row.space}:${rowId(row)}`, row })
    }
    return out
  })

  const widths = $derived.by((): Record<string, number> => {
    const said = view?.options.columnSize
    if (!said || typeof said !== 'object' || Array.isArray(said)) return {}
    return Object.fromEntries(
      Object.entries(said).filter((one): one is [string, number] => typeof one[1] === 'number'),
    )
  })
  const widthOf = (column: string) =>
    widths[column] ?? (column === 'task.text' || column === 'file.name' ? 280 : 150)
  const template = $derived(columns.map((column) => `${widthOf(column)}px`).join(' ') + ' 1fr')

  let body = $state<HTMLElement>()
  const win = new ListView()
  $effect(() => {
    const box = body
    if (!box) return
    const touch = viewport.touch
    return untrack(() => win.follow(box, () => tokenRow(touch)))
  })
  const shown = $derived(
    windowFor({
      count: lines.length,
      height: win.row || 28,
      top: win.top,
      room: win.room || 600,
      overscan: 10,
    }),
  )

  /** The cell the keyboard is on, and whether it is being edited. */
  let at = $state<{ line: number; column: number } | null>(null)
  let editing = $state(false)

  function sortBy(column: string) {
    kit.change((base, index) => {
      const first = base.views[index]?.sort[0]
      const next = first?.property !== column ? 'ASC' : first.direction === 'ASC' ? 'DESC' : null
      return setSort(base, index, next === null ? [] : [{ property: column, direction: next }])
    })
  }

  function headMenu(event: MouseEvent, column: string) {
    const base = live.base
    if (!base) return
    const others = knownProperties(base, view?.nib.rows ?? 'notes', live.rows).filter(
      (one) => !columns.includes(one),
    )
    const items: MenuEntry[] = [
      {
        label: t('Ascending'),
        run: () => kit.change((b, i) => setSort(b, i, [{ property: column, direction: 'ASC' }])),
      },
      {
        label: t('Descending'),
        run: () => kit.change((b, i) => setSort(b, i, [{ property: column, direction: 'DESC' }])),
      },
      DIVIDER,
      {
        label: t('Summary'),
        run: () => undefined,
        more: () =>
          Promise.resolve([
            {
              label: t('None'),
              checked: !view?.summaries[column],
              run: () => kit.change((b, i) => setSummary(b, i, column, null)),
            },
            ...DEFAULT_SUMMARIES.map((name) => ({
              label: summaryName(name),
              checked: view?.summaries[column] === name,
              run: () => kit.change((b, i) => setSummary(b, i, column, name)),
            })),
          ]),
      },
      {
        label: t('Add a column'),
        run: () => undefined,
        more: () =>
          Promise.resolve(
            others.map((one) => ({
              label: propertyName(one, displayName(base, one)),
              run: () => kit.change((b, i) => setColumns(b, i, [...columns, one])),
            })),
          ),
      },
      DIVIDER,
      {
        label: t('Hide'),
        disabled: columns.length < 2,
        run: () =>
          kit.change((b, i) =>
            setColumns(
              b,
              i,
              columns.filter((one) => one !== column),
            ),
          ),
      },
    ]
    menu.show(event, items, { title: propertyName(column, displayName(base, column)) })
  }

  /** A header's edge dragged: the column wider or narrower, written once on letting go. */
  function resize(event: PointerEvent, column: string) {
    event.preventDefault()
    event.stopPropagation()
    const start = event.clientX
    const was = widthOf(column)
    const cell = (event.currentTarget as HTMLElement).parentElement
    const move = (one: PointerEvent) => {
      if (cell) cell.style.width = `${Math.max(60, was + one.clientX - start)}px`
    }
    const up = (one: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const width = Math.max(60, Math.round(was + one.clientX - start))
      if (width !== was)
        kit.change((b, i) => setViewOption(b, i, 'columnSize', { ...widths, [column]: width }))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** A header dragged sideways past another: the columns in their new order. */
  function reorder(event: PointerEvent, column: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.grip')) return
    const startX = event.clientX
    let moved = false
    const heads = [
      ...((event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
        '.head',
      ) ?? []),
    ]
    const move = (one: PointerEvent) => {
      if (Math.abs(one.clientX - startX) > 6) moved = true
    }
    const up = (one: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) return
      const target = heads.findIndex((head) => {
        const box = head.getBoundingClientRect()
        return one.clientX >= box.left && one.clientX < box.right
      })
      const from = columns.indexOf(column)
      if (target === -1 || target === from) return
      const next = columns.filter((one) => one !== column)
      next.splice(target, 0, column)
      kit.change((b, i) => setColumns(b, i, next))
      // The click this press ends in is not a sort.
      window.addEventListener('click', (click) => click.stopPropagation(), {
        capture: true,
        once: true,
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function keydown(event: KeyboardEvent) {
    if (editing || !at) return
    const rowsAt = lines.length
    const move = (line: number, column: number) => {
      event.preventDefault()
      at = {
        line: Math.max(0, Math.min(rowsAt - 1, line)),
        column: Math.max(0, Math.min(columns.length - 1, column)),
      }
      queueMicrotask(() => body?.querySelector<HTMLElement>('.cell.on')?.focus())
    }
    if (event.key === 'ArrowDown') move(at.line + 1, at.column)
    else if (event.key === 'ArrowUp') move(at.line - 1, at.column)
    else if (event.key === 'ArrowRight') move(at.line, at.column + 1)
    else if (event.key === 'ArrowLeft') move(at.line, at.column - 1)
    else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      editing = true
    }
  }

  const summaryOf = (column: string) => {
    const value = live.answer?.summaries[column]
    return value === undefined ? '' : valueText(value, live.today)
  }
  const summed = $derived(columns.some((column) => view?.summaries[column]))
</script>

<div class="table" style:--columns={template}>
  <div class="heads" role="row">
    {#each columns as column (column)}
      {@const sort = view?.sort.find((one) => one.property === column)}
      <div
        class="head"
        role="columnheader"
        tabindex="-1"
        aria-sort={sort ? (sort.direction === 'ASC' ? 'ascending' : 'descending') : 'none'}
        onpointerdown={(event) => reorder(event, column)}
        oncontextmenu={(event) => headMenu(event, column)}
      >
        <button type="button" class="name" onclick={() => sortBy(column)}>
          {propertyName(column, live.base ? displayName(live.base, column) : undefined)}
          {#if sort}<span class="arrow" aria-hidden="true"
              >{sort.direction === 'ASC' ? '↑' : '↓'}</span
            >{/if}
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="grip" onpointerdown={(event) => resize(event, column)}></span>
      </div>
    {/each}
  </div>

  <div
    class="body"
    bind:this={body}
    role="grid"
    tabindex="-1"
    aria-label={view?.name ?? ''}
    onkeydown={keydown}
    style:padding-top="{shown.above}px"
    style:padding-bottom="{shown.below}px"
  >
    {#each lines.slice(shown.first, shown.last + 1) as line, offset (line.id)}
      {@const index = shown.first + offset}
      {#if line.kind === 'head'}
        <div class="nib-section group" role="row">
          <span>{line.label}</span><span>{line.count}</span>
        </div>
      {:else if line.kind === 'row'}
        <div
          class="line"
          role="row"
          use:draggable={{
            row: line.row,
            label: line.row.task ? plain(line.row.task.text) : line.row.file.basename,
          }}
        >
          {#each columns as column, place (column)}
            {@const on = at?.line === index && at.column === place}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="cell"
              class:on
              role="gridcell"
              tabindex={on ? 0 : -1}
              onclick={() => {
                if (on && !editing) editing = true
                else {
                  at = { line: index, column: place }
                  editing = false
                }
              }}
              ondblclick={() => {
                at = { line: index, column: place }
                editing = true
              }}
            >
              <Cell
                row={line.row}
                property={column}
                editor={live.base ? editorOf(live.base, column, live.rows) : 'none'}
                {kit}
                editing={on && editing}
                onstop={() => (editing = false)}
              />
            </div>
          {/each}
        </div>
      {/if}
    {/each}
  </div>

  {#if summed}
    <div class="sums" role="row">
      {#each columns as column (column)}
        <div class="sum" role="gridcell">
          {#if view?.summaries[column]}<span class="what"
              >{summaryName(view.summaries[column] ?? '')}</span
            >
            {summaryOf(column)}{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .table {
    display: flex;
    flex-direction: column;
    min-width: min-content;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .heads,
  .line,
  .sums {
    display: grid;
    grid-template-columns: var(--columns);
  }

  .heads {
    position: sticky;
    top: 0;
    z-index: var(--z-raised);
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .head {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    height: var(--row-height);
    border-inline-end: 1px solid var(--line);
  }

  .name {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-2);
    overflow: hidden;
    border: none;
    background: none;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (hover: hover) {
    .name:hover {
      color: var(--text-strong);
    }
  }

  .arrow {
    margin-inline-start: 0.3em;
    color: var(--accent);
  }

  .grip {
    position: absolute;
    inset-block: 0;
    inset-inline-end: -3px;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }

  .line {
    height: var(--row-height);
    border-bottom: 1px solid var(--line);
  }

  .cell {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 var(--space-2);
    border-inline-end: 1px solid var(--line);
    color: var(--text);
    outline-offset: -2px;
  }

  .cell.on {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .group {
    height: var(--row-height);
    margin: 0;
  }

  .sums {
    border-top: 1px solid var(--line-strong);
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .sum {
    padding: var(--space-1) var(--space-2);
    text-align: end;
  }

  .what {
    color: var(--muted);
  }

  .line:global(.is-carried) {
    opacity: 0.4;
  }
</style>
