/** The spaces' own sets of tabs, carried out on the workspace: a switch putting one set
 *  aside and bringing another in, a tab of a set out of sight shown, the choice changed,
 *  and the sets written with the session and built again after a restart. What each of
 *  those decides is sets.ts; this is the store that does it.
 *
 *  **A set out of sight is a frame put aside.** Every tab of every set stays in the
 *  workspace's one strip, so everything that holds across the tabs holds across the sets
 *  without being told: one document per file, one tab per web note, a page and a shell
 *  running for as long as their tab is open, a file renamed or deleted under a tab nobody
 *  can see. A tab is on screen when its pane is in the frame on screen; the frames of
 *  the other sets are kept here with the rest of what belongs to them - which pane has
 *  the focus and which fills the window, both sides' panels, the preview, the tab the
 *  panels are held on, and whether the keyboard was in a page.
 *
 *  Fetched by the first switch that involves a space keeping its own tabs, by the
 *  space menu's Tabs row, and by a launch whose session holds sets, at its last turn: a
 *  window whose spaces are all Global never loads it. */

import { tick, untrack } from 'svelte'
import { focusEditor } from '../focus'
import { identifier } from '../identifier'
import { without } from '../records'
import { isRecord, keep, stored } from '../stored'
import { spaceSound } from '../surfaces.svelte'
import { invoke, isDesktop } from '../tauri'
import { IN_A_PAGE } from '../trap'
import { pages } from '../web-tab/pages.svelte'
import { type Panel, type Tab, workspace } from '../workspace.svelte'
import { type Frame, pane, paneIn, panesIn } from './pane-tree'
import { byPin } from './pinning'
import {
  focusIn,
  GLOBAL,
  ownerOf,
  readSets,
  type SetDraft,
  type SetsDraft,
  setKey,
  sharedHome,
  type TabsMode,
  tidied,
} from './sets'
import { ownTabs, TABS_KEY, tabSets } from './spaces'

/** A set out of sight: everything about the window that is the set's, but its tabs. */
interface Aside {
  frame: Frame
  focused: string
  fills: string | null
  panel: Panel | null
  rightPanel: Panel | null
  preview: string | null
  held: string | null
  /** Whether the keyboard was in a page as the set was left, rather than in the app. */
  inPage: boolean
}

/** Reads a value so that whatever is working something out follows it. */
const follows = (_value: unknown) => undefined

/** The Hidden tabs answer and what it does, fetched with the first set that hides a
 *  page; see hidden-tabs.svelte.ts. */
const hiddenTabs = () => import('./hidden-tabs.svelte').then((one) => one.hiddenTabs)

class Sets {
  /** The sets out of sight, by key. Raw: replaced whole on every change. */
  private aside = $state.raw<Record<string, Aside>>({})
  /** Sets a session named that have not been built back yet, by key. */
  private drafted: Record<string, SetDraft> = {}
  /** Builds under way, so a switch and the launch's build share one. */
  private building = new Map<string, Promise<void>>()
  /** The set on screen. Kept rather than worked out from the space, because the choice
   *  is the device's and another window may change it under this one: the tabs on screen
   *  are whichever set they were when it changed. */
  on: string
  /** The Global space the reader was in last, where a hidden tab of the shared set is
   *  shown again. */
  private lastShared: string | null = null
  /** Switches one at a time: the second waits for the first's swap. */
  private going: Promise<void> = Promise.resolve()
  /** A count of the choices made here, so what is worked out from them follows them. */
  private chosen = $state(0)

  constructor() {
    const read = readSets(workspace.setsRead)
    this.on = read?.on ?? setKey(workspace.activeSpaceId, ownTabs)
    this.drafted = read?.aside ?? {}
    if (this.on === GLOBAL) this.lastShared = workspace.activeSpaceId
    workspace.setsWritten = () => this.written()
    tabSets.fetched = true
    void spaceSound.ask()
  }

  /** Whether a space keeps its own tabs. Read through the store's count, so a row that
   *  shows it follows a change made in this window. */
  modeOf(space: string): TabsMode {
    follows(this.chosen)
    return ownTabs(space) ? 'space' : 'global'
  }

  /** The sets the session named, built in the background. */
  async wake(): Promise<void> {
    for (const key of Object.keys(this.drafted)) await this.built(key)
  }

