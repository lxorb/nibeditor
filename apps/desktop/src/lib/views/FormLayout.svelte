<script lang="ts">
  /** A form, Notion's (docs/tasks.md 5.9): the view's properties as fields under a name,
   *  and Send makes the note where the base's rows go, with what was filled in, the
   *  base's template and its next id (add.ts), then empties itself for the next one.
   *  A field the view says is required (`nib.required`) has to be filled before it
   *  sends; one that is not shakes. A field's menu is a column's (column-menu.ts), so
   *  hiding, adding and making a field required are where a table has them.
   *
   *  Its own controls rather than a cell's: a form fills a note that does not exist
   *  yet, so there is nothing for the one write path to write into until it is sent. */
  import type { Value } from '@nib/bases'
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import Select from '../Select.svelte'
  import { workspace } from '../workspace.svelte'
  import { addNote } from './add'
  import { columnMenu } from './column-menu'
  import { bare, displayName, editorOf, isNoteProperty, optionsOf } from './columns'
  import type { Kit } from './kit'
  import { propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const base = $derived(live.base)
  const view = $derived(live.view)
  /** The fields: the view's columns that are a note's own properties, but its id. */
  const fields = $derived(
    live.columns.filter((one) => isNoteProperty(one) && bare(one) !== base?.nib.id?.property),
  )
  const required = $derived(new Set(view?.nib.required ?? []))

  let title = $state('')
  let values = $state<Record<string, string | boolean>>({})
  /** The fields that were empty when Send was pressed, and the note the last send made. */
  let missing = $state<string[]>([])
  let sent = $state<{ path: string; name: string } | null>(null)
  let sending = $state(false)

  const kindOf = (field: string) => (base ? editorOf(base, field, live.rows) : 'text')

  /** What a field's words are worth as a property. */
  function valueOf(field: string, said: string | boolean): Value | null {
    if (typeof said === 'boolean') return said
    const words = said.trim()
    if (!words) return null
    const kind = kindOf(field)
    if (kind === 'number') return Number.isFinite(Number(words)) ? Number(words) : words
    if (kind === 'date') return { kind: 'date', iso: words }
    if (kind === 'list')
      return words
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean)
    return words
  }

  async function send() {
    if (!base || sending) return
    const properties: Record<string, Value> = {}
    for (const field of fields) {
      const value = valueOf(field, values[field] ?? '')
      if (value !== null) properties[bare(field)] = value
    }
    missing = fields.filter((one) => required.has(bare(one)) && !(bare(one) in properties))
    if (missing.length) return
    sending = true
    try {
      const name = title.trim() || t('Untitled')
      const path = await addNote(base, live.at, kit.file, undefined, {
        title: name,
        properties,
        open: false,
      })
      if (path !== null) sent = { path, name }
      title = ''
      values = {}
    } finally {
      sending = false
    }
  }

  function fieldMenu(event: MouseEvent, field: string) {
    if (!base) return
    event.preventDefault()
    menu.show(event, columnMenu(kit, field, live.columns, event), {
      title: propertyName(field, displayName(base, field)),
    })
  }
</script>

<form
  class="form"
  onsubmit={(event) => {
    event.preventDefault()
    void send()
  }}
>
  <input
    class="nib-field title"
    bind:value={title}
    aria-label={t('Name')}
    placeholder={t('Untitled')}
  />

  {#each fields as field (field)}
    {@const kind = kindOf(field)}
    {@const key = bare(field)}
    {@const choices = base ? optionsOf(base, field) : []}
    <div class="field" class:missing={missing.includes(field)}>
      <span class="name" role="presentation" oncontextmenu={(event) => fieldMenu(event, field)}>
        {propertyName(
          field,
          base ? displayName(base, field) : undefined,
        )}{#if required.has(key)}<span class="needed" aria-hidden="true">*</span>{/if}
      </span>
      {#if kind === 'checkbox'}
        <input
          type="checkbox"
          class="nib-checkbox"
          aria-label={propertyName(field, base ? displayName(base, field) : undefined)}
          checked={values[field] === true}
          onchange={(event) => (values = { ...values, [field]: event.currentTarget.checked })}
        />
      {:else if choices.length}
        <Select
          label={propertyName(field)}
          value={typeof values[field] === 'string' ? values[field] : ''}
          options={[
            { value: '', label: t('None') },
            ...choices.map((one) => ({ value: one, label: one })),
          ]}
          onchange={(next: string) => (values = { ...values, [field]: next })}
        />
      {:else}
        <input
          class="nib-field"
          aria-label={propertyName(field, base ? displayName(base, field) : undefined)}
          type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
          value={typeof values[field] === 'string' ? values[field] : ''}
          oninput={(event) => (values = { ...values, [field]: event.currentTarget.value })}
        />
      {/if}
    </div>
  {/each}

  <div class="foot">
    {#if sent}
      {@const made = sent}
      <button
        type="button"
        class="nib-chip made"
        onclick={() => void workspace.openAside(made.path)}>✓ {made.name}</button
      >
    {/if}
    <span class="spring"></span>
    <button type="submit" class="nib-button" disabled={sending}>{t('Send')}</button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 560px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .title {
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .name {
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }

  .needed {
    margin-inline-start: 0.2em;
    color: var(--danger);
  }

  .missing {
    animation: shake var(--dur-base) var(--ease-out);
  }

  @keyframes shake {
    20%,
    60% {
      translate: -3px 0;
    }
    40%,
    80% {
      translate: 3px 0;
    }
  }

  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .spring {
    flex: 1;
  }

  .made {
    animation: arrive var(--dur-base) var(--ease-out);
  }

  @keyframes arrive {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }
</style>
