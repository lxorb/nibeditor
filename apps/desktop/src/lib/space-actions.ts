import { iconChoice } from './icon-choice.svelte'
import { key, t } from './i18n.svelte'
import { DIVIDER, menu, type MenuEntry, trim } from './menu.svelte'
import { prompt } from './prompt.svelte'
import { canPublish, canShare, roleOf, share } from './sharing.svelte'
import { isDesktop } from './tauri'
import type { WebData } from './web-tab/web-data'
import { type Space, workspace } from './workspace.svelte'

/** Asks for a name and makes the space. Where it lives is the app's business,
 *  so that is the only question. Answers the space, or nothing where the question
 *  was dismissed; the space chooser goes on to put a first note in it. */
export async function newSpace(): Promise<Space | undefined> {
  const name = await prompt.ask({
    title: t('Name the space'),
    placeholder: t('Journal'),
    confirmLabel: key('Create'),
  })

  if (!name) return
  const space = await workspace.addSpace(name)

  // Until a pass has put it on the account there is nothing to share or to
  // publish, and a quiet loop can be a minute from its next one. Somebody who
  // has just made a space should not have to wait that out to share it.
  const { sync } = await import('./sync.svelte')
  sync.nudge()
  return space
}

/** The space before or after this one, from anywhere in the app.
 *
 *  The ends meet, because one key has to be able to walk round: a chord that
 *  stops on the last space and does nothing is a chord that reads as broken. In
 *  the order the spaces are in, which is the order the reader put them in.
 *
 *  One space is not a ring, and the key does nothing at all. */
export function stepSpace(direction: number) {
  const spaces = workspace.spaces
  if (spaces.length < 2) return

  const at = spaces.findIndex((one) => one.id === workspace.activeSpaceId)
  const next = spaces[(at < 0 ? 0 : at + direction + spaces.length) % spaces.length]
  if (next && next.id !== workspace.activeSpaceId) void workspace.showSpace(next.id)
}

/** Moves a space in the switcher and tells the account about it, so the order is
 *  the same on the next machine. Lives here rather than on the workspace,
 *  which knows nothing about syncing. */
async function moveSpace(id: string, beforeId: string | null) {
  if (!workspace.moveSpace(id, beforeId)) return

  const { sync } = await import('./sync.svelte')
  void sync.pushSpaceOrder()
}

/** Whether a space has anywhere to go in that direction.
 *
 *  Only a space of the reader's own. The order is a column of the account's own
 *  space rows and the push writes it as one - `update spaces ... where user_id`
 *  in services/sync/src/spaces/index.ts - and a space somebody else shared is
 *  not a row there. Offering the move on one would be a row that appears to
 *  work and is back where it was on the next launch. */
function canNudge(space: Space, by: -1 | 1): boolean {
  if (roleOf(space.root) !== 'owner') return false

  const at = workspace.spaces.findIndex((one) => one.id === space.id)
  const to = at + by
  return at >= 0 && to >= 0 && to < workspace.spaces.length
}

/** One place up or down the list.
 *
 *  Steps rather than a drag. The column of squares this order used to be read in
 *  is gone, and the switcher is a menu that opens over the panel: a drag inside
 *  something that closes when the pointer leaves it is a gesture that fights
 *  itself. A step is exact, it is the same on a phone as on a desktop, it works
 *  for somebody who has asked for less movement, and it needs no second
 *  implementation of dragging.
 *
 *  `moveSpace` places a space in front of another, so going down means going in
 *  front of the one after next. */
async function nudgeSpace(space: Space, by: -1 | 1) {
  const at = workspace.spaces.findIndex((one) => one.id === space.id)
  if (at < 0) return

  const to = at + by
  if (to < 0 || to >= workspace.spaces.length) return

  const before = by === -1 ? workspace.spaces[to] : workspace.spaces[to + 1]
  await moveSpace(space.id, before?.id ?? null)
}

/** What a space itself offers, wherever it is asked: from the switcher's own
 *  button on the row, from a right click on it, or from a held finger.
 *
 *  What a space *is* rather than what to put in it - the file list's own menu
 *  makes notes, and it is where somebody looking for a new note already is. The
 *  folder behind the space is not what this is about either. */
