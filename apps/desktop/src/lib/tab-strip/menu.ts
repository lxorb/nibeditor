/** A tab's own menu: what a right click, a held finger or the menu key on a tab
 *  offers.
 *
 *  Chrome's rows, VS Code's and Obsidian's, where nib has the thing behind them, in
 *  groups that read top to bottom as the tab, the strip around it, and the panes:
 *
 *  | group | rows |
 *  | --- | --- |
 *  | the page | Reload, Copy link and Mute site, on a web tab only |
 *  | the shell | Open another, and any other shell a chevron away, on a terminal only |
 *  | the tab | Rename, Duplicate, Pin, Bookmark, Show in the file list |
 *  | closing | Close, Close others, Close tabs to the right, Close all, Reopen |
 *  | the panes | Share, Stack, Split right and down, Move to other pane |
 *
 *  A row that could only do nothing is left out rather than greyed where the thing
 *  it is about is not there at all - a graph has no file to rename - and greyed where
 *  it is there and there is nothing to do yet, the way Chrome greys "Close tabs to
 *  the right" on the last tab. Each command that has a key says it; see the registry.
 *
 *  A tab that is one of several picked out with Ctrl or Shift offers what can be done to
 *  all of them at once, Chrome's rows for a pick: see `pickMenu` and chosen.svelte.ts. */

import { agentMarks } from '../agent-marks.svelte'
import { copyText } from '../clipboard'
import { plural, t } from '../i18n.svelte'
import { archiveEntry, DIVIDER, shareEntry, stackEntries, type MenuEntry } from '../menu.svelte'
import { bookmarkAll } from '../row-menu'
import { shortcuts } from '../shortcuts.svelte'
import { withinSpace } from '../space-paths'
import { openTerminal, shellRows } from '../terminal/open'
import { readSpec } from '../terminal/spec'
import { pages } from '../web-tab/pages.svelte'
import { workspace, type Tab } from '../workspace.svelte'
import { closeAfterLabel } from '../workspace/closing-around'
import { chosen } from './chosen.svelte'
import { duplicateTab, moveToOtherPane, renameFromTab } from './ops'
import { duplicateMany, moveManyToOtherPane, pinMany } from './picking'

/** An agent acting in the tab, or paused in it (docs/agent-native.md 7.3): Take over
 *  pauses it there, as a press in the page would; Stop ends its work in the tab and
 *  tells it so; Give back is the tab handed back after either. First, because while an
 *  agent is in a tab it is the thing about the tab most worth reaching. */
function agentEntries(tab: Tab): MenuEntry[] {
  const worn = agentMarks.on[tab.id]
  const act = agentMarks.act
  if (!worn || !act) return []

  return [
    ...(worn.paused
      ? [{ label: t('Give back'), run: () => act(tab.id, 'give-back') }]
      : [{ label: t('Take over'), run: () => act(tab.id, 'take-over') }]),
    { label: t('Stop'), run: () => act(tab.id, 'stop') },
    DIVIDER,
  ]
}

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

/** What Chrome's tab menu has about the page itself. Mute is the site's, as in
 *  Chrome: every tab on it, and the next time it plays; see web-tab/mute.ts. */
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
    {
      label: pages.of(tab.id).muted ? t('Unmute site') : t('Mute site'),
      hint: shortcuts.hint('web.mute'),
      disabled: url === null,
      run: () => void muting(tab.id),
    },
    DIVIDER,
  ]
}

/** The site's mute turned over, fetched with the press: nothing of it is on screen
 *  before a tab's menu is. */
async function muting(tabId: string): Promise<void> {
  const { muteSite } = await import('../web-tab/mute')
  await muteSite(tabId, !pages.of(tabId).muted)
}

/** What a terminal's tab offers about its shell: another beside it, in the folder it is
 *  in - the same shell by the row, any other by the chevron at its end, as VS Code's
 *  `+ ˅` has it. Duplicate is this row's, for a terminal; see `tabEntries`. */
