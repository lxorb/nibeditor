/** The machine's audit (docs/online-terminal.md, 4.8): who connected and when, what
 *  the machine did, and never a keystroke or a screen.
 *
 *  `detail` takes only what `Detail` allows - a word from a short list, a role, a
 *  number, or a `Failure` that `failureOf` made of an error the host threw - so no
 *  caller can hand it input by mistake: there is no string parameter that free text
 *  could travel through. Kept 90 days, then swept by the nightly job. */

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
  /** The link to `nibd` went quiet or closed under an awake machine and was made again. */
  | 'relink'
  /** `nibd` asked to restart: by its owner, or after going quiet again (4.14, 4.15). */
  | 'restart'
  /** An always-on machine power-cycled through its host's API (4.15). */
  | 'reboot'
  /** The machine moved to another host (4.15). */
  | 'host'

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
  | 'running'
  | 'silent'
  | 'cloudflare'
  | 'hetzner'
  | Failure
  | number
  | null

/** Why a call to the host failed, as the audit keeps it: which step, the error's name,
 *  its code where it has one, and the start of what it said - the one thing that tells a
 *  backup the shim gave up on from one R2 refused (2026-10-06: two sleeps' failures were
 *  only ever "backup" and "snapshot"). Errors are the host's and the SDK's, never a
 *  person's input, and a path into the home is cut to `~`, so no file name of theirs
 *  is kept. Made only by `failureOf`. */
export type Failure = string & { readonly failure: unique symbol }

/** The steps a failure is named by. */
export type Step = 'start' | 'link' | 'restore' | 'backup' | 'snapshot' | 'stop'

const SAID_LIMIT = 160

export function failureOf(step: Step, error: unknown): Failure {
  const named = error instanceof Error ? error : null
  const coded = (error as { code?: unknown } | null)?.code
  const code = typeof coded === 'string' ? coded : null
  const said = (named ? named.message : String(error))
    .replace(/\/home\/nib(\/[^\s'"`]*)?/g, '~')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAID_LIMIT)
  return [`${step}:`, named?.name ?? typeof error, code, said].filter(Boolean).join(' ') as Failure
}

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