export function spaceMenu(space: Space): MenuEntry[] {
  // A space somebody shared to read is theirs; the only thing this menu can
  // offer about it is a way out of it.
  const theirs = roleOf(space.root) !== 'owner'

  return trim([
    ...(theirs ? [] : [{ label: t('Rename'), run: () => void renameSpace(space) }]),
    { label: t('Choose an icon'), run: () => iconChoice.space(space.id) },
    ...(canShare(space) ? [{ label: t('Share'), run: () => void shareSpace(space) }] : []),
    // Beside it, because it is the same question about the same folder: who
    // else may read this.
    ...(canPublish(space) ? [{ label: t('Publish'), run: () => publishSpace(space) }] : []),
    // Where the space keeps what websites store. Only where a website is a tab with a
    // store of its own behind it; in a browser build the page is the browser's.
    ...(isDesktop
      ? [{ label: t('Web data'), keep: true, run: () => void showWebData(space) }]
      : []),
    DIVIDER,
    // Where a space sits in the list. Left out at the ends rather than offered
    // as a row that does nothing.
    ...(canNudge(space, -1)
      ? [{ label: t('Move up'), run: () => void nudgeSpace(space, -1) }]
      : []),
    ...(canNudge(space, 1)
      ? [{ label: t('Move down'), run: () => void nudgeSpace(space, 1) }]
      : []),
    DIVIDER,
    {
      label: theirs ? t('Leave space') : t('Delete space'),
      danger: true,
      run: () => void deleteSpace(space),
    },
  ])
}

/** The three places a space may keep its web data, in the menu that asked, with the
 *  one in force ticked. The same menu rather than a sheet of its own: one word opened
 *  it, and three are the whole of the answer. Fetched with the press rather than
 *  carried, because the space's menu is in front of the first paint and this is not.
 *  See web-tab/web-data.ts. */
async function showWebData(space: Space) {
  const [{ WEB_DATA }, { webData }] = await Promise.all([
    import('./web-tab/web-data'),
    import('./web-tab/web-data.svelte'),
  ])
  const said: Record<WebData, string> = {
    global: t('Global'),
    space: t('Space'),
    site: t('Site'),
  }

  menu.replace(
    WEB_DATA.map((choice) => ({
      label: said[choice],
      checked: webData.of(space.id) === choice,
      run: () => void chooseWebData(space, choice),
    })),
  )
}

/** Keeps the space's web data where it was asked to, and builds its open pages again
 *  in that store, so the choice is on screen at once. Nothing is thrown away: the
 *  store it leaves stays on disk, with its logins in it, for the day it is chosen
 *  again. */
async function chooseWebData(space: Space, choice: WebData) {
  const { webData } = await import('./web-tab/web-data.svelte')
  if (webData.of(space.id) === choice) return

  webData.set(space.id, choice)
  const { pages } = await import('./web-tab/pages.svelte')
  await pages.restore(space.id)
}

/** Renaming a space happens where its name is written: the header over the file
 *  list, in the field a row in that list renames in. Asked for from the switcher,
 *  the space is brought up first, because the name a header shows is the space that
 *  is open and renaming one out of sight would be a field with nothing in front of
 *  it. See NameField.svelte and Sidebar.svelte. */
async function renameSpace(space: Space) {
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  workspace.startRenaming(space.root)
}

/** And what the name that was typed does. Here rather than on the workspace, which
 *  knows nothing about syncing. */
export async function commitSpaceName(space: Space, name: string) {
  const from = space.root
  await workspace.renameSpace(space.id, name)

  // The folder has a new path now, and the mirror is keyed by the old one.
  // Left alone, the next pass would read this as a space the account has never
  // seen and upload a second copy of it.
  const { sync } = await import('./sync.svelte')
  await sync.renamed(from, space.root, space.name)
}

/** Who else may reach a space, and at what. The one sheet; see ShareSheet.svelte. */
export async function shareSpace(space: Space) {
  await share.show(space)
}

/** Putting a space on the web, which is the other half of who may read it and
 *  is asked in the sheet beside it; see PublishSheet.svelte.
 *
 *  The store arrives with the sheet, which is fetched rather than carried: nothing
 *  about publishing is in the app until a space's own menu asks for it. `show` puts
 *  the sheet on the page itself; see surfaces.svelte.ts. */
export async function publishSpace(space: Space) {
  const { publish } = await import('./publishing.svelte')
  publish.show(space)
}

/** Deleting a space, or letting go of one somebody shared, which is the same
 *  gesture and a different sentence: a space that is not yours is not yours to
 *  delete, and leaving it takes its notes off this machine and nowhere else. */
async function deleteSpace(space: Space) {
  const theirs = roleOf(space.root) !== 'owner'

  const sure = await prompt.confirm({
    title: theirs
      ? t('Leave {name}?', { name: space.name })
      : t('Delete {name}?', { name: space.name }),
    detail: theirs
      ? t('It stays with everybody else. Its notes go from your computer.')
      : t('Every note in this space is deleted from your computer.'),
    confirmLabel: theirs ? key('Leave') : key('Delete'),
    danger: true,
  })

  if (!sure) return

  const root = space.root
  await workspace.deleteSpace(space.id)

  // Deleted here means deleted from the account. Anything less and the next
  // pass downloads it straight back, here and on every other machine.
  const { sync } = await import('./sync.svelte')
  await sync.forget(root)
}
