/** Whether the space chooser is up: what a fresh install opens on.
 *
 *  Obsidian's vault chooser, as closely as a single window allows. Obsidian with no
 *  vault opens a small window of its own that asks for one - create, open a folder,
 *  or sign in to sync - and it cannot be dismissed while there is none to open. nib
 *  asks the same three things in a card over its own window, and the moment a space
 *  exists the card is gone, because the question has been answered. Whether it is
 *  up is decided in space-choice.ts; this reads the live answers into that.
 *
 *  Fetched with the card, which the window asks for only while there is no space;
 *  see App.svelte. What the rows do is first-space.svelte.ts. */

import { account } from './account.svelte'
import { joining } from './joining.svelte'
import { isPlugin } from './plugin'
import { choosing } from './space-choice'
import { isNative } from './tauri'
import { workspace } from './workspace.svelte'

class SpaceChooser {
  /** Whether it is on screen. Derived and never written, so it cannot disagree with
   *  the spaces folder: see `choosing`. */
  readonly showing = $derived(
    choosing({
      native: isNative,
      plugin: isPlugin(),
      restored: workspace.restored,
      spaces: workspace.spaces.length,
      restoring: account.restoring,
      signedIn: account.signedIn,
      invited: joining.invitation !== null || joining.step !== null,
      tabs: workspace.tabs.length,
    }),
  )
}

export const spaceChooser = new SpaceChooser()
