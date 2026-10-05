/** The shapes and rules of `@nib/online` (docs/online-terminal.md, 6.1), as this lane
 *  builds against them until online-core's package is on main.
 *
 *  Spelled exactly as section 6.1 and online-core's draft spell them, so that moving to
 *  the package is changing the imports and deleting this file. Nothing here is the
 *  Worker's own: the Worker's decisions are in the files beside it. */

import { frame, unframe } from '@nib/sync-core/wire'

export type MachineState = 'asleep' | 'starting' | 'awake' | 'stopping'
export type Typing = 'owner' | 'writers'
export type SpaceRole = 'read' | 'write' | 'owner'

export interface Activity {
  at: number
  output: number
  cpu: number
  net: number
  homeBytes: number
}

export interface Watcher {
  who: string
  device: string
  active: boolean
  onScreen: boolean
}

export interface Allowance {
  awakeS: number
  cpuS: number
  homeBytes: number
  egressBytes: number
}

export type SleepReason = 'idle' | 'allowance' | 'budget' | 'off'
export type AwakeAnswer = { stay: true } | { stay: false; reason: SleepReason }

export interface Typed {
  who: string
  at: number
  cols: number
  rows: number
}

export interface MachineHost {
  start(id: string, image: string, env: Record<string, string>): Promise<void>
  stop(id: string, grace: number): Promise<void>
  link(id: string): Promise<WebSocket>
  snapshot(id: string): Promise<string>
  backup(id: string, dir: string): Promise<string>
  restore(id: string, from: { snapshot?: string; backup?: string }): Promise<void>
  usage(id: string, since: number): Promise<{ cpuS: number; egressBytes: number }>
}

/* ── The rules ────────────────────────────────────────────────────────── */

/** How long anything in or at a machine keeps it awake after it happened (4.4). */
const IDLE_AFTER = 15 * 60 * 1000
/** CPU above this share of the machine counts as working. */
const BUSY_CPU = 0.05
/** Network above this many bytes a minute counts as working; `nibd` reports every 30 s. */
const BUSY_NET_A_MINUTE = 50 * 1024
const REPORT_EVERY = 30 * 1000

/** Whether something in the machine was working in this report. */
function working(one: Activity): boolean {
  return (
    one.output > 0 || one.cpu > BUSY_CPU || one.net > (BUSY_NET_A_MINUTE * REPORT_EVERY) / 60_000
  )
}

/** The one rule of 4.4: whether the machine stays awake, and why not if not. */
export function awake(
  now: number,
  watchers: readonly Watcher[],
  recent: readonly Activity[],
  keepAwake: boolean,
  used: Allowance,
  limit: Allowance,
  budgetLeft: number,
): AwakeAnswer {
  if (budgetLeft <= 0) return { stay: false, reason: 'budget' }
  if (used.awakeS >= limit.awakeS || used.cpuS >= limit.cpuS) {
    return { stay: false, reason: 'allowance' }
  }
  if (used.egressBytes >= limit.egressBytes) return { stay: false, reason: 'allowance' }
  if (keepAwake) return { stay: true }
  if (watchers.some((one) => one.active && one.onScreen)) return { stay: true }
  if (recent.some((one) => now - one.at <= IDLE_AFTER && working(one))) return { stay: true }
  return { stay: false, reason: 'idle' }
}

/** The pty's size: whoever typed last (tmux's `latest`), or nothing before anybody did. */
export function sizeOf(typed: readonly Typed[]): { cols: number; rows: number } | null {
  let last: Typed | null = null
  for (const one of typed) if (!last || one.at >= last.at) last = one
  return last ? { cols: last.cols, rows: last.rows } : null
}

/** Whether a socket may type (4.6): the machine's owner always; a link guest never;
 *  otherwise a writer or the space's owner when `typing` is `writers`. */
export function mayType(
  role: SpaceRole | null,
  guest: boolean,
  ownsMachine: boolean,
  typing: Typing,
): boolean {
  if (ownsMachine && !guest) return true
  if (guest || role === null || role === 'read') return false
  return typing === 'writers'
}

/* ── The wire ─────────────────────────────────────────────────────────── */

export const MOST_SOCKETS = 25
export const MOST_SESSIONS = 8
export const INPUT_RATE = 100
export const MOST_INPUT = 64 * 1024

export type Refusal =
  | 'gone'
  | 'role'
  | 'list'
  | 'allowance'
  | 'budget'
  | 'off'
  | 'flag'
  | 'sessions'
  | 'rate'
  | 'large'

export type DownReason = SleepReason | 'flag' | 'stopped' | 'restart'

export interface Restored {
  at: number
  program: string | null
}

export interface Person {
  who: string
  device: string
  typing: boolean
}

