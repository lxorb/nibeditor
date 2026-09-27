/** Showing a file where it sits, in the system's own file manager.
 *
 *  The words are each platform's own. A Mac says Finder, the way Safari's
 *  downloads say "Show in Finder" and Obsidian's file list says "Reveal in
 *  Finder"; Windows and Linux keep the one phrase they had, because a Linux
 *  desktop has no one file manager to name. */

import { key } from './i18n.svelte'
import { isDesktop, platform } from './tauri'

/** Where a row of a list says it will show a file: a download's own row, which
 *  reads as a browser's, or a row of the file list, which reads as Obsidian's. */
export type RevealFrom = 'download' | 'tree'

/** The words for showing a file in the file manager, untranslated: the caller
 *  hands them to `t`, so the catalogues see every one of them. */
export function revealLabel(from: RevealFrom, system: string = platform()): string {
  if (system !== 'macos') return key('Show in folder')
  return from === 'download' ? key('Show in Finder') : key('Reveal in Finder')
}

/** Opens the file manager at a file, selected. Only the desktop has one to open. */
export async function reveal(path: string): Promise<void> {
  if (!isDesktop) return

  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path).catch(() => undefined)
}