  /** The switch to a space, wherever it was asked. The set on screen is put aside and the
   *  space's own brought in, in the one step that also changes the space, so the first
   *  frame drawn after it is the new set whole; then the tree is read, as any switch reads
   *  it. Between two spaces that share the global set nothing is swapped. */
  async toSpace(id: string, shown: boolean): Promise<void> {
    const ws = workspace
    this.going = this.going.catch(() => undefined).then(() => this.swap(id))
    await this.going

    if (shown) ws.panel ??= 'tree'
    ws.clearSelection()
    await ws.loadTree()
    ws.persist()
  }

  private async swap(id: string): Promise<void> {
    const ws = workspace
    const to = setKey(id, ownTabs)
    if (to === GLOBAL) this.lastShared = id
    if (to === this.on) {
      ws.activeSpaceId = id
      return
    }

    await this.built(to)
    const left = this.on
    const coming = this.aside[to]
    this.putAside(left)
    this.bringIn(to, coming)
    ws.activeSpaceId = id

    void this.settle(left, to, coming)
  }

  /** The set on screen, put aside under its key. */
  private putAside(key: string) {
    const ws = workspace
    this.aside = {
      ...this.aside,
      [key]: {
        frame: ws.panes.frame,
        focused: ws.panes.focusedId,
        fills: ws.panes.fills,
        panel: ws.panel,
        rightPanel: ws.rightPanel,
        preview: ws.previewTabId,
        held: ws.heldTabId,
        inPage: typeof document !== 'undefined' && document.documentElement.hasAttribute(IN_A_PAGE),
      },
    }
  }

  /** A set brought on screen: its frame, put right for whatever happened to its tabs out
   *  of sight, or one empty pane for a space that has never had a set. The sides of a set
   *  never seen are left as they are. */
  private bringIn(key: string, set: Aside | undefined) {
    const ws = workspace
    this.aside = without(this.aside, key)
    this.on = key

    const frame = set ? this.tidy(set.frame) : pane(identifier())
    ws.panes.swapping = true
    ws.panes.restore(frame, set ? focusIn(frame, set.focused) : frame.id)
    ws.panes.fills = set?.fills && paneIn(frame, set.fills) ? set.fills : null
    if (set) {
      ws.panel = set.panel
      ws.rightPanel = set.rightPanel
    }
    ws.previewTabId = set?.preview ?? null
    ws.heldTabId = set?.held ?? null
  }

  /** After the swap: the strip's arrival is over by the next frame, the keyboard goes
   *  where the new set had it, and the Hidden tabs answer is given to the set that left. */
  private async settle(left: string, to: string, coming: Aside | undefined) {
    setTimeout(() => (workspace.panes.swapping = false))
    await tick()

    const front = workspace.active
    if (coming?.inPage && front?.kind === 'web') {
      void invoke('keyboard_back', { tab: front.id }).catch(() => undefined)
    } else if (coming && typeof document !== 'undefined' && front?.kind === 'note') {
      focusEditor()
    }

    if (!isDesktop) return
    const hidden = await hiddenTabs()
    hidden.came(this.tabsOf(to))
    await hidden.left(this.tabsOf(left))
  }

  /** The tabs of a set: on screen, or in a frame put aside. */
  tabsOf(key: string): Tab[] {
    const set = this.aside[key]
    if (key === this.on) return workspace.tabs.filter((tab) => workspace.panes.at(tab.paneId))
    if (!set) return []

    const panes = new Set(panesIn(set.frame).map((one) => one.id))
    return workspace.tabs.filter((tab) => panes.has(tab.paneId))
  }

  /** Which set out of sight a tab is in, or null. */
  private setOf(tab: Tab): string | null {
    for (const [key, set] of Object.entries(this.aside)) {
      if (paneIn(set.frame, tab.paneId)) return key
    }
    return null
  }

  /** A frame with its panes put right for what happened to its tabs; see `tidied`. */
  private tidy(frame: Frame): Frame {
    return tidied(
      frame,
      (paneId) => workspace.tabsIn(paneId).map((tab) => tab.id),
      (strip) => workspace.panes.lastOf(strip),
    )
  }

