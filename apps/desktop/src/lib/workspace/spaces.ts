/** The list of spaces: what is on this machine, in what order, and which one is
 *  open.
 *
 *  A space is a folder under the one the app owns, and that folder is the truth: a
 *  space made or removed outside the app simply shows up that way on the next
 *  listing. What the folder does not decide is the order they appear in, which is
 *  the account's, so every machine's switcher reads alike.
 *
 *  Its own module because the list is a thing with rules of its own - ids that
 *  survive a reload, an order two machines have to agree on, a folder renamed or
 *  gone said once to everything kept under it - and none of those rules is about
 *  what is open in a pane. Making, adopting, renaming and deleting one are
 *  space-changes.ts, fetched by the first of them. */

import { spacesAhead } from './ahead'
import { identifier } from '../identifier'
import { isRecord, stored } from '../stored'
import { invoke } from '../tauri'
import type { Entry, Naming, Panel, Space } from '../workspace.svelte'
import type { Tab } from './documents.svelte'

/** What the list of spaces needs of the store holding it. */
export interface HoldsSpaces {
  spaces: Space[]
  activeSpaceId: string | null
  tree: Entry | null
  naming: Naming | null
  panel: Panel | null
  readonly notes: Entry[]
  readonly tabs: Tab[]
  fileMoved(from: string, to: string, kind: 'space'): Promise<void>
  fileGone(path: string, kind: 'space'): Promise<void>
  close(id: string): void
  clearSelection(): void
  loadTree(): Promise<void>
  persist(): void
}

/** Reads the spaces folder. It is the source of truth, so a space added or
 *  removed outside the app simply shows up that way. */
export async function loadSpaces(ws: HoldsSpaces) {
  // Read while the webview started, the first time; see workspace/ahead.ts.
  const found =
    (await spacesAhead()) ??
    (await invoke<{ name: string; path: string }[]>('list_spaces').catch(() => []))

  // Ids are kept across a reload so the selected space survives one.
  const byRoot = new Map(ws.spaces.map((space) => [space.root, space]))

  // The folder decides which spaces exist; the account decides the order they
  // appear in. Without this, a listing that comes back alphabetical would
  // undo every move on the next reload.
  const rank = new Map(ws.spaces.map((space, index) => [space.root, index]))
  const at = (root: string) => rank.get(root) ?? Number.MAX_SAFE_INTEGER

  ws.spaces = found
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => at(a.entry.path) - at(b.entry.path) || a.index - b.index)
    .map(
      ({ entry }) =>
        byRoot.get(entry.path) ?? { id: identifier(), name: entry.name, root: entry.path },
    )

  if (!ws.spaces.some((space) => space.id === ws.activeSpaceId)) {
    ws.activeSpaceId = ws.spaces[0]?.id ?? null
  }
}

/** Drops the dragged space in front of `beforeId`, or at the end for null.
 *  Returns whether anything actually moved, so a drag onto itself is quiet. */
export function moveSpace(ws: HoldsSpaces, id: string, beforeId: string | null): boolean {
  const moving = ws.spaces.find((space) => space.id === id)
  if (!moving || id === beforeId) return false

  const rest = ws.spaces.filter((space) => space.id !== id)
  const at = beforeId ? rest.findIndex((space) => space.id === beforeId) : rest.length
  if (at < 0) return false

  const next = [...rest.slice(0, at), moving, ...rest.slice(at)]
  if (sameOrder(ws, next)) return false

  ws.spaces = next
  ws.persist()
  return true
}

/** Whether a proposed order is the one already on show, so a drag that ends
 *  where it started, or an account order that matches, stays quiet. */
function sameOrder(ws: HoldsSpaces, next: readonly Space[]): boolean {
  return next.every((space, index) => space.id === ws.spaces[index]?.id)
}

/** Takes the account's order, which is the one the other machines see.
 *  A space this machine has but the account does not keeps its place. */
export function applySpaceOrder(ws: HoldsSpaces, names: string[]): boolean {
  const rank = new Map(names.map((name, index) => [name, index]))
  const at = (name: string) => rank.get(name) ?? Number.MAX_SAFE_INTEGER

  const next = ws.spaces
    .map((space, index) => ({ space, index }))
    .sort((a, b) => at(a.space.name) - at(b.space.name) || a.index - b.index)
    .map((entry) => entry.space)

  if (sameOrder(ws, next)) return false

  ws.spaces = next
  ws.persist()
  return true
}

/** Where each space's choice of tabs is kept, on this device; see sets.ts. */
export const TABS_KEY = 'nib:space-tabs'

/** Whether a space keeps tabs of its own rather than the ones every space shares. */
export function ownTabs(id: string | null): boolean {
  const kept = stored(TABS_KEY)
  return id !== null && isRecord(kept) && kept[id] === 'space'
}

/** Whether this window has fetched sets.svelte.ts, which every switch goes through then. */
export const tabSets = { fetched: false }

/** `shown` is the switcher's way in. Picking a space with the sidebar closed showed
 *  nothing, so the sidebar comes up with the tree, as Ctrl+Shift+L opens it. */
export async function selectSpace(ws: HoldsSpaces, id: string, shown = false) {
  // A space with tabs of its own on either side swaps them; see sets.svelte.ts.
  if (tabSets.fetched || ownTabs(ws.activeSpaceId) || ownTabs(id)) {
    const { sets } = await import('./sets.svelte')
    return sets.toSpace(id, shown)
  }

  if (shown) ws.panel ??= 'tree'
  ws.activeSpaceId = id
  ws.clearSelection()
  await ws.loadTree()
  ws.persist()
}

export async function showSpace(ws: HoldsSpaces, id: string) {
  await selectSpace(ws, id, true)
}
