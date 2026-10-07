/** Every mirror `nib:mirrors` holds for an account, as written down: in the wrapper a
 *  newer version writes or bare as an older one did, and none of another account's.
 *  The reading sync.svelte.ts gives them at launch, for what reads them later and
 *  should not cost the launch a byte: the Sync pane's count of other tools' copies
 *  (foreign/synced.ts), and v2's first pass, which reads the same rows its own way. */

import { isRecord } from '../stored'
import { type Mirror, readMirror } from './mirror'

export function savedMirrors(saved: unknown, accountId: string | null): Mirror[] {
  if (!isRecord(saved)) return []
  if (typeof saved.account === 'string' && saved.account !== accountId) return []
  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  return Object.entries(held).flatMap(([root, one]) => readMirror(root, one) ?? [])
}
