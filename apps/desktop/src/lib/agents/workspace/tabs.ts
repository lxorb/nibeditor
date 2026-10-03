/** Where the reader is, and their tabs: `get_context`, `workspace_tabs`, and the
 *  crate's `agent.reader_tabs` (docs/agent-native.md 5.1, 5.4, 13.1).
 *
 *  An agent may look at everything here with `context` or `workspace`, and may change
 *  what is on the reader's screen only with `workspace.focus`. Making a tab, opening a
 *  note or a page, renaming one, saving one: all of it lands behind the tab in front
 *  unless asked otherwise, the way a browser opens a link with Ctrl held, so the strip
 *  grows and nothing the reader is looking at moves. Bringing a tab to the front,
 *  closing the one they are reading, splitting a pane, the graph (which only opens in
 *  front), and anything in another space - whose tabs are not in this window until the
 *  reader goes there - are the screen changing, and ask for that scope (7.2). A pinned
 *  tab is the reader's to close.
 *
 *  Every kind of tab is listed with its id, which the verbs of its kind take: a note's
 *  (`read_note`, `edit_note`), a canvas's and a page note's (`read_canvas`,
 *  `edit_canvas`), a terminal's (`read_terminal`, `type_terminal`) and a web tab's (every
 *  `browser_` tool). */

import { documentOf } from '@nib/editor'
import type { AgentAnswer } from '../../automation/caller'
import { folderOf, nameOf, relativeTo } from '../../space-paths'
import { isScratchpad } from '../../scratchpad/is'
import { type Section, settings } from '../../settings.svelte'
import { ptyOf } from '../../terminal/running'
import { views } from '../../views.svelte'
import { isWebAddress } from '../../web-tab/address'
import { hostOf } from '../../web-tab/web-data'
import { pages } from '../../web-tab/pages.svelte'
import { type Tab, workspace } from '../../workspace.svelte'
import { fileNamed, isDraft, isUnsaved } from '../../workspace/drafts'
import type { ReaderTab } from '../verbs'
import { TYPING } from '../docs/edit'
import { notes } from '../docs'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, needScope, text, writerOf } from './call'
import { Refused } from './problem'
import { judged, judgedForWriting, onDisk, type Place, placeFor, sharedSource } from './spaces'
import { tabWithId } from './tab-target'
import { entryIn, moveFile } from './tree'

/** The longest selection handed over whole; the rest is said to be there. */
const LONGEST_SELECTION = 20_000

/** What a new tab can be, as `workspace_tabs` `new` names them. */
const NEW_KINDS = ['note', 'canvas', 'pages', 'web', 'terminal'] as const
type NewKind = (typeof NEW_KINDS)[number]

/** Whether a tab is the one in front of its pane. */
function front(tab: Tab): boolean {
  return workspace.showing(tab.paneId)?.id === tab.id
}

/** A web tab's address as it stands: the page's, or the file's before it has one. */
function addressOf(tab: Tab): string | null {
  if (tab.kind !== 'web') return null
  return pages.addressOf(tab.id) ?? workspace.webAddressOf(tab)
}

/** One tab as an agent reads it: what it is, what it is called, where its file or page
 *  is, which pane it is in, and the few states that change what may be done with it. */
function tabOf(tab: Tab) {
  const root = workspace.activeSpace?.root
  const url = addressOf(tab)
  const outside = tab.path !== null && workspace.outside(tab.path)
  return {
    id: tab.id,
    kind: tab.kind,
    title: tab.shown,
    ...(tab.path !== null && root && !outside ? { path: relativeTo(root, tab.path) } : {}),
    ...(isScratchpad(tab.path) ? { scratchpad: true } : {}),
    ...(url ? { url } : {}),
    pane: tab.paneId,
    front: front(tab),
    selected: tab.id === workspace.activeTabId,
    // A note, canvas or page note with no file yet: read and edited by this tab's id.
    ...(isDraft(tab.note) ? { unsaved: true } : {}),
    ...(workspace.previewTabId === tab.id ? { preview: true } : {}),
    ...(tab.pinned ? { pinned: true } : {}),
    ...(tab.note.shared !== null ? { shared: true } : {}),
    ...(tab.kind === 'terminal' ? { running: ptyOf(tab.id) !== undefined } : {}),
  }
}

