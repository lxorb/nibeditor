/** The machine's audit (docs/online-terminal.md, 4.8): who connected and when, what
 *  the machine did, and never a keystroke or a screen.
 *
 *  `detail` takes only what `Detail` allows - a word from a short list, a role, a
 *  number - so no caller can hand it input by mistake: there is no string parameter
 *  that free text could travel through. Kept 90 days, then swept by the nightly job. */

import type { Env } from '../types'

export type EventKind =
  | 'made'
  | 'start'
  | 'wake'
  | 'sleep'
  | 'stop'
  | 'snapshot'
  | 'backup'
  | 'restore'
  | 'open'
  | 'close'
  | 'typing'
  | 'resume'
  | 'session'
  | 'ended'
  | 'flag'
  | 'release'
  | 'hour'
  | 'failed'

/** What an event may say about itself. */
export type Detail =
  | 'idle'
  | 'allowance'
  | 'budget'
  | 'off'
  | 'flag'
  | 'stopped'
  | 'restart'
  | 'account'
  | 'snapshot'
  | 'backup'
  | 'fresh'
  | 'read'
  | 'write'
  | 'owner'
  | 'writers'
  | 'guest'
  | number
  | null

/** How long the audit is kept. */
const KEPT = 90 * 24 * 60 * 60 * 1000

export async function audit(
  env: Env,
  machine: string,
  kind: EventKind,
  who: { who?: string | null; device?: string | null; detail?: Detail } = {},
  at = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    'insert into machine_events (machine, at, kind, who, device, detail) values (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      machine,
      at,
      kind,
      who.who ?? null,
      who.device ?? null,
      who.detail === undefined || who.detail === null ? null : String(who.detail),
    )
    .run()
}

/** The audit past its 90 days, gone; one statement for the nightly job. */
export async function sweepAudit(env: Env, at: number): Promise<void> {
  await env.DB.prepare('delete from machine_events where at < ?')
    .bind(at - KEPT)
    .run()
}
