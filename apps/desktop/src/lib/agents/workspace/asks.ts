/** Asking the reader first, for the few things an agent never does on its own say.
 *
 *  Which things is docs/agent-native.md 9.3: publishing and sharing, deleting for good
 *  (a version put back over a note), settings, the terminal - and in `confirm` mode
 *  every write. The question is the crate's (`agents_ask`): it answers at once, either
 *  that this very call was already allowed, which spends the allowance, or with the
 *  question the reader will be shown, so an agent is never held on a connection for an
 *  hour. Called again once allowed, the same call finds its allowance by `key`, which is
 *  why the key is the call itself: the verb and its arguments, written one way. */

import type { AgentAnswer } from '../../automation/caller'
import { refusal } from '../../automation/caller'
import { invoke } from '../../tauri'
import type { Category } from '../verbs'
import type { Call } from './call'

/** What a call is about, for finding its question again: the verb and its arguments
 *  with their keys in order, so the same call asked twice is the same key. */
function keyOf(call: Call): string {
  return `${call.verb}:${JSON.stringify(ordered(call.args))}`
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (typeof value !== 'object' || value === null) return value

  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, ordered(record[key])]),
  )
}

/** Whether the call may go ahead: null when it may, and otherwise what it answers.
 *
 *  `category` is what the call always asks about, or null for a write that asks only
 *  in `confirm` mode. The reader's own command line is never asked anything. */
export async function asked(
  call: Call,
  category: Category | null,
  summary: string,
): Promise<AgentAnswer | null> {
  const agent = call.caller.agent
  if (agent === null) return null

  const about = category ?? (agent.mode === 'confirm' ? 'writing' : null)
  if (about === null) return null

  const said = await invoke<unknown>('agents_ask', {
    agent: agent.id,
    category: about,
    summary,
    key: keyOf(call),
  }).catch((error: unknown) => ({ status: 'error', code: 'failed', message: String(error) }))

  return answered(said)
}

/** The crate's answer to a question, read: null for "go ahead". */
function answered(said: unknown): AgentAnswer | null {
  const record = typeof said === 'object' && said !== null ? (said as Record<string, unknown>) : {}
  const words = (key: string) => (typeof record[key] === 'string' ? record[key] : '')

  if (record.status === 'ok') return null
  if (record.status === 'needs_approval' && words('approval')) {
    return {
      ok: true,
      status: 'needs_approval',
      approval: words('approval'),
      summary: words('summary'),
    }
  }

  return refusal(words('code') || 'denied', words('message') || 'the reader was not asked')
}