/** What the reader has selected and can see in a note tab that is in front, lines
 *  counted from zero. Null where the note is not on screen. */
function inNote(tab: Tab) {
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

/** What is selected inside the tab the reader has selected, in that kind's own terms:
 *  words and the caret in a note, the objects picked on a canvas or a page note, the
 *  words selected in a terminal, the page a PDF is on. Null for a kind with nothing to
 *  select that nib can see - a web page's selection is the page's, which `browser_`
 *  tools read. */
async function selectionIn(tab: Tab): Promise<unknown> {
  switch (tab.kind) {
    case 'note':
      return inNote(tab)

    case 'canvas':
    case 'pages': {
      const { CanvasStore } = await import('../../canvas/store.svelte')
      const drawn = CanvasStore.drawing(tab.note, workspace.tabs)
      return drawn ? { picked: drawn.picked } : null
    }

    case 'terminal': {
      const { terminalSelection } = await import('./terminal-tab')
      return terminalSelection(tab)
    }

    case 'pdf':
      return tab.page === undefined ? null : { page: tab.page }

    case 'web':
    case 'graph':
      return null
  }
}

export async function getContext(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, null)
  const tab = workspace.active
  const last = tab?.note.live.readerAt ?? null
  const named = namedOutside()

  const context = {
    space: place.space.name,
    selected: tab ? tabOf(tab) : null,
    selection: tab ? await selectionIn(tab) : null,
    tabs: workspace.tabs.map(tabOf),
    typing: last !== null && Date.now() - last < TYPING,
  }

  // A page's title, what a terminal printed and the words of a space somebody else
  // writes in are not the reader's words.
  const outside =
    tab?.kind === 'terminal' ? 'tab titles and terminal output' : named ? 'tab titles' : null
  return done(context, sharedSource(place) ?? outside)
}

/** Whether a tab's title is somebody else's words: a page's, or the program a terminal
 *  is running. */
function namedOutside(): boolean {
  return workspace.tabs.some((one) => one.kind === 'web' || one.kind === 'terminal')
}

/** The tab a call names by id. */
function tabNamed(call: Call): Tab {
  return tabWithId(need(call, 'tab'))
}

/** Whether a call asked for its tab behind the one in front, which is the default:
 *  `background` false asks for the front, and needs `workspace.focus`. */
function behind(call: Call): boolean {
  return !('background' in call.args) || flag(call, 'background')
}

/** A tab made or opened, answered as its row; null where nothing came of it. */
function answered(tab: Tab | null | undefined, place?: Place): AgentAnswer {
  return done(tab ? tabOf(tab) : null, place ? sharedSource(place) : null)
}

/** The site rule that denies an address to this agent, as the crate matches one: the
 *  host, or a host under it (`covers` in policy.rs). */
function deniedSite(call: Call, url: string): string | null {
  const host = hostOf(url)
  const sites = call.caller.agent?.sites ?? {}
  if (!host) return null

  return (
    Object.keys(sites).find(
      (site) => sites[site] === 'deny' && (host === site || host.endsWith(`.${site}`)),
    ) ?? null
  )
}

/** An address an agent may open in one of the reader's tabs. */
function webOf(call: Call, url: string): string {
  if (!isWebAddress(url)) throw new Refused('bad_arguments', `${url} is not a web address`)
  const denied = deniedSite(call, url)
  if (denied) throw new Refused('site_denied', `${denied} is a site this agent may not open`)

  return url
}

/** A page in a tab of the reader's: behind the tab in front unless asked for the front. */
function openPage(call: Call, url: string): AgentAnswer {
  const back = behind(call)
  if (!back) needScope(call, 'workspace.focus', 'opening in front')

  const id = workspace.openPage(webOf(call, url), back ? 'behind' : 'plain')
  return answered(workspace.tabs.find((one) => one.id === id))
}

/** The sections of Settings an agent may open it at, as the sheet names them. */
const SECTIONS: readonly Section[] = [
  'general',
  'editor',
  'shortcuts',
  'spelling',
  'markdown',
  'appearance',
  'ai',
  'agents',
  'sync',
  'export',
]

