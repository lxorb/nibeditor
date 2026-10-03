/** Which file is the scratchpad - what a window needs to know about it before anybody
 *  has opened it, so all of it that is in front of the first paint. What it does is pad.ts, fetched by the first press; its tab's Move to space
 *  is tab-strip/to-space.ts, which hands the scratchpad here.
 *
 *  Known by its name in no space rather than by asking the crate where it is: a tab
 *  put back by the session is the scratchpad's before anything has asked, and the
 *  only file of that name outside every space nib opens is it (`openable` in the
 *  crate's paths.rs; a dot folder of its own in the browser's store). */

import { nameOf } from '../space-paths'
import { workspace } from '../workspace.svelte'

/** What the file is called, which is also what its tab says. */
export const SCRATCHPAD = 'Scratchpad.md'

/** Whether a path is the scratchpad. */
export function isScratchpad(path: string | null | undefined): boolean {
  return !!path && nameOf(path) === SCRATCHPAD && workspace.outside(path)
}

/** The key, the glyph and the palette row, fetching what it does the first time. */
export function toggleScratchpad(): void {
  // Not in the glasses' plugin, whose package is at its ceiling; see even/bundle.test.ts.
  if (__EVEN_PLUGIN__) return
  void import('./pad').then(({ scratchpad }) => scratchpad.toggle())
}