function shellEntries(tab: Tab): MenuEntry[] {
  if (__EVEN_PLUGIN__ || tab.kind !== 'terminal') return []

  const spec = readSpec(tab.doc)
  const beside = { folder: spec?.folder ?? null, beside: tab.id }
  return [
    {
      label: t('Open another'),
      run: () => void openTerminal(spec?.shell, beside),
      more: () => shellRows((shell) => void openTerminal(shell.id, beside)),
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
    ...(workspace.canDuplicateTab(tab) && tab.kind !== 'terminal'
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
    ...bookmarkAll(tab.path === null ? [] : [tab.path]),
  ]
}

/** The file in the list, the rows above it unfolded and its own scrolled to. Only
 *  for a file that has a row there: the graph, a note from outside the space and one
 *  nobody has saved have none. */
function inListEntry(tab: Tab): MenuEntry[] {
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

/** Only for a web tab with no file: browsing writes nothing, and this is where
 *  somebody pointing at the tab says to keep the page, as a web note in the space.
 *  Every other kind of tab writes itself and has nothing to keep. See
 *  `keepAsWebNote` in workspace.svelte.ts. */
function keepWebEntry(tab: Tab): MenuEntry[] {
  if (tab.kind !== 'web' || tab.path !== null) return []

  return [{ label: t('Keep as web note'), run: () => void workspace.keepAsWebNote(tab) }]
}

/** What a pick of tabs offers, all of it about every tab picked: Chrome's rows for a
 *  selection - reload, duplicate, pin, close, close the others, move - and the bookmark
 *  a row of the file list has. The others the strip closes are the tabs not picked, and
 *  the ones to the right are right of the last of them. */
function pickMenu(tabs: readonly Tab[], paneId: string): MenuEntry[] {
  const ids = tabs.map((one) => one.id)
  const web = tabs.filter((one) => one.kind === 'web')
  const last = tabs.at(-1)?.id ?? ''
  const others = workspace.tabsIn(paneId).filter((one) => !ids.includes(one.id) && !one.pinned)
  const copies = tabs.every((one) => workspace.canDuplicateTab(one) && one.kind !== 'terminal')
  const paths = tabs.flatMap((one) => (one.path === null ? [] : [one.path]))

  return [
    ...(web.length
      ? [
          {
            label: t('Reload'),
            run: () => {
              for (const one of web) void pages.step(one.id, 'reload')
            },
          },
          DIVIDER,
        ]
      : []),
    ...(copies
      ? [
          {
            label: t('Duplicate'),
            hint: shortcuts.hint('app.duplicate-tab'),
            run: () => duplicateMany(ids),
          },
        ]
      : []),
    {
      label: tabs.some((one) => !one.pinned) ? t('Pin') : t('Unpin'),
      hint: shortcuts.hint('app.pin'),
      run: () => pinMany(tabs),
    },
    ...bookmarkAll(paths),
    DIVIDER,
    {
      label: t('Close'),
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeMany(ids),
    },
    {
      label: t('Close others'),
      disabled: others.length === 0,
      run: () => void workspace.closeMany(others.map((one) => one.id)),
    },
    {
      label: closeAfterLabel(),
      hint: shortcuts.hint('app.close-right'),
      disabled: workspace.closesAround(last, 'right') === 0,
      run: () => void workspace.closeAround(last, 'right'),
    },
    {
      label: t('Close all'),
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(last, 'all') === 0,
      run: () => void workspace.closeAround(last, 'all'),
    },
    ...reopenEntry(),
    ...(workspace.canMoveToOtherPane(last)
      ? [
          DIVIDER,
          {
            label: t('Move to other pane'),
            hint: shortcuts.hint('pane.move-tab'),
            run: () => moveManyToOtherPane(ids),
          },
        ]
      : []),
  ]
}

/** The tabs a menu on this tab is about: the pick it is one of, or it alone. */
function pickOf(tab: Tab, paneId: string): Tab[] {
  const many = chosen.of(paneId)
  return many.some((one) => one.id === tab.id) ? many : []
}

/** What the menu says it is about: the tab's name, or how many tabs are picked. */
export function tabMenuTitle(tab: Tab, paneId: string): string {
  const many = pickOf(tab, paneId).length
  return many ? plural(many, { one: '{count} tab', other: '{count} tabs' }) : tab.shown
}

export function tabMenu(tab: Tab, paneId: string): MenuEntry[] {
  const many = pickOf(tab, paneId)
  if (many.length) return pickMenu(many, paneId)

  return [
    ...agentEntries(tab),
    ...keepWebEntry(tab),
    ...readingEntry(tab),
    ...pageEntries(tab),
    ...shellEntries(tab),
    ...tabEntries(tab),
    ...inListEntry(tab),
    // Putting away what the tab shows, which closes it; see archiving.ts.
    ...archiveEntry(tab.path),
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
