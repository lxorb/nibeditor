/** What a provider taught nib about one of its models by refusing something, and the
 *  level a reader last picked for it: kept on this device so neither is asked again.
 *
 *  A provider's list says what it says (catalogue.ts); what it leaves out is learnt the
 *  first time it matters. OpenAI's list names no efforts and no window, so the first
 *  `400` about an effort takes that level out for that model, and the first refusal that
 *  names a context length is the window. Claude Code's `modelSettings` keeps the picked
 *  level per model the same way.
 *
 *  Keyed by provider id and model, so two OpenAI-compatible servers serving a model of
 *  the same name are two entries. */

import { isBoolean, isNumber, isRecord, keep, recordOf, stored } from '../../stored'
import { isEffort } from './effort'
import type { Effort } from './types'

const STORAGE_KEY = 'nib:ai-chat'

/** What is known about one model beyond its provider's list. */
export interface Learnt {
  /** Levels it refused. */
  refused?: Effort[]
  /** The window a refusal named. */
  window?: number
  /** False once it refused any reasoning field at all. */
  reasons?: boolean
  /** False once it refused a per-message effort (Claude's beta). */
  perMessage?: boolean
  /** False once it refused tools, which leaves its threads in Ask mode. */
  tools?: boolean
  /** The level the reader last picked for it. */
  picked?: Effort
}

function learntIn(value: unknown): value is Learnt {
  return isRecord(value)
}

/** One entry, with anything unreadable in it left out. */
function cleaned(value: Learnt): Learnt {
  const out: Learnt = {}
  if (Array.isArray(value.refused)) out.refused = value.refused.filter(isEffort)
  if (isNumber(value.window) && value.window > 0) out.window = value.window
  if (isBoolean(value.reasons)) out.reasons = value.reasons
  if (isBoolean(value.perMessage)) out.perMessage = value.perMessage
  if (isBoolean(value.tools)) out.tools = value.tools
  if (isEffort(value.picked)) out.picked = value.picked
  return out
}

let held: Record<string, Learnt> | null = null

function all(): Record<string, Learnt> {
  if (held) return held
  const read = recordOf(stored(STORAGE_KEY), learntIn)
  held = Object.fromEntries(Object.entries(read).map(([key, one]) => [key, cleaned(one)]))
  return held
}

function keyOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** What is known about a model. */
export function learnt(provider: string, model: string): Learnt {
  return all()[keyOf(provider, model)] ?? {}
}

/** Adds to what is known about a model, and writes it down. */
export function learn(provider: string, model: string, change: Learnt): void {
  const key = keyOf(provider, model)
  const before = all()[key] ?? {}
  const refused = [...new Set([...(before.refused ?? []), ...(change.refused ?? [])])]
  const next = { ...before, ...change, ...(refused.length ? { refused } : {}) }
  held = { ...all(), [key]: next }
  keep(STORAGE_KEY, JSON.stringify(held))
}

/** Forgets everything, for the tests. */
export function forgetLearnt(): void {
  held = null
}
