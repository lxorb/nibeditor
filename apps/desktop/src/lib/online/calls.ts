/** What the app asks the account about its online machine, over HTTP: the machine and the
 *  month's use, the session a `.term` names, and Start and Stop (docs/online-terminal.md
 *  4.5, 4.9 and 4.10; the routes are services/sync/src/machines/routes.ts). The terminal
 *  itself is the socket's; see link.ts.
 *
 *  Read rather than trusted, as every answer from the service is checked into its type
 *  or into null. */

import { type Allowance, type MachineState, type Term, termOf } from '@nib/online'
import { account } from '../account.svelte'
import { ApiError, request } from '../api'
import { isNumber, isRecord, isString } from '../stored'

interface MachineInfo {
  id: string
  state: MachineState
  /** Stopped by a flag, until it is let go (4.8). */
  held: boolean
}

/** Everything Settings and the tab ask about: whether the account may have a machine at
 *  all, the machine if there is one yet, this month's use, its ceiling and when it starts
 *  again. */
export interface Online {
  allowed: boolean
  machine: MachineInfo | null
  used: Allowance
  limit: Allowance
  /** When the month's allowance starts again, in ms. */
  resets: number
}

/** Why the account would not do it, in the words the service refuses with. */
export type Refused =
  'signed-out' | 'list' | 'allowance' | 'budget' | 'off' | 'flag' | 'sessions' | 'other'

const STATES: readonly MachineState[] = ['asleep', 'starting', 'awake', 'stopping']

function allowanceOf(value: unknown): Allowance | null {
  if (!isRecord(value)) return null
  const { awakeS, cpuS, homeBytes, egressBytes } = value
  if (!isNumber(awakeS) || !isNumber(cpuS) || !isNumber(homeBytes) || !isNumber(egressBytes))
    return null
  return { awakeS, cpuS, homeBytes, egressBytes }
}

function machineOf(value: unknown): MachineInfo | null {
  if (!isRecord(value) || !isString(value.id)) return null
  const state = STATES.find((one) => one === value.state)
  return state ? { id: value.id, state, held: value.held === true } : null
}

/** The account's answer to `GET /v2/online/machine`, or null for one that does not read. */
export function onlineOf(value: unknown): Online | null {
  if (!isRecord(value)) return null
  const used = allowanceOf(value.used)
  const limit = allowanceOf(value.limit)
  if (!used || !limit || !isNumber(value.resetAt)) return null
  return {
    allowed: value.allowed === true,
    machine: machineOf(value.machine),
    used,
    limit,
    resets: value.resetAt,
  }
}

const REFUSALS: readonly Refused[] = ['list', 'allowance', 'budget', 'off', 'flag', 'sessions']

/** A refusal as one of ours. */
export function refusedOf(error: unknown): Refused {
  if (!(error instanceof ApiError)) return 'other'
  if (error.status === 401) return 'signed-out'
  // Every route answers 404 while the service is off.
  if (error.status === 404) return 'off'
  const said = isRecord(error.body) && isString(error.body.error) ? error.body.error : ''
  return REFUSALS.find((one) => one === said) ?? 'other'
}

function token(): string {
  const now = account.accountToken
  if (!now) throw new ApiError(401, 'signed out')
  return now
}

/** The machine and the month. */
export async function online(): Promise<Online | null> {
  return onlineOf(await request<unknown>('/v2/online/machine', { token: token() }))
}

/** The session a `.term` names, by the file's id on the account: made on the asker's own
 *  machine the first time - and the machine with it, if there is none yet - and the same
 *  one every time after. A file the account has not been sent yet answers 404. */
export async function termSession(term: string): Promise<Term> {
  const said = await request<unknown>('/v2/online/terms', {
    method: 'POST',
    token: token(),
    body: { term },
  })
  const found = termOf(JSON.stringify(said))
  if (!found) throw new ApiError(500, 'no session')
  return found
}

/** Start or Stop. */
export async function startStop(start: boolean): Promise<void> {
  await request<unknown>(`/v2/online/machine/${start ? 'start' : 'stop'}`, {
    method: 'POST',
    token: token(),
  })
}
