/** The models Claude Code and Codex offer, as each program lists them, in the shape the
 *  model popover reads (`ModelInfo`, docs/ai-sidebar.md 4.9). Never a table of nib's:
 *  Claude Code's `list_models` and Codex's `model/list` are asked through the crate
 *  (`ai_cli_models`), and what neither says is null until a turn says it.
 *
 *  Claude Code lists its aliases (`default`, `opus[1m]`, `sonnet`, `haiku`), each with
 *  the efforts it takes; a `[1m]` in a model's name is its million-token window, and any
 *  other window is learnt from the first answer's `modelUsage`. It has no fast mode
 *  headless (measured on 2.1.280). Codex lists each model with its efforts, its
 *  default, whether it takes pictures, and its service tiers, Fast among them. Pure. */

import type { Effort, ModelInfo } from '../chat/types'
import type { LocalKind } from '../providers'

/** nib's scale, in its order; `auto` is the model's own default and always offered. */
const SCALE: readonly Effort[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** A level as a program spells it, on nib's scale; one nib has no place for is left
 *  out (Codex's `ultra` hands work to subagents, which nib's agent does not have). */
function levelOf(word: unknown): Effort | null {
  if (word === 'none') return 'off'
  return SCALE.find((one) => one === word) ?? null
}

/** The levels a program listed, `auto` first, in the scale's order. */
function effortsOf(words: readonly unknown[]): Effort[] {
  const listed = new Set(words.map(levelOf).filter((one): one is Effort => one !== null))
  return ['auto', ...SCALE.filter((one) => listed.has(one))]
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** The million-token window a Claude Code name says it has. */
function claudeWindow(...names: unknown[]): number | null {
  return names.some((name) => typeof name === 'string' && name.endsWith('[1m]')) ? 1_000_000 : null
}

/** What `ai_cli_models` answered, as the popover's rows. */
export function modelsIn(kind: LocalKind, listed: unknown): ModelInfo[] {
  if (kind === 'claude-code') {
    return list(record(listed).models)
      .map(record)
      .filter((one) => typeof one.value === 'string' && one.value)
      .map((one) => ({
        id: String(one.value),
        name:
          typeof one.displayName === 'string' && one.displayName
            ? one.displayName
            : String(one.value),
        window: claudeWindow(one.value, one.resolvedModel),
        efforts: effortsOf(list(one.supportedEffortLevels)),
        images: true,
        fast: false,
      }))
  }
  return list(record(listed).data)
    .map(record)
    .filter((one) => one.hidden !== true && typeof (one.model ?? one.id) === 'string')
    .map((one) => {
      const id = String(one.model ?? one.id)
      return {
        id,
        name: typeof one.displayName === 'string' && one.displayName ? one.displayName : id,
        window: null,
        efforts: effortsOf(
          list(one.supportedReasoningEfforts).map((row) => record(row).reasoningEffort),
        ),
        images: list(one.inputModalities).includes('image'),
        fast: list(one.serviceTiers).some((tier) => record(tier).id === 'priority'),
      }
    })
}
