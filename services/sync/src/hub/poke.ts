import type { Env } from '../types'

/** Tells every device that can reach a space that its cursor moved to `seq`, so
 *  each runs a pass for it at once instead of waiting for the next poll. `from`
 *  is the device whose write it was, which already knows.
 *
 *  Called after any write that moves a space's cursor, and never awaited by the
 *  write: a poke is a courtesy and polling is the fallback, so one that fails
 *  must not fail what it is about. A stand-in until the hub exists; see
 *  docs/sync-v2.md section 5.12. */
export function pokeSpace(
  _env: Env,
  _context: Pick<ExecutionContext, 'waitUntil'>,
  _spaceId: string,
  _seq: number,
  _from?: string,
): Promise<void> {
  return Promise.resolve()
}
