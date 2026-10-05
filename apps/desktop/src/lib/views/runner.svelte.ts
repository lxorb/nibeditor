/** A space's bases at work while nib runs (docs/tasks.md 5.13): their automations and
 *  their ids on every change to a note, and the repeating templates on their days.
 *
 *  Fetched at the launch order's last turn, after the rows, never in the first paint
 *  (start.ts); importing this is starting it. It reads the open space's `.base` files
 *  once and again when one is written, keeps only the ones that automate something or
 *  number their rows, and listens to the rows (`rows.watch`), one note at a time.
 *
 *  What a change brings about is written as one edit joined to the undo of the edit
 *  that caused it (`writeEach(…, true)`), so one Ctrl+Z takes both back; and the change
 *  that write makes is the runner's own and is not run again, so automations never set
 *  each other off. A move is a file operation and is undone as one. */

import { untrack } from 'svelte'
import { links } from '../link-index.svelte'
import { rows } from '../rows/rows.svelte'
import { workspace } from '../workspace.svelte'
import { basesAre, heard, readHeld, repeatTemplates, running } from './running'

$effect.root(() => {
  // The open space's base files, read again whenever the list of them changes.
  $effect(() => {
    const paths = workspace.files.filter((one) => /\.base$/i.test(one.name)).map((one) => one.path)
    untrack(() => basesAre(paths))
  })
})

links.hearSaves((path) => {
  if (/\.base$/i.test(path)) void readHeld(path)
})

rows.watch((change) => {
  if (change.path === null || !running()) return
  if (!change.added.some((row) => row.kind === 'note')) return
  heard(change.space, change.path, change.removed)
})

// Once the rows are all read, and then every half hour, which also catches the day
// turning over.
const repeat = () => void repeatTemplates().catch(() => undefined)
if (rows.ready) repeat()
else {
  const ready = rows.watch(() => {
    if (!rows.ready) return
    ready()
    repeat()
  })
}
setInterval(repeat, 30 * 60_000)
