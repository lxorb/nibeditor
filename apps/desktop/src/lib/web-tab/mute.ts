/** Chrome's "Mute site": the site silenced in every tab it is open in, and the next
 *  time it plays anywhere, until it is unmuted. The memory is sites.ts; the engine is
 *  told per page, through `web_mute` (see web_page.rs), and a page that starts playing
 *  on a muted site is caught as it starts (see heard.ts). */

import { invoke } from '../tauri'
import { type Page, pages } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { setMuted } from './sites'

/** Mutes one tab's page, or lets it be heard, and says so on the tab at once rather
 *  than when the engine answers: the speaker on the tab is what the reader watches. */
export function mute(tabId: string, page: Page, muted: boolean): void {
  page.muted = muted
  void invoke('web_mute', { tab: tabId, muted }).catch(() => undefined)
}

/** Mutes the site a tab is on, or lets it be heard, in every tab showing it. The
 *  workspace is fetched with the press rather than carried, so heard.ts, which lands
 *  what the engine reports, does not bring it along. */
export async function muteSite(tabId: string, muted: boolean): Promise<void> {
  const site = siteOf(pages.addressOf(tabId))
  if (!site) return

  setMuted(site, muted)
  const { workspace } = await import('../workspace.svelte')
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web' || siteOf(pages.addressOf(tab.id)) !== site) continue
    mute(tab.id, pages.of(tab.id), muted)
  }
}
