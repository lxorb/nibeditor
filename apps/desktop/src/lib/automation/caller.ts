/** Who is asking: the reader's own command line, or an agent with its grant.
 *
 *  The endpoint hands the window an agent's grant beside the verb (see
 *  src-tauri/src/endpoint.rs and docs/agent-native.md 13.1), and nothing beside the
 *  verb for the installation's own secret, which keeps meaning everything. The grant
 *  crossed a boundary, so it is read here once, and what cannot be read as one is an
 *  agent holding nothing: a grant this window does not understand never becomes the
 *  reader.
 *
 *  Here rather than in lib/agents because the dispatcher reads it on every request,
 *  and the dispatcher is loaded on every launch; lib/agents is fetched by the first
 *  agent request and not before (docs/agent-native.md 11). */

import type { Scope } from '../agents/verbs'

/** What the window needs of an agent's grant. The crate holds the rest. */
interface Agent {
  id: string
  name: string
  scopes: readonly string[]
  /** The spaces it may reach, by name; a space it may not reach does not exist to it. */
  spaces: 'all' | readonly string[]
  mode: 'unsupervised' | 'confirm'
  /** The programs `run_terminal` starts without asking. */
  programs: readonly string[]
}

/** The reader, or an agent. */
export type Caller = { agent: null } | { agent: Agent }

/** The reader's own command line and the crate asking on an agent's behalf. */
export const READER: Caller = { agent: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

/** The caller a request names: the reader when it names nobody, an agent otherwise. */
export function callerOf(told: unknown): Caller {
  if (told === undefined || told === null) return READER

  const grant = isRecord(told) ? told : {}
  const id = typeof grant.id === 'string' && grant.id ? grant.id : 'agent'
  return {
    agent: {
      id,
      name: typeof grant.name === 'string' && grant.name ? grant.name : id,
      scopes: texts(grant.scopes),
      spaces: grant.spaces === 'all' ? 'all' : texts(grant.spaces),
      // Anything but the one word that asks for less is the mode that asks for more.
      mode: grant.mode === 'unsupervised' ? 'unsupervised' : 'confirm',
      programs: texts(grant.programs),
    },
  }
}

/** Whether a caller reaches a scope. The reader reaches every one. */
export function holds(caller: Caller, scope: Scope): boolean {
  return caller.agent === null || caller.agent.scopes.includes(scope)
}

/** A verb's answer as an agent reads it: the contract's three shapes
 *  (src-tauri/src/agents/verbs.rs `Answer`), with `ok` beside them for the endpoint,
 *  which files the call in the audit log by it. */
export type AgentAnswer =
  | { ok: true; status: 'ok'; result: unknown; untrusted?: string }
  | { ok: true; status: 'needs_approval'; approval: string; summary: string }
  | { ok: false; status: 'error'; code: string; message: string; error: string }

/** A refusal in the contract's shape. */
export function refusal(code: string, message: string): AgentAnswer {
  return { ok: false, status: 'error', code, message, error: message }
}