export type ClientFrame =
  | { t: 'hello'; since?: number; cols: number; rows: number }
  | { t: 'in'; data: string }
  | { t: 'size'; cols: number; rows: number }
  | { t: 'start' }
  | { t: 'resume' }

export type ServerFrame =
  | { t: 'screen'; seq: number; cols: number; rows: number; data: string; restored?: Restored }
  | { t: 'size'; cols: number; rows: number; by: string | null }
  | { t: 'people'; people: Person[] }
  | { t: 'typed'; who: string; seq: number }
  | { t: 'program'; name: string | null; title: string | null; mark: string | null }
  | { t: 'machine'; state: MachineState; reason?: DownReason }
  | { t: 'role'; type: boolean }
  | { t: 'ended'; code: number | null }
  | { t: 'refused'; error: Refusal }

export function text(value: ClientFrame | ServerFrame): string {
  return JSON.stringify(value)
}

export function outFrame(seq: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length)
  new DataView(out.buffer).setFloat64(0, seq)
  out.set(data, 8)
  return out
}

export type MachineFrame =
  | { t: 'open'; session: string; cols: number; rows: number }
  | { t: 'in'; session: string; data: Uint8Array }
  | { t: 'size'; session: string; cols: number; rows: number }
  | { t: 'want'; session: string; since: number }
  | { t: 'close'; session: string }
  | { t: 'sleep' }

export type NibdFrame =
  | { t: 'out'; session: string; seq: number; data: Uint8Array }
  | {
      t: 'screen'
      session: string
      seq: number
      cols: number
      rows: number
      data: string
      restored?: Restored
    }
  | { t: 'program'; session: string; name: string | null; title: string | null; mark: string | null }
  | { t: 'ended'; session: string; code: number | null }
  | { t: 'activity'; activity: Activity }
  | { t: 'saved' }

export function linkFrame(value: MachineFrame | NibdFrame): Uint8Array {
  return frame(value)
}

type Fields = Record<string, unknown>
const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isCells = (value: unknown): value is number => isCount(value) && value >= 1 && value <= 1000
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200
const isShort = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length <= 1024)

export function clientFrameOf(raw: string): ClientFrame | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Not JSON, so not a frame.
    return null
  }
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello': {
      const { since, cols, rows } = value
      if (!isCells(cols) || !isCells(rows)) return null
      if (since === undefined) return { t: 'hello', cols, rows }
      return isCount(since) ? { t: 'hello', since, cols, rows } : null
    }
    case 'in':
      return typeof value.data === 'string' && value.data.length <= MOST_INPUT
        ? { t: 'in', data: value.data }
        : null
    case 'size':
      return isCells(value.cols) && isCells(value.rows)
        ? { t: 'size', cols: value.cols, rows: value.rows }
        : null
    case 'start':
    case 'resume':
      return { t: value.t }
    default:
      return null
  }
}

export function nibdFrameOf(bytes: Uint8Array): NibdFrame | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  if (value.t === 'saved') return { t: 'saved' }
  if (value.t === 'activity') {
    const one = value.activity
    if (!isRecord(one)) return null
    const { at, output, cpu, net, homeBytes } = one
    if (typeof at !== 'number' || !isCount(output) || !isCount(net) || !isCount(homeBytes)) {
      return null
    }
    if (typeof cpu !== 'number' || !Number.isFinite(cpu) || cpu < 0) return null
    return { t: 'activity', activity: { at, output, cpu, net, homeBytes } }
  }

  const { session } = value
  if (!isId(session)) return null
  switch (value.t) {
    case 'out':
      return isCount(value.seq) && value.data instanceof Uint8Array
        ? { t: 'out', session, seq: value.seq, data: value.data }
        : null
    case 'screen': {
      const { seq, cols, rows, data } = value
      if (!isCount(seq) || !isCells(cols) || !isCells(rows) || typeof data !== 'string') {
        return null
      }
      const restored = value.restored
      if (restored === undefined) return { t: 'screen', session, seq, cols, rows, data }
      if (!isRecord(restored) || typeof restored.at !== 'number' || !isShort(restored.program)) {
        return null
      }
      return {
        t: 'screen',
        session,
        seq,
        cols,
        rows,
        data,
        restored: { at: restored.at, program: restored.program },
      }
    }
    case 'program': {
      const { name, title, mark } = value
      if (!isShort(name) || !isShort(title) || !(mark === null || isId(mark))) return null
      return { t: 'program', session, name, title, mark }
    }
    case 'ended':
      return value.code === null || (typeof value.code === 'number' && Number.isSafeInteger(value.code))
        ? { t: 'ended', session, code: value.code }
        : null
    default:
      return null
  }
}
