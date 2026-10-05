/** A view as CSV (docs/tasks.md 4): its rows in the order and the groups it shows them,
 *  its columns as their names, every cell the value a spreadsheet reads
 *  (`csvValue` in @nib/bases). Copied, or saved as a file the way an export is. A
 *  button column has nothing to say in a spreadsheet and is left out. */

import { cellValue, csvText, csvValue, isButton } from '@nib/bases'
import { copyText } from '../clipboard'
import { deliver } from '../export/save'
import { t } from '../i18n.svelte'
import { displayName } from './columns'
import type { LiveView } from './live.svelte'
import { propertyName } from './words'

/** The view showing, as CSV; null where there is nothing to show. */
function viewCsv(live: LiveView): string | null {
  const base = live.base
  const answer = live.answer
  if (!base || !answer) return null
  const columns = live.columns.filter((one) => !isButton(one))
  const header = columns.map((one) => propertyName(one, displayName(base, one)))
  const rows = answer.groups.flatMap((group) =>
    group.rows.map((row) =>
      columns.map((column) => csvValue(cellValue(base, column, row, live.context))),
    ),
  )
  return csvText(header, rows)
}

export async function copyCsv(live: LiveView): Promise<void> {
  const csv = viewCsv(live)
  if (csv !== null) await copyText(csv)
}

export async function saveCsv(live: LiveView, name: string): Promise<void> {
  const csv = viewCsv(live)
  if (csv !== null) await deliver(name, 'csv', t('Spreadsheet'), { text: csv, mime: 'text/csv' })
}
