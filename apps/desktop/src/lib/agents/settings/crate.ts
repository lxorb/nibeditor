/** What Settings > Agents asks the crate, as one interface (docs/agent-native.md 13.1).
 *
 *  The grants (`agents_read`, `agents_write`, `agents_mint`), the audit log a day at a
 *  time (`agents_log_days`, `agents_log`, `agents_log_clear`), the program a client runs
 *  as `nib mcp` (`mcp_program`), and the crate's news on `nib://agent`. One interface so
 *  the pane is the same pane over the real crate and over `fake.ts`, which the tests
 *  and the drive that photographs it hand it instead.
 *
 *  Everything that arrives is read rather than trusted: an answer from the crate is a
 *  boundary like any other, and a grant the pane misread would be written back wrong. */

import { isRecord } from '../../stored'
import { invoke } from '../../tauri'
import {
  AGENT_EVENT,
  type AgentEvent,
  type Category,
  type Grant,
  type Minted,
  type Scope,
  type SiteRule,
} from '../verbs'

export interface AgentsCrate {
  read(): Promise<Grant[]>
  /** The whole list, as the crate keeps it: a grant left out is removed, token and all. */
  write(grants: Grant[]): Promise<Grant[]>
  mint(name: string): Promise<Minted>
  /** The days the log has, newest first. */
  days(): Promise<string[]>
  /** One day of the log, oldest first, as the crate wrote it. */
  day(day: string): Promise<unknown[]>
  /** One agent's calls out of the log, or every call. */
  clear(agent: string | null): Promise<void>
  /** The path a client runs as `nib mcp`, or null where there is none to say. */
  program(): Promise<string | null>
  /** The crate's news, until the answer is called. */
  hear(on: (event: Heard) => void): Promise<() => void>
}

const known = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  list.find((one) => one === value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

const count = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** As much of the crate's news as the pane acts on: which kind, and whose. */
export interface Heard {
  kind: AgentEvent['kind']
  agent: string | null
}

const KINDS: readonly AgentEvent['kind'][] = [
  'acting',
  'paused',
  'resumed',
  'asked',
  'answered',
  'tab',
  'closed',
  'stopped',
]

/** An event's kind and agent: its own, or its question's. */
function readHeard(value: unknown): Heard | null {
  if (!isRecord(value)) return null
  const kind = known(KINDS, value.kind)
  if (!kind) return null
  const agent = isRecord(value.approval) ? value.approval.agent : value.agent
  return { kind, agent: typeof agent === 'string' ? agent : null }
}

const SCOPES: readonly Scope[] = [
  'context',
  'notes.read',
  'notes.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'browser.script',
  'browser.network',
  'browser.storage',
  'settings',
  'terminal',
]

const CATEGORIES: readonly Category[] = [
  'paying',
  'sending',
  'publishing',
  'deleting',
  'signing_in',
  'settings',
  'terminal',
  'files',
  'writing',
  'showing',
  'takeover',
  'pairing',
]

const RULES: readonly SiteRule[] = ['allow', 'deny', 'agent-store']

/** A grant as the crate serialises one (grants.rs), or null for anything else. */
export function readGrant(value: unknown): Grant | null {
  if (!isRecord(value)) return null
  const {
    id,
    name,
    client,
    scopes,
    spaces,
    sites,
    scripts,
    mode,
    asks,
    always,
    programs,
    limits,
    created,
  } = value
  if (typeof id !== 'string' || typeof name !== 'string' || typeof client !== 'string') return null

  const limited = isRecord(limits) ? limits : {}
  return {
    id,
    name,
    client,
    scopes: strings(scopes).flatMap((one) => known(SCOPES, one) ?? []),
    spaces: spaces === 'all' ? 'all' : strings(spaces),
    sites: Object.fromEntries(
      Object.entries(isRecord(sites) ? sites : {}).flatMap(([site, rule]) => {
        const said = known(RULES, rule)
        return said ? [[site, said]] : []
      }),
    ),
    scripts: strings(scripts),
    mode: mode === 'confirm' ? 'confirm' : 'unsupervised',
    asks: Object.fromEntries(
      Object.entries(isRecord(asks) ? asks : {}).flatMap(([category, on]) =>
        known(CATEGORIES, category) && typeof on === 'boolean' ? [[category, on]] : [],
      ),
    ),
    always: Object.fromEntries(
      Object.entries(isRecord(always) ? always : {}).map(([site, categories]) => [
        site,
        strings(categories).flatMap((one) => known(CATEGORIES, one) ?? []),
      ]),
    ),
    programs: strings(programs),
    limits: {
      tabs: count(limited.tabs, 4),
      calls: count(limited.calls, 600),
      navigations: count(limited.navigations, 60),
    },
    created: count(created, 0),
  }
}

function readGrants(value: unknown): Grant[] {
  return Array.isArray(value) ? value.flatMap((one) => readGrant(one) ?? []) : []
}

function readMinted(value: unknown): Minted {
  const grant = isRecord(value) ? readGrant(value.grant) : null
  const token = isRecord(value) ? value.token : null
  if (!grant || typeof token !== 'string') throw new Error('the agent could not be made')
  return { grant, token }
}

/** The crate itself. */
export const tauriCrate: AgentsCrate = {
  read: async () => readGrants(await invoke<unknown>('agents_read')),
  write: async (grants) => readGrants(await invoke<unknown>('agents_write', { grants })),
  mint: async (name) => readMinted(await invoke<unknown>('agents_mint', { name })),
  days: async () => strings(await invoke<unknown>('agents_log_days')),
  day: async (day) => {
    const lines = await invoke<unknown>('agents_log', { day })
    return Array.isArray(lines) ? lines.map((line: unknown) => line) : []
  },
  clear: (agent) => invoke('agents_log_clear', { agent }),
  // Asked of `nib mcp`'s own half of the crate; a build without it has no line to copy.
  program: () =>
    invoke<unknown>('mcp_program').then(
      (path) => (typeof path === 'string' && path ? path : null),
      () => null,
    ),
  hear: async (on) => {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<unknown>(AGENT_EVENT, ({ payload }) => {
      const heard = readHeard(payload)
      if (heard) on(heard)
    })
  },
}
