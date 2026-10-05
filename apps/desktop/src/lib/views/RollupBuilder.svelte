<script lang="ts">
  /** A rollup, made from three choices rather than a formula (docs/tasks.md 5.12): the
   *  relation (a property of links, or a column of notes linking here), what of the
   *  related notes to read, and how to sum them up. Written as a formula Obsidian reads
   *  too (`rollupFormula` in @nib/bases) and shown as a column; pressed on a rollup's
   *  column again, the choices it was made from come back. */
  import { readReverse, readRollup, type Rollup, ROLLUPS, rollupFormula } from '@nib/bases'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { relationsOf } from './columns'
  import { freeFormulaName, setColumns, setFormula } from './edit'
  import type { Kit } from './kit'
  import { propertyName, summaryName } from './words'

  const { kit, column }: { kit: Kit; column?: string | undefined } = $props()

  const live = $derived(kit.live)
  const base = $derived(live.base)
  /** The rollup's column: the one it was opened on, or the one its first choice made. */
  let made = $state<string | undefined>(undefined)
  const target = $derived(made ?? column)
  const editing = $derived(
    target?.startsWith('formula.') && base ? (base.formulas[target.slice(8)] ?? null) : null,
  )
  const was = $derived(editing === null ? null : readRollup(editing))

  /** Every relation a rollup can start from: the views' notes' link properties, and
   *  the base's reverse columns. */
  const relations = $derived([
    ...relationsOf(live.rows).map((one) => ({ value: one, label: propertyName(one) })),
    ...Object.entries(base?.formulas ?? {})
      .filter(([, source]) => readReverse(source) !== null)
      .map(([name]) => ({ value: `formula.${name}`, label: `← ${name}` })),
  ])

  /** Every front matter key the space's notes have: what of a related note to read. */
  const keys = $derived.by(() => {
    const seen = new Set<string>()
    for (const row of live.rows) {
      if (row.kind !== 'note') continue
      for (const key of Object.keys(row.note)) seen.add(key)
      if (seen.size > 200) break
    }
    return [...seen].sort()
  })

  const NAMES: Record<Rollup, string> = {
    count: t('Count'),
    filled: summaryName('Filled'),
    unique: summaryName('Unique'),
    sum: summaryName('Sum'),
    average: summaryName('Average'),
    median: summaryName('Median'),
    min: summaryName('Min'),
    max: summaryName('Max'),
    range: summaryName('Range'),
    checked: summaryName('Checked'),
    percent: t('Percent ticked'),
  }

  let relation = $state('')
  let property = $state('')
  let calc = $state<Rollup>('count')
  $effect(() => {
    relation = was?.relation ?? relations[0]?.value ?? ''
    property = was?.property ?? ''
    calc = was?.calc ?? 'count'
  })

  /** Writes the rollup: the formula where it was, or a new one shown as a column. */
  function write() {
    if (!relation || !base) return
    const source = rollupFormula(
      property && calc !== 'count' ? { relation, property, calc } : { relation, calc: 'count' },
    )
    if (target?.startsWith('formula.') && editing !== null) {
      const name = target.slice(8)
      kit.change((one) => setFormula(one, name, source))
      return
    }
    const named = (relation.split('.').pop() ?? 'rollup').replace(/\W+/g, '_')
    const name = freeFormulaName(
      base,
      property ? `${named}_${property.replace(/\W+/g, '_')}` : `${named}_count`,
    )
    made = `formula.${name}`
    const columns = [...live.columns, `formula.${name}`]
    kit.change((one, at) => setColumns(setFormula(one, name, source), at, columns))
  }
</script>

<div class="rows">
  <Select
    label={t('Rollup')}
    value={relation}
    options={relations}
    onchange={(next: string) => {
      relation = next
      write()
    }}
  />
  <Select
    label={t('Property')}
    value={property}
    options={[{ value: '', label: t('Notes') }, ...keys.map((one) => ({ value: one, label: one }))]}
    onchange={(next: string) => {
      property = next
      if (!next) calc = 'count'
      write()
    }}
  />
  <Select
    label={t('Summary')}
    value={calc}
    options={(property ? ROLLUPS : (['count'] as const)).map((one) => ({
      value: one,
      label: NAMES[one],
    }))}
    onchange={(next: string) => {
      const found = ROLLUPS.find((one) => one === next)
      if (found) calc = found
      write()
    }}
  />
</div>

<style>
  .rows {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
</style>
