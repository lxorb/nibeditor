/** What the panel remembers between runs, beside the threads themselves: the mode a new
 *  thread starts in (the last one picked, Approve before any was; docs/ai-sidebar.md
 *  4.1), the effort last used with each model (4.9, Claude Code's `modelSettings`),
 *  which thread each space had open, and whether a tab of the panel shows its rail of
 *  threads. Choices, not words of anybody's, so `localStorage` through stored.ts is the
 *  place. */

import type { Effort } from '../chat/types'
import { isEffort } from '../chat/effort'
import { FIRST_MODE, type Mode, modeIn } from '../modes'
import { without } from '../../records'
import { isRecord, isString, keep, stored } from '../../stored'

const STORAGE_KEY = 'nib:ai-sidebar'

interface Prefs {
  mode: Mode
  efforts: Record<string, Effort>
  open: Record<string, string>
  rail: boolean
}

function read(): Prefs {
  const saved = stored(STORAGE_KEY)
  const out: Prefs = { mode: FIRST_MODE, efforts: {}, open: {}, rail: true }
  if (!isRecord(saved)) return out
  if (saved.rail === false) out.rail = false
  out.mode = modeIn(saved.mode) ?? FIRST_MODE
  if (isRecord(saved.efforts)) {
    for (const [model, effort] of Object.entries(saved.efforts)) {
      if (isEffort(effort)) out.efforts[model] = effort
    }
  }
  if (isRecord(saved.open)) {
    for (const [space, id] of Object.entries(saved.open)) if (isString(id)) out.open[space] = id
  }
  return out
}

let prefs: Prefs | null = null

function held(): Prefs {
  prefs ??= read()
  return prefs
}

function save(): void {
  keep(STORAGE_KEY, JSON.stringify(held()))
}

/** The key a model's effort is filed under: the same model on two providers is two
 *  rows, since the levels each offers are its own. */
function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

export function lastMode(): Mode {
  return held().mode
}

export function rememberMode(mode: Mode): void {
  held().mode = mode
  save()
}

export function effortFor(provider: string, model: string): Effort {
  return held().efforts[modelKey(provider, model)] ?? 'auto'
}

export function rememberEffort(provider: string, model: string, effort: Effort): void {
  held().efforts[modelKey(provider, model)] = effort
  save()
}

export function openIn(space: string): string | null {
  return held().open[space] ?? null
}

export function rememberOpen(space: string, id: string | null): void {
  const prefs = held()
  prefs.open = id ? { ...prefs.open, [space]: id } : without(prefs.open, space)
  save()
}

/** Whether a tab of the panel shows the rail of threads down its left, as ChatGPT's
 *  sidebar stays as it was left. */
export function railOpen(): boolean {
  return held().rail
}

export function rememberRail(open: boolean): void {
  held().rail = open
  save()
}
