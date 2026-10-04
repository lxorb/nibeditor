<script lang="ts">
  /** The board: a column per group in the order the property's options give, empty
   *  columns kept (the Bases bug fixed), a column hidden from its menu and shown again
   *  from its folded strip, and a sub-group splitting the columns into swimlanes
   *  (docs/tasks.md 5.9).
   *
   *  A card carried to another column writes the property the board is grouped by, one
   *  edit (drop.ts); carried within its column it keeps the base's own manual order
   *  (`nib.order`). Grouped by status, a task line's box is the column: To do, Doing,
   *  Done. Every card is one height, so a column of two thousand cards mounts the
   *  dozen on screen and scrolls at the screen's own rate. */
  import { cellValue, groupName, type Group, type Row, rowId, type Value } from '@nib/bases'
  import { linkModifier } from '@nib/editor'
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { viewport } from '../viewport.svelte'
  import AddRow from './AddRow.svelte'
  import { chipsOf, toneColour, valueText } from './chips'
  import { priorityTone } from '../quick-add/labels'
  import { toneOf } from './columns'
  import { draggable, droppable, placeAmong, type Point } from './drag.svelte'
  import { dropInto } from './drop'
  import { setHidden, setManualOrder } from './edit'
  import { plain } from './inline'
  import { laneKeys } from './list-items'
  import type { Kit } from './kit'
  import TaskBox from './TaskBox.svelte'
  import { groupLabel } from './words'
  import BoardColumn from './BoardColumn.svelte'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const property = $derived(view?.groupBy?.property)
  const sub = $derived(view?.nib.subGroupBy?.property)
  const hidden = $derived(view?.nib.hidden ?? [])
  const groups = $derived(live.answer?.groups ?? [])
  const shownGroups = $derived(groups.filter((group) => !hidden.includes(groupName(group.key))))
  const hiddenGroups = $derived(groups.filter((group) => hidden.includes(groupName(group.key))))

  /** The swimlanes: every sub-group key any column has, in the order they first come. */
  const lanes = $derived(sub === undefined ? [] : laneKeys(shownGroups))

  /** The properties a note's card shows under its name: the view's first two others. */
  const under = $derived(
    live.columns
      .filter((one) => one !== 'task.text' && one !== 'file.name' && one !== property)
      .slice(0, 2),
  )

  function columnMenu(event: MouseEvent, group: Group) {
    menu.show(
      event,
      [
        {
          label: t('Hide'),
          run: () => kit.change((base, at) => setHidden(base, at, groupName(group.key), true)),
        },
      ],
      { title: groupLabel(property, group.key, live.today) },
    )
  }

  /** A card let go over a column (or a lane of it), at a place among its cards. */
  function land(row: Row, group: Group, laneKey: Value | undefined, at: Point, place: HTMLElement) {
    const by = property
    if (by === undefined) return
    const cards = [...place.querySelectorAll('[data-card]')]
    const index = placeAmong(cards, at)
    const ids = (
      laneKey === undefined
        ? group.rows
        : (group.sub?.find((one) => groupName(one.key) === groupName(laneKey))?.rows ?? [])
    ).map(rowId)
    const id = rowId(row)
    const name = groupName(group.key)
    const inColumn = group.rows.includes(row)

    // Where it was let go among the column's cards is the column's manual order.
    const order = ids.filter((one) => one !== id)
    order.splice(Math.min(index, order.length), 0, id)
    const reordered = order.join('\n') !== ids.join('\n')

    const lane = group.sub?.find((one) => one.rows.includes(row))?.key
    if (inColumn && (laneKey === undefined || groupName(lane ?? null) === groupName(laneKey))) {
      if (reordered) kit.change((base, at) => setManualOrder(base, at, name, order))
      return
    }

    const first = dropInto(by, group.key, row, live.today)
    const second =
      laneKey !== undefined && sub !== undefined ? dropInto(sub, laneKey, row, live.today) : null
    if (first && second && 'change' in first && 'change' in second) {
      kit.write(row, {
        note: { ...first.change.note, ...second.change.note },
        task: { ...first.change.task, ...second.change.task },
      })
    } else if (first) kit.drop(row, group.key)
    else if (second && laneKey !== undefined) kit.drop(row, laneKey, sub)
    if (reordered) kit.change((base, at) => setManualOrder(base, at, name, order))
  }

  const cardHeight = $derived(viewport.touch ? 92 : 70)
</script>