  /** A tab of a set out of sight, brought to the front: its space comes first, the way
   *  Arc's command bar goes to the space a tab is in and Chrome's Switch to tab to its
   *  window. A tab of the shared set comes back in its own space where that one shares
   *  the set, else in the Global space last shown. One no space shows any more - every
   *  space keeps its own now - comes into the set on screen instead. */
  async reveal(id: string): Promise<void> {
    const ws = workspace
    const tab = ws.tabs.find((one) => one.id === id)
    if (!tab) return

    const key = this.setOf(tab)
    const shared = ws.spaces.map((one) => one.id).filter((one) => !ownTabs(one))
    const space =
      key === null
        ? null
        : key === GLOBAL
          ? sharedHome(ownerOf(tab.path, tab.note.home, ws.spaces), this.lastShared, shared)
          : ws.spaces.some((one) => one.id === key)
            ? key
            : null

    if (space !== null) await this.toSpace(space, false)
    // Still out of sight - a choice changed in another window under this one - it comes
    // here rather than nowhere.
    if (!ws.panes.at(tab.paneId)) this.carry([tab], ws.panes.focusedId)
    ws.activeTabId = id
  }

  /** Tabs moved to the end of a pane's strip, the kept ones to the end of the kept run. */
  private carry(tabs: readonly Tab[], paneId: string) {
    const ws = workspace
    for (const tab of tabs) tab.paneId = paneId
    ws.tabs = byPin([...ws.tabs.filter((tab) => !tabs.includes(tab)), ...tabs])
  }

  /** A space's tabs made its own, or given back to the shared set; the row in the space's
   *  menu. Nothing is closed either way: an unsaved note or a terminal is a tab, and a
   *  tab only ever moves. */
  async choose(space: string, mode: TabsMode): Promise<void> {
    if (this.modeOf(space) === mode) return

    const kept = stored(TABS_KEY)
    const next = without(isRecord(kept) ? kept : {}, space)
    keep(TABS_KEY, JSON.stringify(mode === 'space' ? { ...next, [space]: 'space' } : next))
    this.chosen++

    const shown = this.tabsOf(this.on)
    if (mode === 'space') await this.part(space)
    else await this.join(space)
    workspace.persist()

    // What the change put out of sight is hidden as a switch hides it, and what it put
    // on screen runs again.
    if (!isDesktop) return
    const hidden = await hiddenTabs()
    hidden.came(this.tabsOf(this.on))
    await hidden.left(shown.filter((tab) => !workspace.panes.at(tab.paneId)))
  }

  /** Global to Space: the space keeps the tabs that are its own - its files, and the
   *  unsaved tabs and terminals opened in it - and the rest stay shared. Shown, the
   *  arrangement on screen is the space's and the others leave the strip; out of sight,
   *  its own leave the shared set for a set of its own. */
  private async part(space: string) {
    const ws = workspace
    await this.built(GLOBAL)

    const shared = this.tabsOf(GLOBAL)
    const owner = (tab: Tab) => ownerOf(tab.path, tab.note.home, ws.spaces)

    if (this.on === GLOBAL && ws.activeSpaceId === space) {
      this.on = space
      const others = shared.filter((tab) => owner(tab) !== null && owner(tab) !== space)
      if (others.length) this.aside = { ...this.aside, [GLOBAL]: this.fresh(others, ws.panel) }
      ws.panes.restore(this.tidy(ws.panes.frame), ws.panes.focusedId)
      return
    }

    const own = shared.filter((tab) => owner(tab) === space)
    if (!own.length) return

    this.aside = { ...this.aside, [space]: this.fresh(own, 'tree') }
    if (this.on === GLOBAL) ws.panes.restore(this.tidy(ws.panes.frame), ws.panes.focusedId)
    else this.retidy(GLOBAL)
  }

  /** Space to Global: the space's tabs join the shared set, at the end of the strip in
   *  front - the arrangement on screen stays, whichever of the two it is. */
  private async join(space: string) {
    const ws = workspace
    await this.built(space)
    await this.built(GLOBAL)

    if (this.on === space) {
      this.carry(this.tabsOf(GLOBAL), ws.panes.focusedId)
      this.aside = without(this.aside, GLOBAL)
      this.on = GLOBAL
      return
    }

    const set = this.aside[space]
    const own = this.tabsOf(space)
    this.aside = without(this.aside, space)
    if (!set || !own.length) return

    const shared = this.aside[GLOBAL]
    if (this.on === GLOBAL) this.carry(own, ws.panes.focusedId)
    else if (shared) this.carry(own, shared.focused)
    else this.aside = { ...this.aside, [GLOBAL]: set }
  }

