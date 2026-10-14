/** Reload window: the window loaded again, as a browser's reload does a page and VS
 *  Code's Reload Window does its own, with nothing of the reader's lost on the way.
 *
 *  The same order a close goes in (start.ts): what runs is asked about first, as a
 *  close asks, since a reload ends this window's shells and agents as surely; then the
 *  pages are parked, each written down where it had got to, so they are built again on
 *  the page and at the place they were at (pages.svelte.ts); then every write owed is
 *  written - the session first, which holds the open tabs and the words of every draft
 *  not on a disk yet - and waited for, up to the close's own limit. Nothing is handed
 *  back to the account and no update is put in place: the window comes back on this
 *  computer at once.
 *
 *  Fetched by the command, never before: nobody's launch needs it. */

import { GIVE_UP, written } from './parting'
import { settle } from './start'
import { isDesktop } from './tauri'
import { waited } from './timing'
import { pages } from './web-tab/pages.svelte'
import { workspace } from './workspace.svelte'

export async function reloadWindow(): Promise<void> {
  if (!__EVEN_PLUGIN__ && isDesktop) {
    const { mayStop } = await import('./quitting/ask')
    if (!(await mayStop('reload'))) return
    await pages.parkAll()
  }

  settle()
  await Promise.race([Promise.all([workspace.writesSettled(), written()]), waited(GIVE_UP)])
  location.reload()
}
