/** Opening a view in a tab: a row of the Tasks panel, a `.base` file from the file
 *  list or a link, a key.
 *
 *  One tab per view per pane, as the graph is one: asking for Today again brings the
 *  Today tab forward, whatever it was changed to show. Making the tab is the
 *  workspace's (`openView`); which view a tab is, and so whether one is open already,
 *  is the spec's (spec.ts). */

import { writeBase } from '@nib/bases'
import type { OpenHow } from '../new-tab'
import { nameOf, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { type Builtin, readSpec, sameView, type ViewSpec, writeSpec } from './spec'
import { setLayout } from './edit'
import { builtinBase } from './source'
import { builtinName } from './words'

/** The tab already showing this view in the pane being worked in. */
function openAlready(spec: ViewSpec, path: string | null) {
  const paneId = workspace.panes.focusedId
  return workspace.tabs.find((tab) => {
    if (tab.kind !== 'view' || tab.paneId !== paneId) return false
    if (path !== null || tab.path !== null) return samePath(tab.path, path)
    const there = readSpec(tab.doc)
    return there !== null && sameView(there, spec)
  })
}

/** The view a spec names, in a tab: the one already open brought forward, or a new one. */
function openSpec(spec: ViewSpec, name: string, path: string | null = null, how: OpenHow = {}) {
  const there = openAlready(spec, path)
  if (there) {
    if (how.activate !== false) workspace.panes.activate(there.paneId, there.id)
    return there
  }
  return workspace.openView(writeSpec(spec), name, path, how)
}

/** A view nib ships: Inbox, Today, Upcoming, Logbook. */
export function openBuiltin(builtin: Builtin, how: OpenHow = {}) {
  return openSpec({ builtin }, builtinName(builtin), null, how)
}

/** A project's tasks as a view of their own, which "Open as board" and "Open as
 *  calendar" open with that layout. */
export function openProject(space: string, path: string, layout?: string) {
  const name = nameOf(path).replace(/\.md$/i, '')
  const spec: ViewSpec = { builtin: 'project', space, path }
  const tab = openSpec(spec, name)
  if (layout) {
    // The tab's own words say the layout, so a tab already open switches to it too and
    // the view in it reads the change (ViewTab.svelte).
    const now = readSpec(tab.doc) ?? spec
    const base = setLayout(builtinBase(now), 0, layout)
    tab.note.replace(writeSpec({ ...now, yaml: writeBase(base) }), false)
    workspace.scheduleSession()
  }
  return tab
}

/** A label's tasks and notes. */
export function openLabel(tag: string) {
  return openSpec({ builtin: 'label', tag }, `#${tag}`)
}

/** A `.base` file, as its view. */
export function openBaseFile(path: string, how: OpenHow = {}, view?: string) {
  const name = nameOf(path).replace(/\.base$/i, '')
  return openSpec(view === undefined ? {} : { view }, name, path, how)
}
