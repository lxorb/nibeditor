/** "Open file", which means two different things.
 *
 *  On a desktop the file stays where it is: it opens from its own path, and it
 *  writes itself back to that path as it is typed in, space or no space. In the
 *  browser there is no path to write back to, so opening means uploading: the
 *  text comes in as a new note under the file's own name, and is a note in the
 *  space from the start. */

import { chooseFiles } from './choose-files'
import { isDesktop } from './tauri'
import { workspace } from './workspace.svelte'

const EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt']

export async function openFile() {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Markdown', extensions: EXTENSIONS }],
    })
    // `multiple` makes the dialog answer with a list, or null when cancelled.
    for (const path of picked ?? []) await workspace.open(path)
    return
  }

  const accept = [...EXTENSIONS.map((one) => `.${one}`), 'text/markdown', 'text/plain'].join(',')
  for (const file of await chooseFiles({ accept, multiple: true })) {
    workspace.openBlank(stripExtension(file.name), await file.text())
  }
}

function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
}
