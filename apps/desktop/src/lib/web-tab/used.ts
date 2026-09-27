/** Whether the reader has put a previewed website to use, which is what keeps it.
 *
 *  A note clicked past in the file list is kept once somebody types in it; see
 *  `keep` in workspace.svelte.ts. A website has no words of the reader's, so the
 *  question is what counts as typing there, and the answer is leaving the page it
 *  opened on: following a link, submitting a form, a step back or forward, or an
 *  address typed into the bar. Each is the reader going somewhere, and a tab they
 *  have gone somewhere in is one they would be sorry to see the next click take.
 *
 *  Scrolling, hovering, reading and reloading are not: they are what looking is, and
 *  a look is exactly what a preview is for.
 *
 *  Typing into the page itself would count too, but the page is a native webview and
 *  its keys never reach the app - so it is caught where it shows, which is the form
 *  being sent and the page moving.
 *
 *  Pure, so the rule is tested apart from any webview; see used.test.ts. */

/** Whether the page is somewhere other than where its first load landed.
 *
 *  `landed` is where the first load finished, not the address the tab was opened
 *  at: a site sending `example.com` on to `www.example.com/en/` is the site moving,
 *  not the reader. Null until that load has finished, and nothing before it counts.
 *
 *  The fragment is left out of the comparison, because plenty of pages write the
 *  heading being read into it as the reader scrolls. */
export function movedOn(landed: string | null, url: string | null): boolean {
  if (landed === null || url === null) return false
  return withoutFragment(url) !== withoutFragment(landed)
}

function withoutFragment(url: string): string {
  const at = url.indexOf('#')
  return at === -1 ? url : url.slice(0, at)
}
