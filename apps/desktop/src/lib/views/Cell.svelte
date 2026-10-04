<script lang="ts">
  /** One cell of a table (and one property on a card): the value as words, and, while
   *  it is being edited, the control its column's kind asks for. A note's property is
   *  edited in the Properties panel's own control (properties/PropertyValue.svelte); a
   *  task's field in the control that field needs - a date, a time, a priority, a
   *  status. Whatever it becomes is written through the one write path (kit.write),
   *  one undo per edit. */
  import type { Row, Value } from '@nib/bases'
  import { cellValue } from '@nib/bases'
  import type { Property } from '@nib/markdown/properties'
  import { t } from '../i18n.svelte'
  import PropertyValue from '../properties/PropertyValue.svelte'
  import { valueText } from './chips'
  import { bare, changeOf, type Editor, optionsOf } from './columns'
  import type { Kit } from './kit'
  import TaskBox from './TaskBox.svelte'
  import { dayIn, isDateValue } from './values'
  import Words from './Words.svelte'
  import { plain } from './inline'
  import { priorityName, statusName } from './words'

  const {
    row,
    property,
    editor,
    kit,
    editing = false,
    onstop,
  }: {
    row: Row
    property: string
    editor: Editor
    kit: Kit
    editing?: boolean
    onstop?: () => void
  } = $props()

  const value = $derived.by((): Value => {
    const base = kit.live.base
    return base ? cellValue(base, property, row, kit.live.context) : null
  })
  const shown = $derived(valueText(value, kit.live.today))
  const writable = $derived(
    editor !== 'none' && (row.kind === 'task' || !property.startsWith('task.')),
  )

  function write(next: Value | null) {
    const change = changeOf(row, property, next)
    if (change) kit.write(row, change)
  }

  /** The value as a property row, for the shared control. */
  const asProperty = $derived.by((): Property => {
    const items = Array.isArray(value) ? value.map((one) => valueText(one, kit.live.today)) : []
    const kind =
      editor === 'list'
        ? 'list'
        : editor === 'number'
          ? 'number'
          : editor === 'date'
            ? 'date'
            : editor === 'checkbox'
              ? 'checkbox'
              : 'text'
    const said =
      value === null
        ? ''
        : isDateValue(value)
          ? value.iso + (value.time ? ` ${value.time.slice(0, 5)}` : '')
          : typeof value === 'boolean'
            ? String(value)
            : Array.isArray(value)
              ? ''
              : shown
    return { key: bare(property), kind, value: said, items, from: 0, to: 0 }
  })

  const choices = $derived(kit.live.base ? optionsOf(kit.live.base, property) : [])

  /** Words written from the shared control, as the value the field holds. */
  function fromWords(words: string | null): Value | null {
    if (words === null || words === '') return null
    if (editor === 'number') return Number.isFinite(Number(words)) ? Number(words) : words
    if (editor === 'checkbox') return words === 'true'
    if (editor === 'date') {
      const [day, time] = words.split(' ')
      return time ? { kind: 'date', iso: day ?? words, time } : { kind: 'date', iso: day ?? words }
    }
    return words
  }

  function stopOnKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onstop?.()
    }
  }

  function focusIt(node: HTMLElement) {
    node.focus()
    if (node instanceof HTMLInputElement && node.type === 'text') node.select()
  }
</script>

{#if property === 'task.text' && row.task}
  <span class="task">
    <TaskBox task={row.task} label={plain(row.task.text)} ontick={() => kit.tick(row)} />
    {#if editing}
      <input
        class="edit"
        value={row.task.text}
        aria-label={t('Task')}
        use:focusIt
        onkeydown={(event) => {
          stopOnKeys(event)
          if (event.key === 'Enter') {
            event.preventDefault()
            write(event.currentTarget.value)
            onstop?.()
          }
        }}
        onblur={(event) => {
          if (event.currentTarget.value !== row.task?.text) write(event.currentTarget.value)
          onstop?.()
        }}
      />
    {:else}
      <span class="words"><Words words={row.task.text} /></span>
    {/if}
  </span>
{:else if editing && writable && editor !== 'checkbox'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="editing"
    onkeydown={stopOnKeys}
    onfocusout={(event) => {
      if (!(
        event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
      ))
        onstop?.()
    }}
  >
    {#if editor === 'priority' && row.task}
      <select
        class="edit"
        aria-label={t('Priority')}
        value={String(row.task.priority)}
        use:focusIt
        onchange={(event) => write(Number(event.currentTarget.value))}
      >
        {#each [1, 2, 3, 4] as one (one)}<option value={String(one)}>{priorityName(one)}</option
          >{/each}
      </select>
    {:else if editor === 'status' && row.task}
      <select
        class="edit"
        aria-label={t('Status')}
        value={row.task.status}
        use:focusIt
        onchange={(event) => kit.drop(row, event.currentTarget.value, 'task.status')}
      >
        {#each [' ', '/', 'x', '-'] as one (one)}<option value={one}>{statusName(one)}</option
          >{/each}
      </select>
    {:else if editor === 'date' && property.startsWith('task.')}
      <input
        class="edit"
        type="date"
        aria-label={t('Date')}
        value={dayIn(value) ?? ''}
        use:focusIt
        onchange={(event) => write(event.currentTarget.value || null)}
      />
    {:else if editor === 'time'}
      <input
        class="edit"
        type="time"
        aria-label={t('Time')}
        value={typeof value === 'string' ? value : ''}
        use:focusIt
        onchange={(event) => write(event.currentTarget.value || null)}
      />
    {:else if editor === 'duration'}
      <input
        class="edit"
        type="number"
        min="0"
        step="5"
        aria-label={t('Duration')}
        value={row.task?.duration ?? ''}
        use:focusIt
        onchange={(event) =>
          write(event.currentTarget.value ? Number(event.currentTarget.value) : null)}
      />
    {:else}
      <PropertyValue
        property={asProperty}
        writable
        choices={choices.length ? choices : null}
        autofocus
        onwrite={(words: string | null) => write(fromWords(words))}
        onitems={(items: string[]) => write(items)}
      />
    {/if}
  </span>
{:else if editor === 'checkbox' && typeof value === 'boolean'}
  <input
    type="checkbox"
    class="nib-checkbox"
    checked={value}
    disabled={!writable}
    aria-label={bare(property)}
    onchange={(event) => {
      if (property === 'task.done') kit.tick(row)
      else write(event.currentTarget.checked)
    }}
  />
{:else}
  <span class="shown" class:empty={!shown}>{shown}</span>
{/if}

<style>
  .task {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .words,
  .shown {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editing {
    display: flex;
    align-items: center;
    min-width: 0;
    width: 100%;
  }

  .edit {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 0.15em 0.3em;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
</style>
