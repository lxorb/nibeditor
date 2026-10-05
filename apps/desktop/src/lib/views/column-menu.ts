/** A column's menu, the table's header pressed with the other button and a form's
 *  field: its sort and its summary, the columns that can be added beside it, what its
 *  property is (its choices, its format), a rollup's or a button's own builder, the
 *  freeze, and hiding it (docs/tasks.md 4).
 *
 *  "Add a column" offers every property the rows have, then what lane 7 adds: the
 *  notes elsewhere that link here as a reverse column, a rollup, a button, and the
 *  base's ids where it has none. Turning ids on numbers every row the base has, in the
 *  order they were made, as one write. */

import {
  DEFAULT_SUMMARIES,
  idRepairs,
  inBase,
  isButton,
  readRollup,
  reverseFormula,
} from '@nib/bases'
import { i18n, t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { writeEach } from './act'
import {
  bare,
  displayName,
  formatOf,
  isNoteProperty,
  knownProperties,
  reverseOffers,
} from './columns'
import {
  freeFormulaName,
  setBaseNib,
  setColumns,
  setFormula,
  setProperty,
  setSort,
  setSummary,
  setViewNib,
} from './edit'
import { FORMATS } from './format'
import type { Kit } from './kit'
import { optionsAt, optionsFor, valuesOf } from './options'
import { propertyName, summaryName } from './words'

/** What a format is called in its menu: a currency by its sign. */
function formatName(format: string): string {
  if (format.startsWith('currency:')) {
    const code = format.slice(9)
    try {
      return (
        new Intl.NumberFormat(i18n.language, { style: 'currency', currency: code })
          .formatToParts(0)
          .find((part) => part.type === 'currency')?.value ?? code
      )
    } catch {
      return code
    }
  }
  switch (format) {
    case 'number':
      return t('Number')
    case 'percent':
      return t('Percent')
    case 'progress':
      return t('Progress')
    case 'url':
      return t('Web address')
    case 'email':
      return t('Email')
    default:
      return t('Phone')
  }
}

/** The key nib.properties keeps a column's settings under. */
const keyOf = (column: string) => (column.startsWith('formula.') ? column.slice(8) : bare(column))

/** The rows a menu offers to add beside the columns showing. */
function additions(kit: Kit, columns: readonly string[]): MenuEntry[] {
  const live = kit.live
  const base = live.base
  if (!base) return []
  const kinds = live.view?.nib.rows ?? 'notes'
  const add = (column: string) => kit.change((b, at) => setColumns(b, at, [...columns, column]))
  const others = knownProperties(base, kinds, live.rows)
    .filter((one) => !columns.includes(one))
    .map((one) => ({ label: propertyName(one, displayName(base, one)), run: () => add(one) }))
  if (kinds !== 'notes') return others

  const shown = live.answer?.groups.flatMap((group) => group.rows) ?? []
  const reverse = reverseOffers(base, shown, live.rows, live.context).map((offer) => ({
    label: `← ${offer.name}`,
    run: () => {
      const name = freeFormulaName(base, offer.name)
      kit.change((b, at) =>
        setColumns(setFormula(b, name, reverseFormula(offer.property)), at, [
          ...columns,
          `formula.${name}`,
        ]),
      )
    },
  }))
  const ids = base.nib.id
    ? []
    : [
        {
          label: t('Unique ID'),
          run: () => {
            if (live.locked) {
              live.refused++
              return
            }
            const property = 'id'
            kit.change((b, at) =>
              setColumns(setBaseNib(b, 'id', { property, prefix: '' }), at, [
                ...columns,
                `note.${property}`,
              ]),
            )
            const own = live.rows.filter((row) => inBase(base, row, live.context))
            void writeEach(
              idRepairs(own, property, '').map(({ row, id }) => ({
                row,
                change: { note: { [property]: id } },
              })),
            )
          },
        },
      ]
  return [
    ...others,
    DIVIDER,
    ...reverse,
    { label: t('Rollup'), run: () => (live.builder = { kind: 'rollup' }) },
    { label: t('Button'), run: () => (live.builder = { kind: 'button' }) },
    ...ids,
  ]
}

export function columnMenu(kit: Kit, column: string, columns: readonly string[]): MenuEntry[] {
  const live = kit.live
  const base = live.base
  if (!base) return []
  const view = live.view
  const place = columns.indexOf(column)
  const frozen = view?.nib.freeze ?? 0
  const formula = column.startsWith('formula.') ? base.formulas[column.slice(8)] : undefined
  const note = isNoteProperty(column)
  const format = formatOf(base, column)

  return [
    {
      label: t('Ascending'),
      run: () => kit.change((b, i) => setSort(b, i, [{ property: column, direction: 'ASC' }])),
    },
    {
      label: t('Descending'),
      run: () => kit.change((b, i) => setSort(b, i, [{ property: column, direction: 'DESC' }])),
    },
    DIVIDER,
    {
      label: t('Summary'),
      run: () => undefined,
      more: () =>
        Promise.resolve([
          {
            label: t('None'),
            checked: !view?.summaries[column],
            run: () => kit.change((b, i) => setSummary(b, i, column, null)),
          },
          ...DEFAULT_SUMMARIES.map((name) => ({
            label: summaryName(name),
            checked: view?.summaries[column] === name,
            run: () => kit.change((b, i) => setSummary(b, i, column, name)),
          })),
        ]),
    },
    {
      label: t('Add a column'),
      run: () => undefined,
      more: () => Promise.resolve(additions(kit, columns)),
    },
    DIVIDER,
    ...(note
      ? [
          {
            label: t('Options'),
            checked: optionsAt(base, column).length > 0,
            run: () => {
              if (!optionsAt(base, column).length && base.nib.id?.property !== bare(column)) {
                const options = optionsFor(valuesOf(live.rows, column))
                kit.change((b) => setProperty(b, keyOf(column), { options }))
              }
              live.builder = { kind: 'options', column }
            },
          },
        ]
      : []),
    ...(note || formula !== undefined
      ? [
          {
            label: t('Format'),
            run: () => undefined,
            more: () =>
              Promise.resolve([
                {
                  label: t('None'),
                  checked: format === undefined,
                  run: () =>
                    kit.change((b) => setProperty(b, keyOf(column), { format: undefined })),
                },
                ...FORMATS.map((one) => ({
                  label: formatName(one),
                  checked: format === one,
                  run: () => kit.change((b) => setProperty(b, keyOf(column), { format: one })),
                })),
              ]),
          },
        ]
      : []),
    ...(formula !== undefined && readRollup(formula) !== null
      ? [{ label: t('Edit'), run: () => (live.builder = { kind: 'rollup', column }) }]
      : []),
    ...(isButton(column)
      ? [{ label: t('Edit'), run: () => (live.builder = { kind: 'button', column }) }]
      : []),
    ...(view?.type === 'form' && note
      ? [
          {
            label: t('Required'),
            checked: view.nib.required?.includes(bare(column)) === true,
            run: () =>
              kit.change((b, i) => {
                const was = b.views[i]?.nib.required ?? []
                const key = bare(column)
                const next = was.includes(key) ? was.filter((one) => one !== key) : [...was, key]
                return setViewNib(b, i, 'required', next.length ? next : undefined)
              }),
          },
        ]
      : []),
    ...(view?.type === 'table' || view?.type === undefined
      ? [
          place < frozen
            ? {
                label: t('Unfreeze'),
                run: () => kit.change((b, i) => setViewNib(b, i, 'freeze', undefined)),
              }
            : {
                label: t('Freeze up to here'),
                run: () => kit.change((b, i) => setViewNib(b, i, 'freeze', place + 1)),
              },
        ]
      : []),
    DIVIDER,
    {
      label: t('Hide'),
      disabled: columns.length < 2,
      run: () =>
        kit.change((b, i) =>
          setColumns(
            b,
            i,
            columns.filter((one) => one !== column),
          ),
        ),
    },
  ]
}
