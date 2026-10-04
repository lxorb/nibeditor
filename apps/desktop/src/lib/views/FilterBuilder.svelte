<script lang="ts">
  /** The view's filter as rows to click: a property, how it compares, and a value, all
   *  of them or any of them (filter-rows.ts). The field above them takes Todoist's
   *  filter language as typed (`today & #work | overdue`) and turns it into the same
   *  rows (docs/tasks.md 5.8). A row the builder cannot show - a formula, a group
   *  inside a group - stays as written, with its words. Saved as Bases' YAML, so
   *  Obsidian reads the filter too. */
  import { fromTodoist } from '@nib/bases'
  import { i18n, t } from '../i18n.svelte'
  import Cross from '../Cross.svelte'
  import Select from '../Select.svelte'
  import { displayName, knownProperties } from './columns'
  import { setFilter, setShowCompleted } from './edit'
  import {
    type FilterRow,
    type FilterRows,
    filterOf,
    type Operator,
    OPERATORS,
    rowsOf,
    takesValue,
  } from './filter-rows'
  import type { Kit } from './kit'
  import { propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const rows = $derived(rowsOf(view?.filters))
  const kinds = $derived(view?.nib.rows ?? 'notes')
  const properties = $derived(live.base ? knownProperties(live.base, kinds, live.rows) : [])

  let typed = $state('')
  /** What the field holds before anything is typed: a filter, in Todoist's words. */
  const EXAMPLE = 'today & #work | overdue'

  const OPERATOR_NAMES: Record<Operator, string> = {
    '==': '=',
    '!=': '≠',
    '<': '<',
    '>': '>',
    '<=': '≤',
    '>=': '≥',
    contains: t('contains'),
    empty: t('is empty'),
    filled: t('is not empty'),
    tag: '#',
  }

  function write(next: FilterRows) {
    kit.change((base, at) => setFilter(base, at, filterOf(next)))
  }

  function changeRow(at: number, row: FilterRow) {
    write({ ...rows, rows: rows.rows.map((one, index) => (index === at ? row : one)) })
  }

  function add() {
    const property =
      kinds === 'notes'
        ? (properties.find((one) => one.startsWith('note.')) ?? 'file.name')
        : 'task.due'
    write({ ...rows, rows: [...rows.rows, { property, op: '==', value: '' }] })
  }

  /** Todoist's words, read into the view's filter. The first list where a comma makes
   *  several. */
  function readTyped() {
    const words = typed.trim()
    if (!words) return
    try {
      const [first] = fromTodoist(words, { lang: i18n.language, today: live.today })
      if (first !== undefined) {
        kit.change((base, at) => setFilter(base, at, first))
        typed = ''
      }
    } catch {
      // Words Todoist's grammar cannot read stay in the field to be corrected.
    }
  }

  const describe = (filter: unknown): string =>
    typeof filter === 'string' ? filter : JSON.stringify(filter)
</script>

<div class="nib-field query">
  <input
    bind:value={typed}
    aria-label={t('Filter')}
    placeholder={EXAMPLE}
    onkeydown={(event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        readTyped()
      }
    }}
  />
</div>

{#if kinds !== 'notes'}
  <button
    type="button"
    class="nib-chip completed"
    class:is-on={view?.nib.showCompleted === true}
    aria-pressed={view?.nib.showCompleted === true}
    onclick={() =>
      kit.change((base, at) => setShowCompleted(base, at, view?.nib.showCompleted !== true))}
    >{t('Show completed')}</button
  >
{/if}

{#if rows.rows.length > 1}
  <div class="nib-segmented join" role="tablist">
    <button
      type="button"
      role="tab"
      class:on={rows.join === 'and'}
      aria-selected={rows.join === 'and'}
      onclick={() => write({ ...rows, join: 'and' })}>{t('All')}</button
    >
    <button
      type="button"
      role="tab"
      class:on={rows.join === 'or'}
      aria-selected={rows.join === 'or'}
      onclick={() => write({ ...rows, join: 'or' })}>{t('Any of them')}</button
    >
  </div>
{/if}

{#each rows.rows as row, at (at)}
  <div class="row">
    {#if 'kept' in row}
      <code class="kept">{describe(row.kept)}</code>
    {:else if 'property' in row}
      <Select
        label={t('Property')}
        value={row.property}
        options={(properties.includes(row.property)
          ? properties
          : [row.property, ...properties]
        ).map((one) => ({
          value: one,
          label: propertyName(one, live.base ? displayName(live.base, one) : undefined),
        }))}
        onchange={(property: string) => changeRow(at, { ...row, property })}
      />
      <Select
        label={t('Compare')}
        value={row.op}
        options={OPERATORS.map((one) => ({ value: one, label: OPERATOR_NAMES[one] }))}
        onchange={(op: string) => {
          const found = OPERATORS.find((one) => one === op)
          if (found) changeRow(at, { ...row, op: found })
        }}
      />
      {#if takesValue(row.op)}
        <input
          class="nib-field value"
          value={row.value}
          aria-label={t('Value')}
          onchange={(event) => changeRow(at, { ...row, value: event.currentTarget.value })}
        />
      {/if}
    {/if}
    <button
      type="button"
      class="nib-glyph"
      title={t('Remove')}
      aria-label={t('Remove')}
      onclick={() => write({ ...rows, rows: rows.rows.filter((_, index) => index !== at) })}
      ><Cross small /></button
    >
  </div>
{/each}

<button type="button" class="nib-row is-short adder" onclick={add}>
  <span class="nib-row-label">{t('Add a filter')}</span>
</button>

<style>
  .query input {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .completed {
    align-self: flex-start;
  }

  .join {
    align-self: flex-start;
  }

  .join button {
    padding: 0 var(--space-3);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.8fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .kept {
    grid-column: 1 / 4;
    overflow: hidden;
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    min-width: 0;
  }

  .adder .nib-row-label {
    color: var(--muted);
  }
</style>
