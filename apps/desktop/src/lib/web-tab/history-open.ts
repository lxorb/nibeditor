/** Ctrl+H: the History page, the way Chrome opens it.
 *
 *  Chrome keeps one History tab: pressing Ctrl+H again goes to the one already open, and a
 *  new tab nobody has sent anywhere yet becomes the History page rather than gaining a
 *  neighbour (`ShowSingletonTabOverwritingNTP`). Otherwise it is a new tab in front,
 *  beside the one it was asked from, in that tab's space and so with that space's
 *  history; see `openPage` in workspace.svelte.ts and web-data.ts. Fetched with the first
 *  press. */

import type { Tab } from '../workspace.svelte'
import { workspace } from '../workspace.svelte'
import { HISTORY, isOwnPage } from './own-pages'
import { pages } from './pages.svelte'

export function openHistory(from: Tab | null = workspace.active): void {
  const open = workspace.tabs.find(
    (one) => one.kind === 'web' && isOwnPage(pages.addressOf(one.id) ?? one.address),
  )
  if (open) {
    workspace.activate(open.id)
    return
  }

  // A web tab with nowhere to go yet, which is Chrome's new tab page.
  const blank =
    from?.kind === 'web' && from.path === null && !from.address && !pages.addressOf(from.id)
  if (from && blank) {
    pages.of(from.id).url = HISTORY
    workspace.webWalked(from, HISTORY)
    return
  }

  workspace.openPage(HISTORY, 'front', from?.id)
}
