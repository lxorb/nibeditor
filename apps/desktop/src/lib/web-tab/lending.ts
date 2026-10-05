/** A reader's tab lent to an agent (src-tauri/src/agents/reader.rs, docs/agent-native.md
 *  7.3): its page running for the agent's calls wherever the tab is.
 *
 *  An agent may act in any web tab of any space, and the reader using the tab takes
 *  nothing from it. But a tab behind another one, in a space out of sight, or parked to
 *  give memory back has a page that is hidden, frozen or not there at all, and a hidden
 *  page answers an agent's press after five seconds or never. So the crate asks the
 *  window before each call, and the page is built where there is none, thawed where it
 *  is frozen, and put outside the window - shown to the engine, never on a screen, the
 *  way a page being photographed as its tab is left already is (`aside`) - until the
 *  agent's mark on the tab lapses. A tab on screen is the reader's to place, and is left
 *  as it is.
 *
 *  Fetched with the first agent call on a reader's tab: nothing of it is in the first
 *  paint. */

import { OUT_OF_THE_WAY, pages, type Rect } from './pages.svelte'

/** The page of a tab never on screen since the launch, laid out at the size an agent's
 *  own tab is (src-tauri/src/agents/tabs.rs). */
const UNSEEN: Rect = { x: 0, y: 0, width: 1280, height: 800 }

/** Lends a tab's page; answers once it is there to be driven. */
export async function lend(tabId: string): Promise<void> {
  const page = pages.of(tabId)
  page.lent = true
  while (page.opening) await new Promise((go) => setTimeout(go, 50))
  if (page.onScreen || page.url === null) return

  const pane = page.pane ?? UNSEEN
  if (page.live) {
    await pages.thaw(tabId)
    await pages.aside(tabId, page, pane)
    return
  }
  await pages.build(tabId, page, { ...pane, x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY }, true)
  // Built where nobody sees it: where it goes when the reader looks is where it was.
  page.pane = pane
  page.shown = false
}

/** The agent is done in the tab: a page out of sight is hidden again, and counts down to
 *  being frozen from now. */
export function unlend(tabId: string): void {
  // Never made for the asking: a note an agent wrote in wears a mark too.
  const page = pages.each().find(([id]) => id === tabId)?.[1]
  if (!page?.lent) return
  page.lent = false
  if (!page.onScreen && page.pane) pages.hide(tabId, page.pane)
}
