<script lang="ts">
  /** The table on a phone: a row per row, its name and the first three of the view's
   *  other columns under it, since a phone has no width for a grid (docs/tasks.md 5.9).
   *  A press opens the note. */
  import { cellValue, groupName, rowId } from '@nib/bases'
  import { valueText } from './chips'
  import { displayName } from './columns'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import TaskBox from './TaskBox.svelte'
  import { groupLabel, propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const property = $derived(live.view?.groupBy?.property)
  const shown = $derived(
    live.columns
      .filter((one) => one !== 'task.text' && one !== 'file.name' && one !== 'file.basename')
      .slice(0, 3),
  )
</script>

<div class="rows">
  {#each live.answer?.groups ?? [] as group (groupName(group.key))}
    {#if property !== undefined}
      <p class="nib-section">
        {groupLabel(property, group.key, live.today)}<span>{group.rows.length}</span>
      </p>
    {/if}
    {#each group.rows as row (`${row.space}:${rowId(row)}`)}
      {@const title = row.task ? plain(row.task.text) : row.file.basename}
      <div class="row">
        {#if row.task}<TaskBox task={row.task} label={title} ontick={() => kit.tick(row)} />{/if}
        <button type="button" class="body" onclick={() => kit.open(row, 'tab')}>
          <span class="title">{title}</span>
          {#each shown as one (one)}
            {@const said = live.base
              ? valueText(cellValue(live.base, one, row, live.context), live.today)
              : ''}
            {#if said}
              <span class="prop"
                ><span class="key"
                  >{propertyName(one, live.base ? displayName(live.base, one) : undefined)}</span
                >
                {said}</span
              >
            {/if}
          {/each}
        </button>
      </div>
    {/each}
  {/each}
</div>

<style>
  .rows {
    padding: 0 var(--space-2);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--row-pad);
    border-bottom: 1px solid var(--line);
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-family: var(--font-ui);
    text-align: start;
  }

  .title {
    color: var(--text-strong);
    font-size: var(--touch-text, var(--text-row));
  }

  .prop {
    color: var(--muted-strong);
    font-size: var(--text-sm);
  }

  .key {
    color: var(--muted);
  }
</style>
