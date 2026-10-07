/** Which folder on this machine is which space on the account, worked out again.
 *
 *  Both sync engines ask it, the same way: spaces made or deleted on another device, a
 *  space shared with this account or taken back, a folder made here that the account
 *  has never seen. What should happen is worked out on its own, away from the doing, in
 *  space-plan.ts; this does it. What differs between the engines is only where a pairing
 *  is written down - v1's mirrors, v2's sync store - which is the `Pairing` handed in. */

import { account } from './account.svelte'
import { api } from './api'
import { planSpaces } from './space-plan'
import { workspace } from './workspace.svelte'

/** Where an engine keeps which folder is which space. */
export interface Pairing {
  /** Every folder paired with a space. */
  pairs(): { root: string; spaceId: string; shared: boolean }[]
  pair(root: string, spaceId: string, shared: boolean): void
  unpair(root: string): void
  /** Whether a paired space is somebody else's, kept current: a space that stops being
   *  shared - or starts - changes what happens when it later goes missing from the
   *  listing. */
  share(root: string, shared: boolean): void
}

/** The pairing in the air for each engine's `Pairing`. A second pass asking meanwhile - a
 *  save nudging the loop while the first pass after signing in is still pairing - waits on
 *  it rather than starting its own: two at once both read an account without the new
 *  folder's space, and each made one, so the folder went up twice and came back down as
 *  `Notes 2` with every note in it twice over. */
const inTheAir = new WeakMap<Pairing, Promise<void>>()

/** Pairs every local space with a remote one, makes what is missing on either side, and
 *  takes the account's icons, bookmarks and order. Asked only when the listing is due;
 *  answers whether it was. */
export function pairSpaces(token: string, pairing: Pairing): Promise<void> {
  const running = inTheAir.get(pairing)
  if (running) return running
  const now = pairOnce(token, pairing).finally(() => inTheAir.delete(pairing))
  inTheAir.set(pairing, now)
  return now
}

async function pairOnce(token: string, pairing: Pairing): Promise<void> {
  const plan = planSpaces({
    local: workspace.spaces.map((space) => ({ name: space.name, root: space.root })),
    remote: account.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      shared: space.role !== 'owner',
    })),
    mirrors: pairing.pairs(),
    deleted: account.deletedSpaces,
  })

  // Removals come first. Adopting runs after, and adopting reuses a folder of the same
  // name if it finds one - which would be the very folder about to be deleted. Deleting
  // a space and making a new one of the same name has to settle in a single pass, not
  // leave a gap.
  for (const root of plan.remove) {
    const space = workspace.spaces.find((one) => one.root === root)
    // To this device's trash, never for good. The account's Recently deleted holds only
    // what the account was given, and the folder may hold more: words typed offline, a
    // picture that never travels, and - for a space somebody stopped sharing - the only
    // copy left of what was read here.
    pairing.unpair(root)
    if (space) await workspace.deleteSpace(space.id, true)
  }

  // Missing without a marker: not uploaded yet as far as anyone can tell, so the pairing
  // goes and the next pass sends the folder up again.
  for (const root of [...plan.detach, ...plan.drop]) pairing.unpair(root)

  const shared = (id: string) => account.spaces.find((one) => one.id === id)?.role !== 'owner'

  for (const { root, spaceId } of plan.pair) pairing.pair(root, spaceId, shared(spaceId))

  // A guest has no account for a folder to become a space in. What a link lent them is
  // the whole of what syncing is about for them, and the notes already on this machine
  // are their own: those stay here.
  if (account.user) {
    for (const space of plan.upload) {
      const { space: remote } = await api.createSpace(token, space.name)
      pairing.pair(space.root, remote.id, false)
    }
  }

  const paired = () => pairing.pairs()
  for (const space of plan.adopt) {
    // A folder of its own where a folder of that name is already here and already answers
    // for something - and always, for a space somebody shared, which has no claim on
    // anything on this machine.
    const taken =
      shared(space.id) ||
      workspace.spaces.some(
        (one) => one.name === space.name && paired().some((pair) => pair.root === one.root),
      )

    const root = await workspace.adoptSpace(space.name, taken)
    if (root) pairing.pair(root, space.id, shared(space.id))
  }

  // The icon and the bookmarks belong to the space, so they travel with it. Whatever the
  // account holds wins: it is the one copy every machine can see. The exception is the
  // first time an account meets a space on this machine, where whatever was bookmarked
  // here joins the account's list instead of being replaced by it - and is sent straight
  // back up.
  const accountId = account.user?.id ?? null
  for (const remote of account.spaces) {
    const pair = paired().find((one) => one.spaceId === remote.id)
    if (!pair) continue

    // The colour rides with the icon, and a listing with no word about it at all is a
    // service older than the column: then this machine's colour is the one there is, and
    // it is this machine's to send. Only for a space of this account's - the icon and its
    // colour are the owner's, so somebody else's would be refused.
    const unsaid = workspace.applyIcon(pair.root, remote.icon ?? null, remote.tint)
    if (unsaid && remote.role === 'owner') {
      await api.setSpaceIcon(token, remote.id, remote.icon ?? null, unsaid).catch(() => undefined)
      await account.loadSpaces().catch(() => undefined)
    }

    pairing.share(pair.root, remote.role !== 'owner')

    // Whatever this machine had bookmarked in a space it may only read is its own
    // business: the account would refuse the list, and asking on every pass is a refusal
    // on every pass.
    if (accountId === null || remote.role === 'read') continue
    const merged = workspace.bookmarks.adopt(pair.root, remote.bookmarks, accountId)
    if (merged) await api.saveBookmarks(token, remote.id, merged).catch(() => undefined)
  }

  // The account already lists spaces in the order it holds them, so adopting that order
  // is what makes a second machine look like the first.
  workspace.applySpaceOrder(account.spaces.map((space) => space.name))
}
