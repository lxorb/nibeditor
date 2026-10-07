/** Which folder was which space under v1, for a sync store that has paired none yet.
 *
 *  A store starts empty on a device's first v2 launch and on the first launch after
 *  signing in again, and the pairing it then works out from names alone (space-plan.ts)
 *  never pairs a folder with somebody else's space: that guess is only safe about a
 *  space this account made. So the folder of a space shared with this account, which v1
 *  had paired for months, was met as a folder the account had never heard of - uploaded
 *  as a new space of this account's own, every note in it copied - and the shared space
 *  was given a second folder beside it. v1's mirrors already say which space each folder
 *  is; those pairs are taken as they are, where the folder and the space are both still
 *  there and the store has not paired either. */

import { readMirror } from '../sync/mirror'
import { isRecord } from '../stored'

export interface V1Pair {
  root: string
  spaceId: string
  /** What the account lets this account do in the space now. */
  role: string
}

export function pairsFromV1(
  saved: unknown,
  accountId: string,
  local: readonly string[],
  remote: readonly { id: string; role: string }[],
  paired: readonly { root: string; spaceId: string }[],
): V1Pair[] {
  if (!isRecord(saved)) return []
  if (typeof saved.account === 'string' && saved.account !== accountId) return []
  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  const roots = new Set(paired.map((one) => one.root))
  const spaces = new Set(paired.map((one) => one.spaceId))
  const out: V1Pair[] = []
  for (const [root, one] of Object.entries(held)) {
    const mirror = readMirror(root, one)
    const space = mirror && remote.find((candidate) => candidate.id === mirror.spaceId)
    if (!mirror || !space || !local.includes(root)) continue
    if (roots.has(root) || spaces.has(mirror.spaceId)) continue
    roots.add(root)
    spaces.add(mirror.spaceId)
    out.push({ root, spaceId: mirror.spaceId, role: space.role })
  }
  return out
}
