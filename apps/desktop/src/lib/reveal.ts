/** Showing a file where it sits, in the system's own file manager.
 *
 *  The words are each platform's own. A Mac says Finder: "Show in Finder" on a
 *  download, as Safari's downloads say it, and "Reveal in Finder" on a row of the
 *  file list, as Obsidian's file list says it (row-menu.ts writes that one itself,
 *  so the list does not fetch this module before it is needed). Windows and Linux
 *  keep the one phrase they had, because a Linux desktop has no one file manager
 *  to name. */

import { key } from './i18n.svelte'
import { isDesktop, platform } from './tauri'

/** The words on a download's row for showing its file, untranslated: the caller
 *  hands them to `t`, so the catalogues see them. */
export function showLabel(system: string = platform()): string {
  return system === 'macos' ? key('Show in Finder') : key('Show in folder')
}

/** Opens the file manager at a file, selected. Only the desktop has one to open. */
export async function reveal(path: string): Promise<void> {
  if (!isDesktop) return

  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path).catch(() => undefined)
}
