/** "Copy to a base": a view nib ships, or a fence in a note, written out as a `.base`
 *  file the reader then owns and changes (docs/tasks.md 5.4). At the root of the open
 *  space under the view's name, a number after it where the name is taken, and opened
 *  in place of nothing: the tab it was copied from stays what it was. */

import { joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { openBaseFile } from './open'

/** A file name made of a view's name: what a file system can hold of it. */
function baseFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned || 'View'}.base`
}

export async function copyToBase(yaml: string, name: string): Promise<string | null> {
  const root = workspace.activeSpace?.root
  if (root === undefined) return null
  const path = joinPath(root, workspace.freeName(root, baseFileName(name)))
  await writeFile(path, yaml)
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  openBaseFile(path)
  return path
}
