/** Where the reader is, and their tabs: `get_context`, `workspace_tabs`, and the
 *  crate's `agent.reader_tabs` (docs/agent-native.md 5.1, 5.4, 13.1).
 *
 *  An agent may look at everything here with `context` or `workspace`, and may change
 *  what is on the reader's screen only with `workspace.focus`: opening a note behind
 *  the tab in front changes nothing they are looking at, and is what `open` does unless
 *  asked otherwise, the way a browser opens a link with Ctrl held. Bringing a tab to the
 *  front, closing the one they are reading, splitting a pane, and anything in another
 *  space - whose tabs are not in this window until the reader goes there - are the
 *  screen changing, and ask for that scope (7.2). A pinned tab is the reader's to
 *  close. */

import { documentOf } from '@nib/editor'
import type { AgentAnswer } from '../../automation/caller'
import { relativeTo } from '../../space-paths'
import { views } from '../../views.svelte'
import { pages } from '../../web-tab/pages.svelte'
import { type Tab, workspace } from '../../workspace.svelte'
import type { ReaderTab } from '../verbs'
import { TYPING } from '../docs/edit'
import { type Call, done, flag, maybe, need, needScope } from './call'
import { Refused } from './problem'
import { judged, onDisk, placeFor, sharedSource } from './spaces'
import { entryIn } from './tree'

/** The longest selection handed over whole; the rest is said to be there. */
const LONGEST_SELECTION = 20_000

/** Whether a tab is the one in front of its pane. */
function front(tab: Tab): boolean {
  return workspace.showing(tab.paneId)?.id === tab.id
}

/** A web tab's address as it stands: the page's, or the file's before it has one. */
function addressOf(tab: Tab): string | null {
  if (tab.kind !== 'web') return null
  return pages.addressOf(tab.id) ?? workspace.webAddressOf(tab)
}

/** One tab as an agent reads it. */
function tabOf(tab: Tab) {
  const root = workspace.activeSpace?.root
  const url = addressOf(tab)
  return {
    id: tab.id,
    kind: tab.kind,
    ...(tab.path !== null && root ? { path: relativeTo(root, tab.path) } : {}),
    ...(url ? { url } : {}),
    title: tab.shown,
    front: front(tab),
    focused: tab.id === workspace.activeTabId,
    ...(tab.pinned ? { pinned: true } : {}),
  }
}

/** What the reader has selected and can see in a note tab that is in front, lines
 *  counted from zero. Null for anything else. */
function whereIn(tab: Tab) {
  const view = views.of(tab.paneId)
  if (!view || documentOf(view) !== tab.note.live) return null

  const { state } = view
  const { from, to, head } = state.selection.main
  const caret = state.doc.lineAt(head)
  const shown = view.visibleRanges
  const selected = state.sliceDoc(from, Math.min(to, from + LONGEST_SELECTION))

  return {
    from,
    to,
    selected,
    ...(to - from > LONGEST_SELECTION ? { truncated: true } : {}),
    caret: { line: caret.number - 1, column: head - caret.from },
    visible: {
      from: state.doc.lineAt(shown[0]?.from ?? 0).number - 1,
      to: state.doc.lineAt(shown.at(-1)?.to ?? state.doc.length).number - 1,
    },
  }
}

export function getContext(call: Call): AgentAnswer {
  const place = placeFor(call, null)
  const tab = workspace.active
  const last = tab?.note.live.readerAt ?? null
  const web = workspace.tabs.some((one) => one.kind === 'web')

  const context = {
    space: place.space.name,
    front: tab ? tabOf(tab) : null,
    selection: tab?.kind === 'note' ? whereIn(tab) : null,
    tabs: workspace.tabs.map(tabOf),
    typing: last !== null && Date.now() - last < TYPING,
  }

  // A page's title, and the words of a space somebody else writes in, are not the
  // reader's words.
  return done(context, sharedSource(place) ?? (web ? 'tab titles' : null))
}

/** The tab a call names by id. */
function tabNamed(call: Call): Tab {
  const id = need(call, 'tab')
  const found = workspace.tabs.find((one) => one.id === id)
  if (!found) throw new Refused('no_such_tab', `there is no tab ${id}: workspace_tabs lists them`)

  return found
}

export async function workspaceTabs(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  // The reader's tabs belong to the space they are in; an agent that may not reach it
  // has no business with them.
  placeFor(call, null)

  switch (op) {
    case 'list':
      return done(
        workspace.tabs.map(tabOf),
        workspace.tabs.some((one) => one.kind === 'web') ? 'tab titles' : null,
      )

    case 'open': {
      const place = placeFor(call, maybe(call, 'space'))
      const relative = judged(need(call, 'path'))
      const path = onDisk(place, relative)
      const behind = !('background' in call.args) || flag(call, 'background')
      if (!behind || !place.open) {
        needScope(call, 'workspace.focus', place.open ? 'opening in front' : 'another space')
      }
      if (!(await entryIn(place, relative))) {
        throw new Refused('no_such_file', `there is nothing at ${relative}`)
      }

      if (!place.open) await workspace.showSpace(place.space.id)
      await workspace.openEntry(path, behind ? { activate: false, beside: true } : {})

      const opened = workspace.tabs.find((one) => one.path === path)
      return done(opened ? tabOf(opened) : null, sharedSource(place))
    }

    case 'close': {
      const tab = tabNamed(call)
      if (tab.pinned) throw new Refused('by_hand', "a pinned tab is the reader's to close")
      if (front(tab)) needScope(call, 'workspace.focus', 'closing a tab the reader can see')

      workspace.close(tab.id)
      return done({ closed: tab.id })
    }

    case 'split': {
      needScope(call, 'workspace.focus', 'a split')
      const tab = tabNamed(call)
      workspace.split('row', tab.id)
      return done(workspace.tabs.map(tabOf))
    }

    case 'focus': {
      needScope(call, 'workspace.focus', 'bringing a tab to the front')
      const tab = tabNamed(call)
      workspace.activate(tab.id)
      return done(tabOf(tab))
    }

    default:
      throw new Refused('bad_arguments', 'op is one of list, open, close, split, focus')
  }
}

/** The reader's web tabs, for the crate, which acts in them with `browser.reader`: the
 *  tab's id, its page, which space it is in and whether it is in front. */
export function readerTabs(): ReaderTab[] {
  const space = workspace.activeSpace?.name
  return workspace.tabs
    .filter((tab) => tab.kind === 'web')
    .map((tab) => ({
      id: tab.id,
      title: tab.shown,
      url: addressOf(tab) ?? '',
      ...(space ? { space } : {}),
      front: front(tab) && tab.paneId === workspace.panes.focusedId,
      on_screen: front(tab),
    }))
}