{#snippet card(row: Row)}
  {@const title = row.task ? plain(row.task.text) : row.file.basename}
  <div
    class="card"
    data-card
    role="button"
    tabindex="0"
    style:--tone={row.task ? priorityTone(row.task.priority) : null}
    use:draggable={{ row, label: title }}
    onclick={(event) => kit.open(row, linkModifier(event) ? 'tab' : 'aside')}
    onkeydown={(event) => {
      if (event.key === 'Enter') kit.open(row, 'aside')
    }}
  >
    <div class="title">
      {#if row.task}<TaskBox task={row.task} label={title} ontick={() => kit.tick(row)} />{/if}
      <span class="words">{title}</span>
    </div>
    <div class="meta">
      {#if row.task}
        {#each chipsOf(row.task, live.today) as chip (chip.kind)}
          <span class:late={chip.late}>{chip.text}</span>
        {/each}
        {#if kit.spec.builtin !== 'project'}<span class="where">{row.file.basename}</span>{/if}
      {:else}
        {#each under as one (one)}
          {@const value = live.base ? cellValue(live.base, one, row, live.context) : null}
          {@const said = valueText(value, live.today)}
          {#if said}
            <span
              style:color={live.base && typeof value === 'string'
                ? toneColour(toneOf(live.base, one, value))
                : null}>{said}</span
            >
          {/if}
        {/each}
      {/if}
    </div>
  </div>
{/snippet}

{#snippet column(group: Group, laneKey: Value | undefined, rows: readonly Row[])}
  <div class="column" use:droppable={(row, at, place) => land(row, group, laneKey, at, place)}>
    {#if laneKey === undefined}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="head" oncontextmenu={(event) => columnMenu(event, group)}>
        <span
          class="dot"
          style:background={live.base && property && typeof group.key === 'string'
            ? toneColour(toneOf(live.base, property, group.key))
            : null}
        ></span>
        <span class="name">{groupLabel(property, group.key, live.today)}</span>
        <span class="count">{rows.length}</span>
      </div>
    {/if}
    <BoardColumn {rows} height={cardHeight} {card} />
    {#if !kit.compact}
      <div class="add"><AddRow {kit} {group} /></div>
    {/if}
  </div>
{/snippet}

<div class="board" class:laned={lanes.length > 0}>
  {#if lanes.length}
    <div class="lanes">
      <div class="lane-heads">
        {#each shownGroups as group (groupName(group.key))}
          <div
            class="head"
            oncontextmenu={(event) => columnMenu(event, group)}
            role="columnheader"
            tabindex="-1"
          >
            <span class="name">{groupLabel(property, group.key, live.today)}</span>
            <span class="count">{group.rows.length}</span>
          </div>
        {/each}
      </div>
      {#each lanes as lane (groupName(lane))}
        <p class="nib-section lane">{groupLabel(sub, lane, live.today)}</p>
        <div class="row">
          {#each shownGroups as group (groupName(group.key))}
            {@render column(
              group,
              lane,
              group.sub?.find((one) => groupName(one.key) === groupName(lane))?.rows ?? [],
            )}
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    {#each shownGroups as group (groupName(group.key))}
      {@render column(group, undefined, group.rows)}
    {/each}
  {/if}
  {#each hiddenGroups as group (groupName(group.key))}
    <button
      type="button"
      class="folded"
      title={t('Show again')}
      onclick={() => kit.change((base, at) => setHidden(base, at, groupName(group.key), false))}
    >
      <span class="name">{groupLabel(property, group.key, live.today)}</span>
      <span class="count">{group.rows.length}</span>
    </button>
  {/each}
</div>

<style>
  .board {
    display: flex;
    gap: var(--space-3);
    align-items: stretch;
    height: 100%;
    min-height: 0;
    padding: var(--space-3);
    overflow-x: auto;
  }

  .lanes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: min-content;
  }

  .lane-heads,
  .row {
    display: flex;
    gap: var(--space-3);
  }

  .lane-heads .head {
    width: 272px;
  }

  .row .column {
    max-height: 420px;
  }

  .lane {
    margin: var(--space-2) 0 0;
  }

  .column {
    flex: none;
    display: flex;
    flex-direction: column;
    width: 272px;
    min-height: 0;
    max-height: 100%;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .column:global(.is-taking) {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--row-height);
    padding: 0 var(--space-3);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line-strong);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--muted);
    font-weight: var(--weight-row);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  .add {
    padding: 0 var(--space-1) var(--space-1);
  }

  .card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    height: calc(100% - 6px);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-inline-start: 3px solid var(--tone, var(--line));
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .card:hover {
      border-color: var(--line-strong);
      border-inline-start-color: var(--tone, var(--line-strong));
      box-shadow: var(--shadow-sm);
    }
  }

  .card:global(.is-carried) {
    opacity: 0.35;
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .meta .late {
    color: var(--danger);
  }

  .where {
    margin-inline-start: auto;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folded {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 36px;
    padding: var(--space-3) 0;
    border: none;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    writing-mode: vertical-rl;
    cursor: default;
  }

  @media (hover: hover) {
    .folded:hover {
      color: var(--text-strong);
    }
  }
</style>
