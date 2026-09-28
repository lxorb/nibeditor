/** "Save as", which is only ever about a file the app does not keep.
 *
 *  A note in a space needs no Save at all: it is written as it is typed and synced
 *  from there, so "save it somewhere else" would mean taking it out of the space,
 *  which is what an export is for. A file opened from anywhere else on the disk is
 *  the reader's own file, saved back to its own path, and that is the one for which
 *  "somewhere else" is a real thing to ask.
 *
 *  So this writes the words to a path the reader chooses and opens that file, the
 *  way every editor's Save as does: what is in front of them afterwards is the new
 *  file, and the old one is left as it was. */

import { t } from './i18n.svelte'
import { isDesktop } from './tauri'
import { workspace } from './workspace.svelte'

/** Whether a path is a file of its own on the disk rather than a note in a space.
 *
 *  The other half of `keepsItself`, which is where the rule lives: a note in a
 *  space is Nib's to look after, and a file from anywhere else is nobody's but the
 *  reader's. Asked through that rather than by comparing paths here, so "external"
 *  can only ever mean one thing. A note with no path at all is neither: it has
 *  never been anywhere. */
export function isExternalFile(path: string | null): boolean {
  return path !== null && path !== '' && !workspace.keepsItself(path)
}

/** Whether the row is worth offering: a desktop, and a file of the reader's own
 *  in front of them. */
export function canSaveAs(): boolean {
  const note = workspace.active
  return isDesktop && note?.kind === 'note' && isExternalFile(note.path)
}

export async function saveAs(): Promise<void> {
  if (!canSaveAs()) return

  workspace.flush()
  const note = workspace.active
  if (!note) return

  // The dialog and the writer are fetched by the press that asks for them: this file is
  // in the first paint for `isExternalFile`, which the watch on outside files reads,
  // and the writer behind it is eleven kilobytes nobody needs to open a note.
  const { chooseTarget, writeFile } = await import('./export/save')
  const target = await chooseTarget(note.name, 'md', t('Markdown'))
  if (!target) return

  await writeFile(target, note.doc)
  await workspace.open(target)
}
