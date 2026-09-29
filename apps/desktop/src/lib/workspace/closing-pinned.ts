/** The question before a pinned tab goes by key.
 *
 *  Emil, 2026-09-30, in German: a pinned tab closed with Ctrl+W asks first whether it
 *  should really go, and one closed from its right-click menu does not. A key closes
 *  whichever tab is in front, and a hand closing a row of tabs with it reaches the
 *  pinned one without looking; the row in the tab's own menu and the middle button
 *  are aimed at the tab itself. So the question belongs to the Close note command -
 *  the key and any key it is rebound to, the same key pressed inside a web page and
 *  handed out by web_keys.rs, the File menu's row that is that key on a Mac, the
 *  palette and `:q` - and to nothing that points at a tab. The rows that close
 *  around a tab never take a pinned one, and closing the window loses none: the
 *  next window opens on the same pinned tabs. Neither asks.
 *
 *  Enter closes and Escape keeps it. The keyboard lands on Close rather than on
 *  Cancel, where a question about deleting something puts it, because this yes is
 *  undone as easily as it is given: Reopen closed tab brings the tab back pinned.
 *
 *  One question at a time. Ctrl+W held repeats, and while the question is up a repeat
 *  or a second press does nothing: it neither stacks a second sheet nor answers this
 *  one, since a hand still on the key has not read it yet, and the tab behind stays
 *  where it is because the pinned one has not gone.
 *
 *  Here rather than in the store because none of it is needed until a pinned tab is
 *  closed by key. */

import { key, t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'

let asking = false

/** Whether the pinned tab in front may go. False without a word while it is already
 *  being asked about. */
export async function closesPinned(): Promise<boolean> {
  if (asking) return false

  asking = true
  try {
    return await prompt.confirm({
      title: t('Close pinned tab?'),
      confirmLabel: key('Close'),
      danger: true,
      lands: true,
    })
  } finally {
    asking = false
  }
}
