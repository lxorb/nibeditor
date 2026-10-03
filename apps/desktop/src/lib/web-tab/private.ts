/** A private tab: Chrome's Incognito window, as a tab.
 *
 *  Emil's browser vision (2026-09-13) keeps incognito inside the browser, "as an
 *  ephemeral profile". Ctrl+Shift+N, Chrome's own key for it (docs/backlog.md, Q3), the
 *  plus chooser and the palette open one; a link out of one opens privately too, as a
 *  link out of a private window does.
 *
 *  **What it keeps is nothing.** The page runs in the engine's own private mode - the
 *  InPrivate profile of `WebView2`, a data store of the page's own that nothing writes
 *  to disk on a Mac and on Linux, a profile with no folder on nib's own Chromium - so
 *  its cookies, storage and cache are in memory and go with it. And nib writes nothing
 *  about it either: no history, no favicon, no place on the page, no `.url`, no session
 *  that would bring it back after a restart, no closed tab that Ctrl+Shift+T would
 *  bring back. Memory saver never parks one, because a page built again would have
 *  forgotten everything. The tab and the bar wear Chrome's own mark for it.
 *
 *  **Closing the last one forgets everything**, which is `WebView2`'s own rule for its
 *  InPrivate profile: one session for every private page of the run, ended when the
 *  last of them closes. A Mac's and Linux's engine, and nib's own Chromium, give each
 *  private page a store of its own, so there two private tabs do not share a sign-in;
 *  said in docs/web-tabs.md. */

import { workspace } from '../workspace.svelte'

/** A private tab with nowhere to go yet, its address field taking the keyboard. */
export function openPrivate(): void {
  workspace.openWebsite(true)
}
