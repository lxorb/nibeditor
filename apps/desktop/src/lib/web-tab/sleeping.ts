/** A page out of sight, carried out: the rules in resting.ts asked of the pages store, the
 *  freeze sent, and the countdown to when they are asked again. Fetched with the first
 *  page that goes out of sight, so the first paint carries none of it; pages.svelte.ts
 *  hands its calls through. */

import { agentMarks } from '../agent-marks.svelte'
import { invoke } from '../tauri'
import type { Page } from './pages.svelte'
import { grants, siteOf } from './permissions.svelte'
import { FROZEN_AFTER, overCap, rest as judged, type Resting } from './resting'
import { saver } from './saver.svelte'

/** As much of the pages store as this needs. */
export interface Held {
  each(): [string, Page][]
  park(tabId: string): Promise<void>
}

/** Every page as the rules read it. */
function resting(pages: Held): Resting[] {
  return pages.each().map(([id, page]) => {
    const site = siteOf(page.url)
    const allowed = (ask: 'camera' | 'microphone' | 'notifications') =>
      grants.said(site, ask) === 'allow'
    return {
      id,
      live: page.live,
      onScreen: page.onScreen,
      frozen: page.frozen,
      looked: page.looked,
      loading: page.loading,
      playing: page.playing,
      heard: page.heard,
      acting: id in agentMarks.on,
      calling: allowed('camera') || allowed('microphone'),
      notifying: allowed('notifications'),
      edited: page.edited,
      pinned: page.pinned,
    }
  })
}

/** What becomes of a page out of sight now, and the countdown to when it is asked again;
 *  `refused` is a page the engine would not freeze just now, asked again a freeze's wait
 *  later. */
export function rest(pages: Held, tabId: string, refused = false): void {
  const page = pages.each().find(([id]) => id === tabId)?.[1]
  const one = resting(pages).find((each) => each.id === tabId)
  if (!page || !one?.live || page.onScreen) return

  clearTimeout(page.resting)
  page.resting = undefined
  const { act, again } = refused
    ? { act: null, again: FROZEN_AFTER }
    : judged(one, saver.mode, Date.now())
  if (act === 'park') {
    void pages.park(tabId)
    return
  }
  if (act === 'freeze') void lull(pages, tabId, page, true)
  if (again !== null) page.resting = setTimeout(() => rest(pages, tabId), again)
}

/** A freeze or a thaw, each after the last has landed: a thaw sent behind a freeze still
 *  on its way would land first, and the freeze would then hide a page on screen. Never a
 *  freeze halfway through a photograph; see `aside` in pages.svelte.ts.
 *
 *  A freeze the engine refused - WebView2 leaves a page running that plays, is in a call
 *  or holds a lock, and says so only in its answer - leaves the page counted as running. */
export function lull(pages: Held, tabId: string, page: Page, paused: boolean): Promise<void> {
  page.frozen = paused
  page.lulling = page.lulling.then(async () => {
    if (paused) await page.shooting
    const done = await invoke<boolean | undefined>('web_pause', { tab: tabId, paused }).catch(
      () => false,
    )
    if (!paused || done !== false || !page.frozen) return
    page.frozen = false
    rest(pages, tabId, true)
  })
  return page.lulling
}

/** Memory saver's cap, kept as one more page is built. A page in a pane on screen is
 *  never parked, nor one under a menu. */
export function bound(pages: Held): void {
  for (const id of overCap(resting(pages), saver.mode, Date.now())) void pages.park(id)
}
