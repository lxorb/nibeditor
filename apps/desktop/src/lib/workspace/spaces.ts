/** The list of spaces: what is on this machine, in what order, and which one is
 *  open.
 *
 *  A space is a folder under the one the app owns, and that folder is the truth: a
 *  space made or removed outside the app simply shows up that way on the next
 *  listing. What the folder does not decide is the order they appear in, which is
 *  the account's, so every machine's switcher reads alike.
 *
 *  Its own module because the list is a thing with rules of its own - ids that
 *  survive a reload, an order two machines have to agree on, four per-space stores
 *  that follow a folder when it is renamed and are forgotten when it goes - and
 *  none of those rules is about what is open in a pane. */

import { account } from '../account.svelte'
import { identifier } from '../identifier'
import { invoke } from '../tauri'
import { isUntouchedWelcome } from '../welcome'
import type { Entry, Naming, Panel, Space } from '../workspace.svelte'
import type { Bookmarks } from './bookmarks.svelte'
import type { DeviceView } from './device.svelte'
import type { NoteDoc, Tab } from './documents.svelte'
import type { ArchivedFolders } from './archived-folders.svelte'
import type { Excluded } from './excluded.svelte'
import type { FolderIcons } from './folder-icons.svelte'
import type { SpaceGraphSettings } from './graph-settings.svelte'

/** What the list of spaces needs of the store holding it. */
export interface HoldsSpaces {
  spaces: Space[]
  activeSpaceId: string | null
  tree: Entry | null
  naming: Naming | null
  panel: Panel | null
  readonly notes: Entry[]
  readonly tabs: Tab[]
  readonly documents: NoteDoc[]
  readonly bookmarks: Bookmarks
  readonly device: DeviceView
  readonly folderIcons: FolderIcons
  readonly graphSettings: SpaceGraphSettings
  readonly excluded: Excluded
  readonly archivedFolders: ArchivedFolders
  close(id: string): void
  clearSelection(): void
  loadTree(): Promise<void>
  persist(): void
}

/** Reads the spaces folder. It is the source of truth, so a space added or
 *  removed outside the app simply shows up that way. */
export async function loadSpaces(ws: HoldsSpaces) {
  const found = await invoke<{ name: string; path: string }[]>('list_spaces').catch(() => [])

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

  // Pins became bookmarks, and a pin is a path this machine wrote down, so
  // the spaces have to be known before it can be said which space it was in.
  // Runs itself once and then has nothing left to read.
  ws.bookmarks.migrate(ws.spaces.map((space) => space.root))
}

/** Creates a space folder under the one the app owns. The name is the only
 *  thing asked for; where it lives is not a decision worth making. */
/** A space the account has that this machine does not. Makes the folder and
 *  lists it, but does not switch to it: adopting someone else's space in the
 *  background should not move what is on screen out from under the writer.
 *  Unless nothing is on screen - a machine that has just erased its notes,
 *  or never had any, would otherwise list the account's spaces and show
 *  none of them. */
export async function adoptSpace(
  ws: HoldsSpaces,
  name: string,
  fresh = false,
): Promise<string | null> {
  // `fresh` is a space that must have a folder of its own even though one of
  // that name is already here: two spaces can be called the same thing once
  // one of them is somebody else's. The folder is then numbered, which is
  // what create_space does with a name that is taken.
  const existing = fresh ? undefined : ws.spaces.find((space) => space.name === name)
  if (existing) return existing.root

  const created = await invoke<{ name: string; path: string }>('create_space', {
    name: name.trim(),
  }).catch(() => null)

  if (!created) return null

  if (!ws.spaces.some((space) => space.root === created.path)) {
    const space: Space = { id: identifier(), name: created.name, root: created.path }
    ws.spaces = [...ws.spaces, space]

    if (ws.activeSpaceId) ws.persist()
    else await selectSpace(ws, space.id)
  }

  return created.path
}

export async function addSpace(ws: HoldsSpaces, name: string) {
  if (!name.trim()) return

  const created = await invoke<{ name: string; path: string }>('create_space', {
    name: name.trim(),
  }).catch(() => null)

  if (!created) return

  const space: Space = { id: identifier(), name: created.name, root: created.path }
  ws.spaces = [...ws.spaces, space]
  await selectSpace(ws, space.id)
  return space
}

