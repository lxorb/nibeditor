/** The quick question, opened from a key, a palette row or a web page's double Ctrl,
 *  fetching what it is the first time. Never in the glasses' plugin, whose package is
 *  at its ceiling and whose phone asks the glasses' own way; see even/bundle.test.ts and
 *  ai/quick.svelte.ts. */
export function askQuickly(): void {
  if (__EVEN_PLUGIN__) return
  void import('./quick.svelte').then(({ quick }) => quick.show())
}
