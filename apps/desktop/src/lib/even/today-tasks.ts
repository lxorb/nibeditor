/** Today on the glasses, read the lean way: the open space's tasks off the link index's
 *  own scan (a note saved since is read again), Today worked out by hand rather than by
 *  the rows engine, which the plugin does not carry (docs/even.md, `todayTasks`). */

import { links } from '../link-index.svelte'
import { insideSpace } from '../space-paths'
import { workspace } from '../workspace.svelte'

export async function todayHere(): Promise<{ at: string; space: string; text: string }[]> {
  const space = workspace.activeSpace
  if (!space) return []
  const { clockOf, scannedTaskRows, scanRows, taskOut, todayTasks } =
    await import('@nib/bases/tasks')
  const rows = []
  for (const note of links.held()) {
    if (!/\.(md|markdown)$/i.test(note.path)) continue
    const tasks =
      note.tasks ??
      scanRows((await workspace.noteText(insideSpace(space.root, note.path))) ?? '').tasks
    rows.push(...scannedTaskRows(space.name, note.path, tasks))
  }
  return todayTasks(rows, clockOf(new Date()).today).map(taskOut)
}