/** Settings, in front, at a section: a sheet over the window rather than a tab, so it
 *  is only ever in front, and what is in it is read and written by `read_setting` and
 *  `write_setting`. */
function showSettings(call: Call): AgentAnswer {
  needScope(call, 'workspace.focus', 'Settings')
  const asked = maybe(call, 'section') ?? 'general'
  const section = SECTIONS.find((one) => one === asked)
  if (!section) throw new Refused('bad_arguments', `section is one of ${SECTIONS.join(', ')}`)

  settings.show(section)
  return done({ settings: section })
}

/** `open`: a file of a space, a page, the graph, the scratchpad or Settings. */
async function openSomething(call: Call): Promise<AgentAnswer> {
  const url = maybe(call, 'url')
  if (url !== null) return openPage(call, url)

  const view = maybe(call, 'view')
  if (view === 'graph') {
    // The graph only opens in front of its pane.
    needScope(call, 'workspace.focus', 'the graph')
    workspace.openGraph()
    return answered(workspace.active)
  }
  if (view === 'scratchpad') {
    const back = behind(call)
    if (!back) needScope(call, 'workspace.focus', 'opening in front')
    const { scratchpad } = await import('../../scratchpad/pad')
    const path = await scratchpad.where()
    await workspace.open(path, back ? { activate: false, beside: true } : {})
    return answered(workspace.tabs.find((one) => one.path === path))
  }
  if (view === 'settings') return showSettings(call)
  if (view !== null) throw new Refused('bad_arguments', 'view is graph, scratchpad or settings')

  const place = placeFor(call, maybe(call, 'space'))
  const relative = judged(need(call, 'path'))
  const path = onDisk(place, relative)
  const back = behind(call)
  if (!back || !place.open) {
    needScope(call, 'workspace.focus', place.open ? 'opening in front' : 'another space')
  }
  if (!(await entryIn(place, relative))) {
    throw new Refused('no_such_file', `there is nothing at ${relative}`)
  }

  if (!place.open) await workspace.showSpace(place.space.id)
  await workspace.openEntry(path, back ? { activate: false, beside: true } : {})

  return answered(
    workspace.tabs.find((one) => one.path === path),
    place,
  )
}

/** The kind a `new` asks for. */
function newKindOf(call: Call): NewKind {
  const kind = maybe(call, 'kind') ?? 'note'
  const found = NEW_KINDS.find((one) => one === kind)
  if (!found) throw new Refused('bad_arguments', `kind is one of ${NEW_KINDS.join(', ')}`)

  return found
}

/** `new`: a tab with no file, of any kind, behind the tab in front - the plus in the
 *  strip, pressed for the reader. A note's words, a page's address, a terminal's shell
 *  and folder may come with it; a note, a canvas and a page note stay unsaved, with the
 *  dot, until somebody saves them (`save`). */
async function newTab(call: Call): Promise<AgentAnswer> {
  const kind = newKindOf(call)
  const place = placeFor(call, null)
  const back = behind(call)
  if (!back) needScope(call, 'workspace.focus', 'a new tab in front')
  const beside = back ? workspace.activeTabId : null

  const question = await asked(call, null, `A new ${kind} tab`)
  if (question) return question

  switch (kind) {
    case 'web': {
      const url = maybe(call, 'url')
      if (url === null) throw new Refused('bad_arguments', 'a web tab says its url')
      return openPage(call, url)
    }

    // Only made: its shell starts when it is first shown, or typed into, which is
    // `type_terminal`'s and asks the way it does.
    case 'terminal': {
      const { shells } = await import('../../terminal/shells.svelte')
      const list = await shells.ask()
      const named = maybe(call, 'shell')?.toLowerCase() ?? null
      const shell =
        named === null
          ? shells.chosen
          : list.find((one) => [one.id, one.name].some((word) => word.toLowerCase() === named))
      if (!shell) {
        const names = list.map((one) => one.name).join(', ')
        throw new Refused('bad_arguments', `there is no shell ${named ?? ''}: ${names}`)
      }

      const cwd = maybe(call, 'cwd')
      const folder = cwd === null ? undefined : onDisk(place, judged(cwd))
      const { openTerminal } = await import('../../terminal/open')
      const made = await openTerminal(shell.id, {
        ...(folder === undefined ? {} : { folder }),
        ...(beside ? { beside } : {}),
        activate: !back,
      })
      return answered(made)
    }

    case 'canvas': {
      const { blankCanvas } = await import('../../canvas/format')
      return answered(workspace.openUnsaved('canvas', blankCanvas(), undefined, beside, !back))
    }

    case 'pages': {
      const { blankPages } = await import('@nib/markdown/pages')
      const { modes } = await import('../../modes.svelte')
      const made = workspace.openUnsaved(
        'pages',
        blankPages(modes.pagesPaper),
        undefined,
        beside,
        !back,
      )
      return answered(made)
    }

    case 'note': {
      const made = workspace.openUnsaved('note', '', undefined, beside, !back)
      // The words go in as the agent's own edit, so they are one step to undo with its
      // caret on them, the way every agent edit is.
      const words = text(call, 'content')
      if (words) await notes.writeNote(writerOf(call), { path: '', tab: made.id }, words)
      return answered(made)
    }
  }
}

