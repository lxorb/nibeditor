/** The tree operations a device has not sent yet, made as few as they can be. See
 *  docs/sync-v2.md section 5.13. */

import type { Op } from './wire'

export function coalesce(_ops: readonly Op[]): Op[] {
  throw new Error('not yet')
}
