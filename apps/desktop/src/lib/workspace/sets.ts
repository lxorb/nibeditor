/** A space's own tabs, decided: which set of tabs a space shows, what a set out of sight
 *  is written down as, and what happens to the tabs when the choice changes.
 *
 *  Emil, 2026-10-01: *"just as you can choose whether cookies are per space or separate,
 *  there should be an option whether the tabs are global or only for the space. Only for
 *  the space means the whole open configuration is saved for that space, and it changes
 *  automatically when you switch to another space."*
 *
 *  So every space is one of two, the way its web data is one of three (web-data.ts):
 *
 *  - **global** - the one set every such space shares, which is what every space has
 *    always had: moving between two of them changes nothing on screen.
 *  - **space** - a set of the space's own: its tabs, its panes and splits, which tab is
 *    in front in each, the sidebars, the preview and where the keyboard was. Arc's
 *    spaces and VS Code's windows, where a workspace is its own editors.
 *
 *  Pure, so every rule here is read off lists in a test; sets.svelte.ts carries it out
 *  on the workspace, and docs/chrome-tabs.md says it for a reader. */

import { isRecord } from '../stored'
import { within } from '../space-paths'
import type { Panel } from '../workspace.svelte'
import { type Frame, paneIn, panesIn, withoutPane } from './pane-tree'
import { isPanel, type Layout, readLayout } from './session'

/** Whether a space shares the global tabs or keeps its own. */
export type TabsMode = 'global' | 'space'

/** The two, in the order they are offered: the same order the web data row offers its
 *  first two in, so the two rows read alike. */
export const TABS_MODES: readonly TabsMode[] = ['global', 'space']

/** What the set every Global space shares is kept under, beside the spaces' own ids. A
 *  space's id is a counter and a dash (identifier.ts), so no space is called this. */
export const GLOBAL = 'global'

/** Which set a space shows: its own, or the shared one. No space at all - a window that
 *  has none yet - shows the shared one. */
export function setKey(space: string | null, owns: (space: string) => boolean): string {
  return space !== null && owns(space) ? space : GLOBAL
}

/** Whether the tabs of a space out of sight keep running, are paused, or the reader is
 *  asked the first time it matters. One answer for the app, not one per space: it is
 *  about what this machine spends on what nobody is looking at, which is the same
 *  question in every space. */
export type HiddenTabs = 'run' | 'pause' | 'ask'

export function isHiddenTabs(value: unknown): value is HiddenTabs {
  return value === 'run' || value === 'pause' || value === 'ask'
}

/** What leaving a set does with the pages in it that are running: nothing where there
 *  are none - so the question is never asked about a set with nothing a pause would
 *  touch - and otherwise what the reader chose, `ask` while they have not. */
export function onLeaving(choice: HiddenTabs, running: number): HiddenTabs {
  return running > 0 ? choice : 'run'
}

/** Which space a tab belongs to: the space holding its file, else the one a tab with no
 *  file was opened in, else none - the graph, or a file somebody shared on its own. */
export function ownerOf(
  path: string | null,
  home: string | null,
  spaces: readonly { id: string; root: string }[],
): string | null {
  if (path === null) return home
  return spaces.find((one) => within(one.root, path) !== null)?.id ?? null
}

/** The space a hidden tab of the shared set comes back into view in: its own, where its
 *  own shares the set, else the Global space the reader was in last, else the first one.
 *  Null where no space shares the set any more. */
export function sharedHome(
  owner: string | null,
  last: string | null,
  shared: readonly string[],
): string | null {
  if (owner !== null && shared.includes(owner)) return owner
  if (last !== null && shared.includes(last)) return last
  return shared[0] ?? null
}

/** A set's frame after its tabs have changed out of sight: a pane with no tab left goes
 *  and its neighbour takes the room, as one does on screen, and a pane whose tab in
 *  front went shows the one it had in front last, else its first. A pane put down with
 *  Ctrl+D stays down: it showed nothing as the set was left, and a set comes back as it
 *  was left. The last pane stays, empty, since a window always has one. `strip` lists a
 *  pane's tabs in order; `last` picks the one in front last among them. */
export function tidied(
  frame: Frame,
  strip: (paneId: string) => readonly string[],
  last: (strip: readonly string[]) => string | null,
): Frame {
  let out = frame
  for (const one of panesIn(frame)) {
    if (!strip(one.id).length && panesIn(out).length > 1) out = withoutPane(out, one.id)
  }

  for (const one of panesIn(out)) {
    const tabs = strip(one.id)
    if (one.activeTabId === null ? tabs.length > 0 : tabs.includes(one.activeTabId)) continue
    one.activeTabId = last(tabs) ?? tabs[0] ?? null
  }

  return out
}

/** The focused pane of a frame, kept where it is still there. */
export function focusIn(frame: Frame, focused: string): string {
  return paneIn(frame, focused) ? focused : (panesIn(frame)[0]?.id ?? focused)
}

/** A set out of sight as the session writes it: the arrangement - the same `Layout` a
 *  session and a named layout are - and the right side, which a layout leaves out
 *  because it is the window's rather than an arrangement's. */
export interface SetDraft {
  layout: Layout
  right: Panel | null
}

/** Every set of a window as the session writes them: the key of the one on screen,
 *  whose arrangement is the session's own `layout`, and each of the others. */
export interface SetsDraft {
  on: string
  aside: Record<string, SetDraft>
}

/** What the session says, once it reads as that; an entry that does not is left out
 *  rather than guessed at, so one unreadable set costs that set and nothing else. */
export function readSets(value: unknown): SetsDraft | null {
  if (!isRecord(value) || typeof value.on !== 'string' || !isRecord(value.aside)) return null

  const aside: Record<string, SetDraft> = {}
  for (const [key, one] of Object.entries(value.aside)) {
    if (!isRecord(one)) continue
    const layout = readLayout(one.layout)
    if (layout) aside[key] = { layout, right: isPanel(one.right) ? one.right : null }
  }

  return { on: value.on, aside }
}
