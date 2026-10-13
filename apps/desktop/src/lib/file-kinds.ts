/** What the file list's own New rows make: a named file in the space, as its row
 *  waiting for a name, of each kind that is a file and is offered.
 *
 *  The other gesture beside the new tab's (new-kinds.ts): there the tab comes first and
 *  the file when it is saved, here the row in the list is the thing being made. One
 *  list for the panel's menu and the space's, which had drifted apart from the chooser -
 *  a page note was never in either - and which now leave out what Settings › Note types
 *  turned off, as everything else that makes one does. See kinds-here.ts. */

import { hiddenKinds } from './hidden-kinds.svelte'
import { kindLabel, type KindName } from './kinds-here'
import type { MenuEntry } from './menu-item'
import { workspace } from './workspace.svelte'

/** Each kind the file list makes, and how. A shell is a tab and never a file, so the
 *  three that run are not among them, nor a private tab. */
const MAKERS: Partial<Record<KindName, () => unknown>> = {
  note: () => workspace.createNote(),
  canvas: () => workspace.createCanvas(),
  pages: () => workspace.createPages(),
  chat: () => import('./chats/view/open').then(({ makeChat }) => makeChat()),
  web: () => workspace.createWebsite(),
}

export function newFileRows(): MenuEntry[] {
  return hiddenKinds.shown.flatMap((kind) => {
    const make = MAKERS[kind]
    return make ? [{ label: kindLabel(kind), run: () => void make() }] : []
  })
}
