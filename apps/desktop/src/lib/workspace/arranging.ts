/** What the account holds about the order somebody arranged, and how the two copies
 *  are reconciled.
 *
 *  Fetched rather than imported. The store next door is what the file list reads
 *  before it draws a row; this is what happens once there is an account to talk to,
 *  which is a pass minutes away at the earliest and never at all for a window that is
 *  signed out. So it arrives through a seam in `adopt`, the way lib/ai/ask.ts holds one
 *  in front of answering.ts, and the first paint pays for none of it.
 *
 *  The store is named by type only, so saying which store this belongs to costs
 *  nothing either; the three methods it reaches are public for this file alone. */

import { arrangedMap, type Arranged } from './arranged.svelte'

/** Two maps of lists as one. */
function same(one: Record<string, string[]>, other: Record<string, string[]>): boolean {
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(other).length) return false

  return keys.every((key) => {
    const mine = one[key] ?? []
    const theirs = other[key] ?? []
    return mine.length === theirs.length && mine.every((name, at) => name === theirs[at])
  })
}

/** Takes over what the account holds for one space: this machine's own orders folded
 *  in the first time an account sees the space, and the account's map outright on
 *  every pass after that.
 *
 *  Folded by folder rather than by name: two machines that arranged two different
 *  folders both keep their work, and a folder both of them arranged is this machine's,
 *  because this machine is the one somebody is sitting at. Exactly what
 *  `folderIcons.adopt` does, and for the same reason. */
export async function fold(
  store: Arranged,
  root: string,
  theirs: unknown,
  accountId: string,
): Promise<void> {
  // Read rather than trusted: the service is deployed on its own, so a build of it
  // older than this app answers with no arranged orders at all.
  const account = arrangedMap(theirs)
  const held = store.kept(root)
  const first = held.account !== accountId
  // First contact, or a push that never landed. Either way what is here has not been
  // said yet, so it is folded in and sent rather than replaced.
  const ours = first || !held.sent
  const folders = ours ? { ...account, ...held.folders } : account

  if (!ours && same(held.folders, folders)) return

  store.took(root, folders, accountId)
  if (ours && !same(folders, account)) await send(store, root)
}

/** The space's map as it now stands, sent up so every other machine draws the rows in
 *  the same order. See pushing.ts. */
export async function send(store: Arranged, root: string): Promise<void> {
  const { push } = await import('./pushing')
  await push(
    root,
    (api, token, spaceId) => api.saveArranged(token, spaceId, store.of(root)),
    (landed) => store.said(root, landed),
  )
}
