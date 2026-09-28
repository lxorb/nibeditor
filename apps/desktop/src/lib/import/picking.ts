/** Getting the export off the reader's machine, on all three platforms.
 *
 *  The browser's own file input rather than the desktop dialog, for the same
 *  reason inserting a picture uses it: it hands back the file's bytes, where a
 *  dialog hands back a path whose bytes then have to be read back out through the
 *  crate - and it is the one door that exists in a webview, in a browser and on a
 *  phone. So one piece of code serves the lot.
 *
 *  A folder can be dropped as well as a file, because a Logseq graph and an
 *  unzipped Notion export are folders. That works wherever the webview gives out
 *  its entries, which is every desktop and the web; a phone hands over files
 *  alone, and there a zip is what to drop. */

import { chooseFiles } from '../choose-files'
import { caughtFiles, type CaughtFiles } from '../drag-paths'
import { tidyPath, type Picked } from './sources'

/** Anything the browser will let a reader choose. Narrowing it would hide the
 *  file somebody actually has: exporters write `.zip`, `.enex`, `.json`, `.csv`,
 *  `.md`, `.html`, `.note`, `.textbundle` and a handful of others. */
export function pickFiles(): Promise<Picked[]> {
  return chooseFiles({ multiple: true })
}

/** A whole folder, every file in it with its path inside: Obsidian's "Open folder as
 *  vault", which is how the space chooser brings one in. The webview's own folder
 *  dialog, for the reason above - it hands back bytes, where a path would have to be
 *  read back out through the crate, and paths.rs keeps the crate to the spaces.
 *
 *  On a Mac that dialog is wry's: its `WKUIDelegate` answers
 *  `runOpenPanelWithParameters` with an `NSOpenPanel` that can choose folders
 *  whenever the page asks for one, which `webkitdirectory` does. The delegate
 *  web_tabs.rs puts in front of it hands that selector straight through, so the
 *  app's own page keeps it. */
export function pickFolder(): Promise<Picked[]> {
  return chooseFiles({ multiple: true, folder: true })
}

/** Everything that was dropped, folders walked where the webview allows it. */
export async function droppedFiles(transfer: DataTransfer | null): Promise<Picked[]> {
  return transfer ? filesUnder(caughtFiles(transfer)) : []
}

/** The same, for a drop whose files were caught while it happened and are walked
 *  afterwards; see `caughtFiles` in drag-paths.ts. */
export async function filesUnder({ entries, loose }: CaughtFiles): Promise<Picked[]> {
  if (!entries.length) return loose

  const found: Picked[] = []
  for (const entry of entries) await walk(entry, found)

  return found.length ? found : loose
}

/** How deep a dropped folder is followed. A graph is two or three deep; a
 *  hundred would be somebody's home folder. */
const DEEPEST = 12

async function walk(entry: FileSystemEntry, found: Picked[], depth = 0) {
  if (depth > DEEPEST) return

  if (entry.isFile) {
    const file = await asFile(entry as FileSystemFileEntry)
    // The path inside the folder that was dropped, which is what the readers
    // work out a note's place from.
    if (file) found.push(named(file, tidyPath(entry.fullPath)))
    return
  }

  for (const child of await children(entry as FileSystemDirectoryEntry)) {
    await walk(child, found, depth + 1)
  }
}

function asFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null))
  })
}

/** A folder's entries, in as many goes as the browser wants to give them: a
 *  reader hands back at most a hundred at a time and answers empty when it is
 *  done. */
function children(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const reader = entry.createReader()
    const all: FileSystemEntry[] = []

    const more = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all)
            return
          }

          all.push(...batch)
          more()
        },
        () => resolve(all),
      )
    }

    more()
  })
}

/** A file under the path it had in the folder that was dropped. `File` will not
 *  be told its own relative path, so it is wrapped rather than changed. */
function named(file: File, path: string): Picked {
  return {
    name: file.name,
    webkitRelativePath: path,
    arrayBuffer: () => file.arrayBuffer(),
  }
}
