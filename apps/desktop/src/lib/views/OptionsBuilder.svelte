<script lang="ts">
  /** A property's choices, Notion's select and status (docs/tasks.md 4): each a tone,
   *  its words and, for a status, To do, Doing or Done. Renaming a choice renames it in
   *  every note that holds it, as one write. A column that had none starts with the
   *  values its notes already hold, each in the next tone, which is how a text column
   *  becomes a select.
   *
   *  The column of a base's ids has no choices: it has its prefix, and a new one is
   *  written into every id at once. */
  import { inBase, type SelectOption } from '@nib/bases'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { writeEach } from './act'
  import { bare } from './columns'
  import { setBaseNib, setProperty } from './edit'
  import type { Kit } from './kit'
  import { optionsAt, renamedIn, reprefixed } from './options'
  import ToneDot from './ToneDot.svelte'

  const { kit, column }: { kit: Kit; column: string } = $props()

  const live = $derived(kit.live)
  const key = $derived(bare(column))
  const options = $derived(live.base ? optionsAt(live.base, column) : [])
  const id = $derived(live.base?.nib.id?.property === key ? live.base.nib.id : null)

  const GROUPS = [
    { value: '', label: t('None') },
    { value: 'todo', label: t('To do') },
    { value: 'doing', label: t('Doing') },
    { value: 'done', label: t('Done') },
  ]

  function write(next: SelectOption[]) {
    kit.change((base) => setProperty(base, key, { options: next.length ? next : undefined }))
  }

  function change(at: number, option: SelectOption) {
    write(options.map((one, index) => (index === at ? option : one)))
  }

  function rename(at: number, words: string) {
    const was = options[at]
    const value = words.trim()
    if (!was || !value || value === was.value || options.some((one) => one.value === value)) return
    change(at, { ...was, value })
    void writeEach(
      live.rows.flatMap((row) => {
        const one = renamedIn(row, column, was.value, value)
        return one ? [{ row, change: one }] : []
      }),
    )
  }

  function add() {
    let value = t('New')
    for (let count = 2; options.some((one) => one.value === value); count++)
      value = `${t('New')} ${count}`
    write([...options, { value, tone: String((options.length % 6) + 1) }])
  }

  function prefix(words: string) {
    const base = live.base
    if (!base || !id) return
    const next = words.trim().replace(/\s+/g, '-')
    if (next === id.prefix) return
    kit.change((one) => setBaseNib(one, 'id', { property: id.property, prefix: next }))
    const own = live.rows.filter((row) => inBase(base, row, live.context))
    void writeEach(reprefixed(own, id.property, id.prefix, next))
  }
</script>

{#if id}
  <label class="row prefix">
    <span class="key">{t('Prefix')}</span>
    <input
      class="nib-field"
      value={id.prefix}
      aria-label={t('Prefix')}
      onchange={(event) => prefix(event.currentTarget.value)}
    />
  </label>
{:else}
  {#each options as option, at (option.value)}
    <div class="row">
      <ToneDot
        tone={option.tone}
        ontone={(tone) => {
          const next: SelectOption = { value: option.value }
          if (option.group) next.group = option.group
          if (tone !== null) next.tone = tone
          change(at, next)
        }}
      />
      <input
        class="nib-field"
        value={option.value}
        aria-label={t('Value')}
        onchange={(event) => rename(at, event.currentTarget.value)}
      />
      <Select
        label={t('Status')}
        value={option.group ?? ''}
        options={GROUPS}
        onchange={(group: string) => {
          const next: SelectOption = { value: option.value }
          if (option.tone) next.tone = option.tone
          if (group === 'todo' || group === 'doing' || group === 'done') next.group = group
          change(at, next)
        }}
      />
      <button
        type="button"
        class="nib-glyph"
        title={t('Remove')}
        aria-label={t('Remove')}
        onclick={() => write(options.filter((_, index) => index !== at))}><Cross small /></button
      >
    </div>
  {/each}

  <button type="button" class="nib-row is-short adder" onclick={add}>
    <span class="nib-row-label">{t('Add')}</span>
  </button>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 0.7fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .prefix {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .key {
    color: var(--muted-strong);
  }

  .adder .nib-row-label {
    color: var(--muted);
  }
</style>
