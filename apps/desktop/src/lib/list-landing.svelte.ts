/** How rows arrive in a folder of the file list from somewhere else: a paste and a
 *  drop. Either moves the list's own rows or copies them, and a drop can bring in
 *  files from outside the app.
 *
 *  The clipboard is the app's own rather than the system's, as VS Code's explorer
 *  keeps it: what it holds is paths in a space. A cut row is drawn faint until the
 *  paste moves it; a copy pastes as often as asked. */

import { caughtFiles, dragged, isFileDrop, landing } from './drag-paths'
import { shortcuts } from './shortcuts.svelte'
import { workspace } from './workspace.svelte'

class FileClipboard {
  paths = $state<string[]>([])
  cut = $state(false)

  private readonly cutting = $derived(new Set(this.cut ? this.paths : []))

  hold(paths: readonly string[], cut: boolean) {
    this.paths = [...paths]
    this.cut = cut
  }

  isCut(path: string): boolean {
    return this.cutting.has(path)
  }

  /** A cut moves, once; a copy copies. Rows gone since are left out. */
  async paste(into: string) {
    const paths = this.paths.filter((one) => workspace.entryAt(one) !== null)
    if (!paths.length) return
    if (!this.cut) return workspace.copyMany(paths, into)

    this.hold([], false)
    return workspace.moveMany(paths, into)
  }
}

export const fileClipboard = new FileClipboard()

/** A drop on a row, or on the stretch under the rows: moved, copied with Ctrl held,
 *  or files from outside copied in. */
export function dropOnList(event: DragEvent, folder: string) {
  const transfer = event.dataTransfer
  // A phone has no Explorer to drop from, and the glasses plugin carries no walk of
  // a dropped folder; see vite.even.config.ts.
  if (transfer && isFileDrop(transfer) && !__EVEN_PLUGIN__) {
    const caught = caughtFiles(transfer)
    void import('./import/picking')
      .then(({ filesUnder }) => filesUnder(caught))
      .then((files) => workspace.bringIn(files, folder))
    return
  }

  const paths = dragged(transfer)
  if (!paths.length) return

  if (landing(event, shortcuts.platform) === 'copy') void workspace.copyMany(paths, folder)
  else void workspace.moveMany(paths, folder)
}
