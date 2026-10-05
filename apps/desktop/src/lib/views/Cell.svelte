<script lang="ts">
  /** One cell of a table (and one property on a card): the value as words, and, while
   *  it is being edited, the control its column's kind asks for. A note's property is
   *  edited in the Properties panel's own control (properties/PropertyValue.svelte); a
   *  task's field in the control that field needs - a date, a time, a priority, a
   *  status. Whatever it becomes is written through the one write path (kit.write),
   *  one undo per edit.
   *
   *  Shown, a property with choices is its choices as chips in their tones, a property
   *  with a format is that format (format.ts: a percentage, money, a bar, an address
   *  a press opens), and a button column is its button, which a press runs on the row
   *  (press.ts). */
  import type { Row, Value } from '@nib/bases'
  import { cellValue } from '@nib/bases'
  import type { Property } from '@nib/markdown/properties'
  import { t } from '../i18n.svelte'
  import PropertyValue from '../properties/PropertyValue.svelte'
  import { valueText } from './chips'
  import { bare, changeOf, type Editor, formatOf, optionsOf, toneOf } from './columns'
  import { formatted } from './format'
  import { toneColour } from './chips'
  import { openExternal } from '../tauri'
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
  /** The value as its column's format shows it, where it has one. */
  const styled = $derived(
    kit.live.base ? formatted(value, formatOf(kit.live.base, property)) : null,
  )
  /** A property with choices, each value as a chip in its tone. */
  const chips = $derived.by(() => {
    const base = kit.live.base
    if (editor !== 'select' || !base) return null
    const values = Array.isArray(value) ? value : value === null ? [] : [value]
    return values.map((one) => {
      const words = valueText(one, kit.live.today)
      return { words, colour: toneColour(toneOf(base, property, words)) }
    })
  })
  const writable = $derived(
    editor !== 'none' &&
      editor !== 'button' &&
      (row.kind === 'task' || !property.startsWith('task.')),
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
{:else if editor === 'button'}
  <button
    type="button"
    class="nib-chip press"
    onclick={(event) => {
      event.stopPropagation()
      kit.press(row, property)
    }}>{bare(property).replace(/^button\./, '')}</button
  >
{:else if chips}
  <span class="shown chips">
    {#each chips as chip, at (at)}<span class="chip" style:--tone={chip.colour}>{chip.words}</span
      >{/each}
  </span>
{:else if styled?.href}
  <a
    class="shown link"
    href={styled.href}
    onclick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      if (styled.href) void openExternal(styled.href)
    }}>{styled.text}</a
  >
{:else if styled?.share !== undefined}
  <span class="shown progress">
    <span class="bar"><span class="fill" style:inline-size="{styled.share * 100}%"></span></span>
    {styled.text}
  </span>
{:else}
  <span class="shown" class:empty={!(styled?.text ?? shown)}>{styled?.text ?? shown}</span>
{/if}

<style>
  .press {
    padding: 0 var(--space-2);
    line-height: 1.6;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chips {
    display: flex;
    gap: var(--space-1);
  }

  .chip {
    flex: none;
    padding: 0 0.5em;
    border-radius: 99px;
    background: color-mix(in srgb, var(--tone, var(--muted)) 22%, transparent);
    color: var(--text-strong);
    line-height: 1.6;
  }

  .link {
    color: var(--accent);
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }

  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    flex: 1;
    height: 6px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--surface-press);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: inline-size var(--dur-base) var(--ease-out);
  }

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
