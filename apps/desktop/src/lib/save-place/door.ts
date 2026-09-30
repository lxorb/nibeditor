import { workspace } from '../workspace.svelte'
import { isUnsaved } from '../workspace/drafts'

/** Save's one way in, fetched with the first press; see ask.ts. */
export function askPlace(tabId?: string | null): void {
  void import('./ask').then((one) => one.askPlace(tabId ?? null))
}

/** Ctrl+S and `:w`, which mean one thing: put what is in front on the disk. A tab with
 *  no file is asked where it goes; anything else is written now and kept as a version,
 *  asking nothing. */
export function saveFront(): void {
  const tab = workspace.active
  if (tab && isUnsaved(tab.note)) askPlace(tab.id)
  else void workspace.writeNow()
}