  /** A set of one pane holding these tabs, the one in front last in front. */
  private fresh(tabs: readonly Tab[], panel: Panel | null): Aside {
    const made = pane(identifier())
    this.carry(tabs, made.id)
    made.activeTabId = workspace.panes.lastOf(tabs.map((tab) => tab.id)) ?? tabs.at(-1)?.id ?? null
    return {
      frame: made,
      focused: made.id,
      fills: null,
      panel,
      rightPanel: null,
      preview: null,
      held: null,
      inPage: false,
    }
  }

  /** A set out of sight with its frame put right. */
  private retidy(key: string) {
    const set = this.aside[key]
    if (!set) return
    const frame = this.tidy(set.frame)
    this.aside = { ...this.aside, [key]: { ...set, frame, focused: focusIn(frame, set.focused) } }
  }

  /** A set the session named, built back through the session's own restore - the same
   *  drafts, documents and frame a launch puts on screen - into a frame put aside. One
   *  build per set, however many ask. */
  private built(key: string): Promise<void> {
    const draft = this.drafted[key]
    if (!draft || key === this.on) return this.building.get(key) ?? Promise.resolve()

    this.drafted = without(this.drafted, key)
    const building = workspace.opened.arranging(async () => {
      const { frame, made } = await workspace.built(draft.layout)
      if (!made.length || key === this.on) return
      workspace.tabs = [...workspace.tabs, ...made]
      this.aside = {
        ...this.aside,
        [key]: {
          frame,
          focused: focusIn(frame, draft.layout.focused),
          fills: null,
          panel: draft.layout.panel,
          rightPanel: draft.right,
          preview: null,
          held: null,
          inPage: false,
        },
      }
    })
    this.building.set(key, building)
    return building
  }

  /** The sets out of sight as the session writes them: the ones built, drafted through the
   *  session's own `layout`, and the ones not built yet as they were read. Nothing at all
   *  where the shared set is on screen and none is aside, which is a session like any
   *  before there were sets. */
  private written(): SetsDraft | undefined {
    const aside: Record<string, SetDraft> = { ...this.drafted }
    for (const [key, set] of Object.entries(this.aside)) {
      if (!this.tabsOf(key).length) continue
      aside[key] = {
        layout: workspace.layout(set.frame, set.focused, set.panel),
        right: set.rightPanel,
      }
    }
    return this.on === GLOBAL && !Object.keys(aside).length ? undefined : { on: this.on, aside }
  }

  /** The spaces with a page playing in a set out of sight, for the sound mark on the
   *  space's row; see SpaceSound.svelte. A page of the shared set marks its own space, or
   *  every space that shares the set where its own does not. */
  readonly playing = $derived.by((): string[] => {
    follows(this.chosen)
    const out: string[] = []
    for (const [key, set] of Object.entries(this.aside)) {
      const panes = panesIn(set.frame).map((one) => one.id)
      for (const tab of workspace.tabs) {
        if (tab.kind !== 'web' || !panes.includes(tab.paneId) || !pages.of(tab.id).playing) continue

        const owner = ownerOf(tab.path, tab.note.home, workspace.spaces)
        const shared = workspace.spaces.map((one) => one.id).filter((one) => !ownTabs(one))
        const marked =
          key !== GLOBAL ? [key] : owner !== null && shared.includes(owner) ? [owner] : shared
        out.push(...marked.filter((one) => !out.includes(one)))
      }
    }
    return out
  })

  /** A space deleted takes its set with it: its tabs close the way any tab closes, so an
   *  unsaved note's words go to Recently deleted. An empty list is a listing that failed
   *  rather than every space gone, and leaves the sets alone. */
  private gone(spaces: readonly string[]) {
    if (!spaces.length) return

    for (const key of Object.keys(this.aside)) {
      if (key === GLOBAL || spaces.includes(key)) continue
      for (const tab of this.tabsOf(key)) workspace.close(tab.id)
      this.aside = without(this.aside, key)
    }
    for (const key of Object.keys(this.drafted)) {
      if (key !== GLOBAL && !spaces.includes(key)) this.drafted = without(this.drafted, key)
    }
  }

  /** Follows the list of spaces, for `gone`. */
  watch() {
    $effect.root(() => {
      $effect(() => {
        const spaces = workspace.spaces.map((one) => one.id)
        untrack(() => this.gone(spaces))
      })
    })
  }
}

export const sets = new Sets()
sets.watch()
void sets.wake()
