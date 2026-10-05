<script lang="ts">
  /** The calendar on a phone: an agenda, the days that have something down the page
   *  from today, and what has no date at the end (docs/tasks.md 5.9, Phone). A row
   *  held and moved onto another day's head is given that day. */
  import { cellValue, type Row, rowId } from '@nib/bases'
  import { t } from '../i18n.svelte'
  import { droppable } from './drag.svelte'
  import type { Kit } from './kit'
  import RowLine from './RowLine.svelte'
  import { dayIn } from './values'
  import { agendaOf } from './calendar'
  import { dayWords } from '@nib/editor/task-days'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const property = $derived(live.view?.nib.date ?? 'task.date')

  const days = $derived.by(() => {
    const base = live.base
    const rows = (live.answer?.groups ?? []).flatMap((group) => group.rows)
    return agendaOf(rows, (row: Row) =>
      base ? dayIn(cellValue(base, property, row, live.context)) : null,
    )
  })
</script>

<div class="agenda">
  {#each days.dated as [day, rows] (day)}
    <p
      class="nib-section"
      class:late={day < live.today}
      use:droppable={(row) => kit.drop(row, day, property)}
    >
      {dayWords(day, live.today)}<span>{rows.length}</span>
    </p>
    {#each rows as row (`${row.space}:${rowId(row)}`)}
      <RowLine {row} {kit} dated={false} />
    {/each}
  {/each}
  {#if days.undated.length}
    <p class="nib-section" use:droppable={(row) => kit.drop(row, null, property)}>
      {t('No date')}<span>{days.undated.length}</span>
    </p>
    {#each days.undated as row (`${row.space}:${rowId(row)}`)}
      <RowLine {row} {kit} />
    {/each}
  {/if}
</div>

<style>
  .agenda {
    padding: 0 var(--space-2);
  }

  .late {
    color: var(--danger);
  }
</style>
