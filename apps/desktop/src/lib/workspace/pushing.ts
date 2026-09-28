/** A space's own copy of something a store keeps - its folder icons, its arranged
 *  order, its graph, what it leaves out - sent up so every other machine has it too.
 *
 *  Sent from the store rather than from the syncing loop, because each of these is
 *  written by a gesture and a pass is minutes away. Fetched by the store that sends
 *  rather than imported: the loop reads the workspace those stores belong to, and the
 *  two would import each other. */

import { account } from '../account.svelte'
import { api } from '../api'
import { sync } from '../sync.svelte'

type Save = (calls: typeof api, token: string, spaceId: string) => Promise<unknown>

/** Sends it, and tells `heard` whether the account now has it.
 *
 *  Signed out, in a space no account has a copy of, or in one shared to read, it stays
 *  on this machine: the first two because there is nowhere to send it yet, and the last
 *  because the account would refuse it anyway. That is heard as said, because it will
 *  never be anything else - a store that remembers what went unsaid folds it over the
 *  account's copy on the next pass, and a space this machine may only read must not
 *  spend for ever refusing to take the owner's. A sign-in later is first contact and
 *  folds anyway.
 *
 *  Heard before the account's list of spaces is read again, so a pass that the new
 *  list sets off already knows. */
export async function push(
  root: string,
  save: Save,
  heard: (landed: boolean) => void = () => undefined,
): Promise<void> {
  const token = account.token
  const spaceId = sync.remoteIdFor(root)
  const role = spaceId ? account.spaces.find((one) => one.id === spaceId)?.role : undefined

  if (!token || !spaceId || role === 'read') {
    heard(true)
    return
  }

  const landed = await save(api, token, spaceId)
    .then(() => true)
    .catch(() => false)

  heard(landed)
  if (landed) await account.loadSpaces().catch(() => undefined)
}
