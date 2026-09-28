/** A tab's own menu: what a right click, a held finger or the menu key on a tab
 *  offers.
 *
 *  Chrome's rows, VS Code's and Obsidian's, where nib has the thing behind them, in
 *  groups that read top to bottom as the tab, the strip around it, and the panes:
 *
 *  | group | rows |
 *  | --- | --- |
 *  | the page | Reload and Copy link, on a web tab only |
 *  | the tab | Rename, Duplicate, Pin, Show in the file list |
 *  | closing | Close, Close others, Close tabs to the right, Close all, Reopen |
 *  | the panes | Share, Stack, Split right and down, Move to other pane |
 *
 *  A row that could only do nothing is left out rather than greyed where the thing
 *  it is about is not there at all - a graph has no file to rename - and greyed where
 *  it is there and there is nothing to do yet, the way Chrome greys "Close tabs to
 *  the right" on the last tab. Each command that has a key says it; see the registry. */

import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { DIVIDER, shareEntry, stackEntries, type MenuEntry } from '../menu.svelte'
import { shortcuts } from '../shortcuts.svelte'
import { withinSpace } from '../space-paths'
import { pages } from '../web-tab/pages.svelte'
import { workspace, type Tab } from '../workspace.svelte'
import { closeAfterLabel } from '../workspace/closing-around'
import { duplicateTab, moveToOtherPane, renameFromTab } from './ops'

/** What a double click on the tab does, for a finger that cannot double click.
 *  Only offered while the tab is still a preview: once kept, there is nothing left
 *  to keep. */
function keepEntry(tab: Tab): MenuEntry[] {
  if (tab.id !== workspace.previewTabId) return []
  return [{ label: t('Keep open'), run: () => workspace.keep(tab.id) }]
}

/** Beside, and below, and the tab itself carried to the other pane. Left out where
 *  the pane has split as far as it may, rather than offered as a row that does
 *  nothing. */
function paneEntries(tab: Tab): MenuEntry[] {
  const entries: MenuEntry[] = []

  if (workspace.canSplit('row', tab.id)) {
    entries.push({
      label: t('Split right'),
      hint: shortcuts.hint('pane.split-right'),
      run: () => workspace.split('row', tab.id),
    })
  }
  if (workspace.canSplit('column', tab.id)) {
    entries.push({
      label: t('Split down'),
      hint: shortcuts.hint('pane.split-down'),
      run: () => workspace.split('column', tab.id),
    })
  }
  if (workspace.canMoveToOtherPane(tab.id)) {
    entries.push({
      label: t('Move to other pane'),
      hint: shortcuts.hint('pane.move-tab'),
      run: () => moveToOtherPane(tab.id),
    })
  }

  return entries.length ? [...entries, DIVIDER] : []
}

/** The note's other face. Not offered for the graph, which has only one. */
function readingEntry(tab: Tab): MenuEntry[] {
  if (tab.kind !== 'note') return []

  return [
    {
      label: tab.reading ? t('Leave reading') : t('Reading'),
      hint: shortcuts.hint('app.reading'),
      run: () => workspace.toggleReading(tab.id),
    },
    DIVIDER,
  ]
}

/** What Chrome's tab menu has about the page itself. Mute joins them once a tab
 *  can hear its page play. */
function pageEntries(tab: Tab): MenuEntry[] {
  if (tab.kind !== 'web') return []

  const url = pages.addressOf(tab.id) ?? tab.address ?? null
  return [
    {
      label: t('Reload'),
      disabled: url === null,
      run: () => void pages.step(tab.id, 'reload'),
    },
    {
      label: t('Copy link'),
      disabled: url === null,
      run: () => {
        if (url !== null) void copyText(url)
      },
    },
    DIVIDER,
  ]
}

/** Renaming on the file's own row, and a second tab on the same thing. Each only
 *  where it can happen: a file with no row has no name to change, and the graph is
 *  one to a pane. */
function tabEntries(tab: Tab): MenuEntry[] {
  return [
    ...(workspace.canRenameFromTab(tab)
      ? [
          {
            label: t('Rename'),
            hint: shortcuts.hint('tabs.rename'),
            run: () => renameFromTab(tab.id),
          },
        ]
      : []),
    ...(workspace.canDuplicateTab(tab)
      ? [
          {
            label: t('Duplicate'),
            hint: shortcuts.hint('app.duplicate-tab'),
            run: () => duplicateTab(tab.id),
          },
        ]
      : []),
    {
      label: tab.pinned ? t('Unpin') : t('Pin'),
      hint: shortcuts.hint('app.pin'),
      run: () => workspace.togglePin(tab.id),
    },
  ]
}

/** The file in the list, the rows above it unfolded and its own scrolled to. Only
 *  for a file that has a row there: the graph, a note from outside the space and one
 *  nobody has saved have none. */
function revealEntry(tab: Tab): MenuEntry[] {
  const root = workspace.activeSpace?.root
  const path = tab.path
  if (path === null || root === undefined || withinSpace(root, path) === null) return []

  return [
    {
      label: t('Show in the file list'),
      hint: shortcuts.hint('app.reveal'),
      run: () => workspace.revealNote(path),
    },
  ]
}

/** Left out while nothing has been closed, rather than offered as a row that does
 *  nothing. */
function reopenEntry(): MenuEntry[] {
  if (!workspace.closed.any) return []

  return [
    {
      label: t('Reopen closed tab'),
      hint: shortcuts.hint('app.reopen'),
      run: () => void workspace.reopenClosed(),
    },
  ]
}

/** The tab, and the strip around it. Greyed where there is nothing around it to
 *  close; a pinned tab is never one of the tabs these take. */
function closeEntries(tab: Tab): MenuEntry[] {
  return [
    {
      // A pinned tab has no cross, so this row and the key beside it are the
      // two ways it closes - which is why the row says the key as well.
      label: t('Close'),
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeAsking(tab.id),
    },
    {
      label: t('Close others'),
      disabled: workspace.closesAround(tab.id, 'others') === 0,
      run: () => void workspace.closeAround(tab.id, 'others'),
    },
    {
      label: closeAfterLabel(),
      hint: shortcuts.hint('app.close-right'),
      disabled: workspace.closesAround(tab.id, 'right') === 0,
      run: () => void workspace.closeAround(tab.id, 'right'),
    },
    {
      label: t('Close all'),
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(tab.id, 'all') === 0,
      run: () => void workspace.closeAround(tab.id, 'all'),
    },
    ...reopenEntry(),
  ]
}

/** Only for a tab with no file: every other kind of tab is written as the typing
 *  pauses and has nothing to save. The row is here because a tab is where somebody
 *  looking at an unsaved one is pointing; the key and the menu bar say the same thing.
 *  See `save` in workspace/saving.svelte.ts. */
function saveEntry(tab: Tab): MenuEntry[] {
  if (tab.path !== null) return []

  return [
    {
      label: t('Save'),
      hint: shortcuts.hint('app.save'),
      run: () => void workspace.save(tab),
    },
  ]
}

export function tabMenu(tab: Tab, paneId: string): MenuEntry[] {
  return [
    ...saveEntry(tab),
    ...readingEntry(tab),
    ...pageEntries(tab),
    ...tabEntries(tab),
    ...revealEntry(tab),
    DIVIDER,
    ...closeEntries(tab),
    DIVIDER,
    // Who else may have the file this tab is showing, in the same word and the
    // same sheet the tree's row and the space's own menu use.
    ...shareEntry(tab.path),
    ...stackEntries(paneId),
    ...paneEntries(tab),
    ...keepEntry(tab),
  ]
}