/** `rename`: a tab's name. A file's is a rename of the file, every link rewritten and
 *  one step to undo, through the same move `move_file` makes; an unsaved note's is the
 *  name it will be offered when it is saved; a terminal's is the strip's own rename,
 *  kept through a restart (terminal/rename.ts). A page's title is the page's. */
async function renameTab(call: Call): Promise<AgentAnswer> {
  const tab = tabNamed(call)
  const name = need(call, 'name').trim()
  if (!name || /[\\/]/.test(name))
    throw new Refused('bad_arguments', 'a name is one step, no slash')

  const place = placeFor(call, null)
  if (tab.path !== null && !workspace.outside(tab.path)) {
    const relative = relativeTo(place.space.root, tab.path)
    const folder = folderOf(relative)
    const to = folder ? `${folder}/${name}` : name
    return moveFile({ ...call, args: { path: relative, to } })
  }

  if (!isDraft(tab.note) && tab.kind !== 'terminal') {
    throw new Refused('by_hand', `tab ${tab.id} is a ${tab.kind} tab, named by what it shows`)
  }

  const question = await asked(call, null, `Rename ${tab.shown} to ${name}`)
  if (question) return question

  if (tab.kind === 'terminal') {
    const { renameTerminal } = await import('../../terminal/rename')
    await renameTerminal(tab, name)
  } else {
    tab.note.name = name
    workspace.scheduleSession()
  }
  return answered(tab)
}

/** `save`: an unsaved tab given a file at a path in the open space - a note, a canvas
 *  or a page note written there, a web tab kept there as a web note - the way Save and
 *  a drop on a folder do. A name that is taken is given the next number, as Save does. */
async function saveTab(call: Call): Promise<AgentAnswer> {
  const tab = tabNamed(call)
  if (!isUnsaved(tab.note)) throw new Refused('exists', `tab ${tab.id} has a file already`)

  const place = placeFor(call, null)
  const relative = judgedForWriting(need(call, 'path'))
  const folder = folderOf(relative)
  const file = fileNamed(nameOf(relative), tab.kind)

  const question = await asked(call, null, `Save ${tab.shown} as ${relative}`)
  if (question) return question

  const saved = await workspace.save(tab, folder ? onDisk(place, folder) : place.space.root, file)
  if (saved === null) throw new Refused('failed', `tab ${tab.id} could not be saved`)

  return done({ ...tabOf(tab), path: relativeTo(place.space.root, saved) })
}

export async function workspaceTabs(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  // The reader's tabs belong to the space they are in; an agent that may not reach it
  // has no business with them.
  placeFor(call, null)

  switch (op) {
    case 'list':
      return done(workspace.tabs.map(tabOf), namedOutside() ? 'tab titles' : null)

    case 'open':
      return openSomething(call)

    case 'new':
      return newTab(call)

    case 'rename':
      return renameTab(call)

    case 'save':
      return saveTab(call)

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
      return answered(tab)
    }

    default:
      throw new Refused(
        'bad_arguments',
        'op is one of list, open, new, rename, save, close, split, focus',
      )
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
