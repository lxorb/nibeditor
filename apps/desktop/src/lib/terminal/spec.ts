/** What a terminal tab is, written down: which shell, the folder it was last in, and the
 *  key its last lines are kept under.
 *
 *  A terminal is a session and not a file, so none of this is ever on disk in a space.
 *  It is the tab's own words, the way a new plane's JSON is: the session keeps the words
 *  of every tab that has no file, so a restart, the closed-tab stack and Duplicate all
 *  carry a terminal with no field of their own for it. See `openUnsaved` in
 *  workspace.svelte.ts and docs/terminal.md.
 *
 *  And where one starts, which is the question every door to a new terminal asks.
 *
 *  Pure, and light: the doors import it before any of xterm.js is fetched. */

import { folderOf, withinSpace } from '../space-paths'
import { isRecord, isString } from '../stored'

export interface Spec {
  /** The shell's id, as the crate found it: `pwsh`, `cmd`, `wsl:Ubuntu`, `/bin/zsh`. */
  shell: string
  /** Where the shell was last seen, or null for wherever the crate starts it: home. A
   *  Linux path for a WSL shell, which is handed back to it with `--cd`. */
  folder: string | null
  /** What the tab's last lines are kept under between runs; made once, with the tab. */
  key: string
}

/** A tab's words as a spec, or null for words that are not one. Read rather than
 *  trusted: they came back out of storage. */
export function readSpec(text: string): Spec | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Not JSON is not a terminal; the caller opens the default shell instead.
    return null
  }
  if (!isRecord(value) || !isString(value.shell) || !value.shell) return null

  return {
    shell: value.shell,
    folder: isString(value.folder) && value.folder ? value.folder : null,
    key: isString(value.key) && value.key ? value.key : '',
  }
}

export function writeSpec(spec: Spec): string {
  return JSON.stringify({ shell: spec.shell, folder: spec.folder, key: spec.key })
}

/** Where a new terminal starts: the folder of the space being worked in, which is where
 *  a person who opens a shell beside their notes means to be - VS Code's workspace root.
 *  Except for a file in no space - the app's own `custom.css` or `snippets.json`, the one
 *  kind nib opens from outside its spaces - whose own folder is the one that has
 *  anything to do with it. Null where there is neither, and the shell starts at home. */
export function startingFolder(
  showing: string | null,
  space: string | null,
  roots: readonly string[],
): string | null {
  if (showing !== null && !roots.some((root) => withinSpace(root, showing) !== null)) {
    const folder = folderOf(showing)
    if (folder) return folder
  }

  return space
}

/** The folder a shell reported, out of the two sequences shells report one with.
 *
 *  OSC 9;9 is Windows Terminal's, with a Windows path: what Command Prompt and PowerShell
 *  are taught to say (see shells.rs). OSC 7 is the older one, with a `file://` address:
 *  bash, zsh and fish say that. Git Bash's `/c/Users/me` is `C:\Users\me` to the crate
 *  that starts the next shell there, and `file:///C:/Users/me` from a shell on Windows is
 *  a Windows path too; a WSL shell's `/home/me` stays a Linux path, which the crate hands
 *  back with `--cd`. Null for anything that does not read as a folder. */
export function reportedFolder(
  code: 7 | 9,
  data: string,
  windows: boolean,
  wsl: boolean,
): string | null {
  if (code === 9) {
    if (!data.startsWith('9;')) return null
    const path = data.slice(2).replace(/^"(.*)"$/, '$1')
    return path ? path : null
  }

  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  if (!match?.[1]) return null

  let path: string
  try {
    path = decodeURIComponent(match[1])
  } catch {
    // A `%` that is not an escape is the path's own character, as a shell that did not
    // encode it meant it.
    path = match[1]
  }

  if (!windows || wsl) return path

  const drive = /^\/([A-Za-z])(?::?)(\/.*)?$/.exec(path)
  if (!drive?.[1]) return null
  return `${drive[1].toUpperCase()}:${(drive[2] ?? '/').replace(/\//g, '\\')}`
}
