<script lang="ts">
  /** One property's value as the control its kind asks for: chips and an add field
   *  for a list, a box for a yes or no, a menu where the answers are fixed, and a field
   *  for words, a number or a date. The one control for a property wherever one is
   *  edited - the Properties panel's row and a table's cell - so a date is picked the
   *  same way everywhere (docs/tasks.md 5.12).
   *
   *  It writes nothing itself: it says what the value became, and whoever holds the
   *  note writes it (the panel into the open document, a view through the rows' one
   *  write path). */
  import type { Property } from '@nib/markdown/properties'
  import { withItem, withoutItem } from '@nib/markdown/property-edits'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'

  const {
    property,
    writable,
    choices = null,
    onwrite,
    onitems,
    onsearch,
    autofocus = false,
  }: {
    property: Property
    writable: boolean
    /** The fixed answers, where the property has them. */
    choices?: readonly string[] | null
    /** A scalar written: the words as the file writes them, or null to empty it. */
    onwrite: (value: string | null) => void
    /** A list written whole. */
    onitems: (items: string[]) => void
    /** A tag pressed, which asks the space about it. */
    onsearch?: ((text: string) => void) | undefined
    autofocus?: boolean
  } = $props()

  /** A field commits on Enter as well as on leaving it. */
  function commitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()
  }

  /** The value a date field holds, as the file writes it. */
  function dated(field: HTMLInputElement): string {
    return field.type === 'datetime-local' ? field.value.replace('T', ' ') : field.value
  }

  /** What a scalar row is edited in. */
  function fieldType(one: Property): string {
    if (one.kind === 'number') return 'number'
    if (one.kind !== 'date') return 'text'
    return one.value.length > 10 ? 'datetime-local' : 'date'
  }

  /** A list's field: Enter or leaving it adds what was typed. */
  function addItem(field: HTMLInputElement) {
    const said = field.value
    field.value = ''
    const items = withItem(property, said)
    if (items) onitems(items)
  }

  /** A tag list's chips ask the space about their tag, as a tag does everywhere. */
  const tagged = $derived(/^tags?$/i.test(property.key))

  function focusOnMount(node: HTMLElement) {
    if (autofocus) node.focus()
  }
</script>

<span class="value">
  {#if property.kind === 'list' || property.kind === 'map'}
    {#each property.items as item (item)}
      <span class="chip">
        {#if tagged && onsearch}
          <button class="chip-word" onclick={() => onsearch(`tag:${item}`)}>{item}</button>
        {:else}
          {item}
        {/if}
        {#if writable && property.kind === 'list'}
          <button
            class="chip-off"
            title={t('Remove')}
            aria-label={t('Remove')}
            onclick={() => {
              const items = withoutItem(property, item)
              if (items) onitems(items)
            }}><Cross small /></button
          >
        {/if}
      </span>
    {/each}
    {#if writable && property.kind === 'list'}
      <input
        class="field add"
        placeholder={t('Add')}
        aria-label={t('Add')}
        use:focusOnMount
        onkeydown={(event) => {
          if (event.key !== 'Enter' || event.isComposing) return
          event.preventDefault()
          addItem(event.currentTarget)
        }}
        onblur={(event) => addItem(event.currentTarget)}
      />
    {/if}
  {:else if property.kind === 'checkbox'}
    <input
      type="checkbox"
      class="nib-checkbox"
      checked={property.value.toLowerCase() === 'true'}
      disabled={!writable}
      aria-label={property.key}
      use:focusOnMount
      onchange={(event) => onwrite(event.currentTarget.checked ? 'true' : 'false')}
    />
  {:else if choices && writable}
    <select
      class="field"
      aria-label={property.key}
      value={property.value}
      use:focusOnMount
      onchange={(event) => onwrite(event.currentTarget.value || null)}
    >
      {#each choices.includes(property.value) || !property.value ? choices : [property.value, ...choices] as one (one)}
        <option value={one}>{one}</option>
      {/each}
    </select>
  {:else}
    <input
      class="field"
      type={fieldType(property)}
      value={fieldType(property) === 'datetime-local'
        ? property.value.replace(' ', 'T')
        : property.value}
      readonly={!writable}
      aria-label={property.key}
      use:focusOnMount
      onkeydown={commitOnEnter}
      onchange={(event) => onwrite(dated(event.currentTarget) || null)}
    />
  {/if}
</span>

<style>
  .value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: var(--row-height);
    color: var(--text);
  }

  /* A field with no box until a pointer or the keyboard arrives, so the rows go on
     reading as metadata rather than as a form: the note's own controls, drawn the
     same way; see editor.css. */
  .field {
    min-width: 0;
    width: 100%;
    padding: 0.2em 0.35em;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .field[type='number'],
  .field[type='date'],
  .field[type='datetime-local'] {
    font-variant-numeric: tabular-nums;
  }

  @media (hover: hover) {
    .field:hover:not([readonly]) {
      border-color: var(--line);
    }
  }

  .field.add {
    flex: 1 1 5em;
    width: auto;
    color: var(--muted);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .chip-word,
  .chip-off {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: default;
  }

  .chip-off {
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* The small cross a tab closes with, at the size it is on a tab. */
  .chip-off :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  @media (hover: hover) {
    .chip-word:hover {
      color: var(--accent);
    }

    .chip:hover .chip-off {
      opacity: 1;
    }
  }

  .chip-off:focus-visible,
  :global([data-touch]) .chip-off {
    opacity: 1;
  }
</style>