export async function renameSpace(ws: HoldsSpaces, id: string, name: string) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space || !name.trim()) return

  // The field in the header is done with, whatever the folder answers: it is
  // held under the root, and the root is what is about to change.
  ws.naming = null

  const renamed = await invoke<{ name: string; path: string }>('rename_space', {
    from: space.root,
    name: name.trim(),
  }).catch(() => null)

  if (!renamed) return

  // Open notes point into the old folder, so move them with it.
  for (const note of ws.documents) {
    if (note.path?.startsWith(space.root)) {
      note.path = renamed.path + note.path.slice(space.root.length)
    }
  }

  // The icon is keyed by folder, so it has to follow the folder - and the
  // folder icons inside it are kept under the root, so they follow it too.
  ws.device.moveIcon(space.root, renamed.path)
  ws.folderIcons.spaceMoved(space.root, renamed.path)
  ws.graphSettings.spaceMoved(space.root, renamed.path)
  ws.excluded.spaceMoved(space.root, renamed.path)
  ws.archivedFolders.spaceMoved(space.root, renamed.path)

  space.name = renamed.name
  space.root = renamed.path
  if (ws.activeSpaceId === id) await ws.loadTree()
  ws.persist()
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

export async function selectSpace(ws: HoldsSpaces, id: string) {
  ws.activeSpaceId = id
  ws.clearSelection()
  await ws.loadTree()
  ws.persist()
}

/** The switcher's way in. Picking a space with the sidebar closed showed
 *  nothing, so the sidebar comes up with the tree, as Ctrl+Shift+L opens it. */
export async function showSpace(ws: HoldsSpaces, id: string) {
  ws.panel ??= 'tree'
  await selectSpace(ws, id)
}

/** True as soon as one note on this machine has something written in it.
 *  Stops at the first, so a large space costs no more than a small one. */
export async function hasLocalContent(ws: HoldsSpaces): Promise<boolean> {
  for (const note of ws.notes) {
    const doc = await invoke<string>('read_note', { path: note.path }).catch(() => '')
    if (!doc.trim()) continue

    // The welcome note exactly as the app wrote it is not writing, and the
    // question this answers is about writing: syncing already refuses to carry
    // an untouched seed up (sync/mirror.ts), so keeping it joins nothing to the
    // account and erasing it throws away nothing anybody wrote. Asked, it would
    // be the first thing a new reader ever sees - a warning that cannot be
    // undone, about the only note on screen. See welcome.ts and settling.ts.
    if (isUntouchedWelcome(note.path, doc)) continue

    return true
  }

  return false
}

/** Removes every space on this machine. Only ever called with an explicit
 *  yes, since nothing here can be undone. */
export async function eraseLocalSpaces(ws: HoldsSpaces) {
  for (const space of [...ws.spaces]) {
    await invoke('delete_space', { path: space.root }).catch(() => undefined)
  }

  for (const tab of [...ws.tabs]) ws.close(tab.id)

  ws.tree = null
  // `loadSpaces` settles which space is open from what the folder still
  // holds: none, once they have all gone, or one another window made
  // meanwhile. It does not need to be cleared here first.
  await loadSpaces(ws)
  if (ws.activeSpaceId) await ws.loadTree()

  // What the account holds lands in the tree, so the tree is brought up to
  // show it arriving. A blank page with no sign of anything on its way
  // reads as the notes being gone for good.
  ws.panel = 'tree'
  ws.persist()
}

/** Deletes the space's folder. The app owns that folder, so dropping it from
 *  the list alone would only bring it back on the next launch. */
/** `keep` puts the folder in this device's trash instead of deleting it, for
 *  a space that is in nobody's Recently deleted to be put back from - which
 *  is what a space somebody stopped sharing is. */
export async function deleteSpace(ws: HoldsSpaces, id: string, keep = false) {
  const space = ws.spaces.find((entry) => entry.id === id)
  if (!space) return

  {
    // The account keeps a deleted space for 14 days; signed out, this device
    // keeps it in its trash folder instead (see trash.svelte.ts).
    const gone = await (
      account.signedIn && !keep
        ? invoke('delete_space', { path: space.root })
        : invoke('trash_item', { path: space.root, kind: 'space' })
    )
      .then(() => true)
      .catch(() => false)

    if (!gone) return
  }

  for (const tab of ws.tabs.filter((tab) => tab.path?.startsWith(space.root))) {
    ws.close(tab.id)
  }

  ws.folderIcons.forget(space.root)
  ws.graphSettings.forget(space.root)
  ws.excluded.forget(space.root)
  ws.archivedFolders.forget(space.root)
  ws.spaces = ws.spaces.filter((entry) => entry.id !== id)
  if (ws.activeSpaceId !== id) {
    ws.persist()
    return
  }

  ws.activeSpaceId = ws.spaces[0]?.id ?? null
  ws.tree = null
  if (ws.activeSpaceId) await selectSpace(ws, ws.activeSpaceId)
  else ws.persist()
}
