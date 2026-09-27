/** Whether the space chooser is on screen, as a decision over what the app knows.
 *
 *  Modelled on Obsidian's vault chooser, and on the rule behind it: there is no
 *  flag saying "first run". Obsidian with no vault shows the chooser, and Obsidian
 *  with one opens it; deleting the last vault brings the chooser back. So this is
 *  asked of the state every time rather than remembered, and it closes itself the
 *  moment a space exists, whichever way the space arrived.
 *
 *  Pure, so the table of reasons is tested on its own; the store that reads the
 *  live answers into it is space-chooser.svelte.ts. */

export interface Moment {
  /** The desktop app or the phone app. The browser build seeds a welcome note of
   *  its own instead and never asks. */
  native: boolean
  /** The Even Realities plugin, which never shows anything new. */
  plugin: boolean
  /** Whether the launch has read the spaces folder yet; before that an empty list
   *  says nothing. See `restored` in workspace.svelte.ts. */
  restored: boolean
  spaces: number
  /** Whether the account is still being looked for, which on a phone takes
   *  seconds. Signed out is not the same as not known yet. */
  restoring: boolean
  /** A session brings its own spaces down; asking it to make one would be asking
   *  somebody whose notes are on their way to start again without them. */
  signedIn: boolean
  /** A link somebody followed, being walked through: the space it is about is the
   *  one they came for. */
  invited: boolean
  /** Tabs open, whatever is in them. A file handed over at launch, from Finder or
   *  the command line, is what somebody asked to see, and it opens straight to it. */
  tabs: number
}

export function choosing(now: Moment): boolean {
  if (!now.native || now.plugin) return false
  if (!now.restored || now.restoring) return false
  if (now.signedIn || now.invited) return false

  return now.spaces === 0 && now.tabs === 0
}
