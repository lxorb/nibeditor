/** Zen's spaces written into nib's: each into the space of its name, made where
 *  there is none, and an import that has been done before bringing only what is new.
 *
 *  A space of the same name is the same space. Somebody who imports their Zen,
 *  keeps browsing there for a week and imports again wants this week's tabs beside
 *  last week's, not a second `Work` beside the first: so a web note already in the
 *  space at the same place, pointing at the same page (where it is now, or where it
 *  was pinned), is not written again. A space made by this import also takes Zen's
 *  order, icon and colour; one that already existed keeps the order and the icon
 *  somebody gave it.
 *
 *  Each space is written the way every import is (import/apply.ts), so each is one
 *  thing to undo and the file list, the link index and sync all hear of it. See
 *  zen-plan.ts for what becomes what. */

import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { relativeTo } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { readShortcut } from '../web-tab/shortcut'
import { type Space, workspace } from '../workspace.svelte'
import { applyImport } from './apply'
import { nameKey } from './names'
import type { Planned } from './plan'
import { worthKnowing } from './plan'
import { zenProfiles, zenSession, type ZenProfile } from './zen-profiles'
import { zenImport, type ZenSpacePlan } from './zen-plan'

export { zenProfiles, type ZenProfile }

/** The profile's spaces, written. Answers the first of them, to land in. */
export async function landZen(profile: ZenProfile): Promise<Space> {
  const { spaces, lost } = zenImport(await zenSession(profile), new Date())

  // One after the other: each is the open space while it is written.
  const landed: Space[] = []
  for (const plan of spaces) landed.push(await landSpace(plan))
  const [first] = landed
  if (!first) throw new Error(t('Zen’s tabs could not be read.'))

  if (lost.length) busy.failed(lost.map(worthKnowing).join(' '))
  return first
}

async function landSpace(plan: ZenSpacePlan): Promise<Space> {
  const held = workspace.spaces.find((one) => nameKey(one.name.trim()) === nameKey(plan.name))
  const space = held ?? (await workspace.addSpace(plan.name))
  if (!space) throw new Error(t('That import could not be written.'))
  // What follows is the open space's: the file list, its order, its bookmarks.
  if (workspace.activeSpaceId !== space.id) await workspace.selectSpace(space.id)

  const root = space.root
  const files = held ? await unseen(root, plan.files) : plan.files
  const landed = files.length ? await applyImport({ files }, { root, folder: '' }) : { paths: [] }
  // Where each file went, which is where it was planned unless a name was taken.
  const went = new Map(
    files.map((file, at) => {
      const path = landed.paths[at]
      return [file.path, path ? relativeTo(root, path) : file.path]
    }),
  )

  const at = (folder: string) => (folder ? joinPath(root, folder) : root)
  if (!held) {
    for (const [folder, names] of Object.entries(plan.order)) {
      const inside = (name: string) => (folder ? `${folder}/${name}` : name)
      const named = names.map((name) => went.get(inside(name))?.split('/').pop() ?? name)
      workspace.arranged.set(at(folder), named)
    }
    workspace.setSort('manual')
    if (plan.icon) workspace.setIcon(space.id, plan.icon, plan.tint)
  }

  for (const [folder, icon] of Object.entries(plan.folderIcons)) {
    if (!workspace.folderIcons.iconOf(at(folder))) workspace.setFolderIcon(at(folder), icon)
  }

  const marks = plan.bookmarks
    .map((path) => ({ kind: 'note' as const, path: went.get(path) ?? path, text: '' }))
    .filter((mark) => !workspace.bookmarks.has(mark))
  if (marks.length) workspace.bookmarks.toggleAll(marks)

  return space
}

/** The files the space does not already hold: a web note at the same place pointing
 *  at the same page, or an empty note where one already is, is left as it is. A file
 *  there that is something else stays too, and the import's steps aside from it. */
async function unseen(root: string, files: readonly Planned[]): Promise<Planned[]> {
  const there = await Promise.all(
    files.map((file) =>
      invoke<string>('read_note', { path: joinPath(root, file.path) }).catch(() => null),
    ),
  )

  return files.filter((file, at) => {
    const held = there[at]
    if (held === null || held === undefined || file.kind !== 'note') return true
    if (!file.text) return false

    const theirs = readShortcut(held)
    const mine = readShortcut(file.text)
    if (!theirs || !mine) return true
    const pages = new Set([theirs.url, theirs.home].filter(Boolean))
    return !pages.has(mine.url) && !(mine.home && pages.has(mine.home))
  })
}
