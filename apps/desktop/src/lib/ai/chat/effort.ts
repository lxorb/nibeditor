/** nib's one scale of effort, and what each provider is sent for a level (4.9).
 *
 *  The scale is Auto, Off, Minimal, Low, Medium, High, Extra, Max. A model offers the
 *  levels its provider says it has, `auto` always first; a level the provider then
 *  refuses is taken out for that model and the nearest one left is used instead, so a
 *  refusal is met once rather than on every message. Pure: what was refused is kept in
 *  learned.ts. */

import type { Api, Effort } from './types'

/** The scale, lowest first after `auto`. */
export const SCALE: readonly Effort[] = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** Whether a word is a level of the scale. */
export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (SCALE as readonly string[]).includes(value)
}

/** Levels in the scale's order, each once, `auto` first. */
export function ordered(levels: Iterable<Effort>): Effort[] {
  const held = new Set(levels)
  held.add('auto')
  return SCALE.filter((one) => held.has(one))
}

/** What the wire is sent for a level, or null for nothing at all (`auto`). Claude has no
 *  `none` or `minimal`; OpenAI's shape takes every word, `off` as `none`. A level a model
 *  does not offer never gets this far: the chip offers only the model's own. */
export function wireEffort(api: Api, effort: Effort): string | null {
  if (effort === 'auto') return null
  if (api === 'anthropic') return effort === 'off' || effort === 'minimal' ? null : effort
  return effort === 'off' ? 'none' : effort
}

/** The next level up for Alt+T, wrapping round to the first. A level the model does not
 *  have starts again from `auto`. */
export function nextEffort(current: Effort, offered: readonly Effort[]): Effort {
  const levels = ordered(offered)
  const at = levels.indexOf(current)
  return levels[(at + 1) % levels.length] ?? 'auto'
}

/** The level to use instead of one the model refused: the nearest left on the scale,
 *  the lower of two equally near, and `auto` where nothing is left. */
export function nearest(refused: Effort, offered: readonly Effort[]): Effort {
  const at = SCALE.indexOf(refused)
  const left = ordered(offered).filter((one) => one !== refused && one !== 'auto')
  let best: Effort = 'auto'
  let distance = Infinity
  for (const one of left) {
    const away = Math.abs(SCALE.indexOf(one) - at)
    if (away < distance) {
      best = one
      distance = away
    }
  }
  return best
}

/** A level a model offers, or the nearest it does: what a thread asks for after the
 *  model under it changed. */
export function within(effort: Effort, offered: readonly Effort[]): Effort {
  return ordered(offered).includes(effort) ? effort : nearest(effort, offered)
}

/** Whether a provider's refusal is about the effort it was sent. The words differ by
 *  provider, but every one names the parameter: `output_config.effort`, `reasoning.effort`,
 *  `reasoning_effort`, or the `param` field OpenAI fills in. */
export function refusesEffort(said: string, param?: string): boolean {
  if (param && /effort/i.test(param)) return true
  return /\beffort\b|reasoning[._]effort/i.test(said)
}

/** Whether the refusal is about reasoning as a whole, which a model that does not reason
 *  answers to any `reasoning` field: nothing about reasoning is sent to it again. */
export function refusesReasoning(said: string, param?: string): boolean {
  if (param && /^reasoning(?:\.summary)?$/i.test(param)) return true
  return /reasoning\.summary|reasoning is not supported|does not support reasoning|unsupported parameter: 'reasoning'/i.test(
    said,
  )
}

/** The levels a refusal says the model does take, where it lists them: OpenAI's
 *  "Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'." Null where it
 *  lists none. */
export function supportedIn(said: string): Effort[] | null {
  const list = /supported values are:?([^.]*)/i.exec(said)?.[1]
  if (!list) return null
  const words = [...list.matchAll(/'([a-z]+)'/gi)].map((one) =>
    one[1] === 'none' ? 'off' : one[1],
  )
  const levels = words.filter(isEffort)
  return levels.length ? ordered(levels) : null
}

/** Whether a refusal says the model takes no effort at all: OpenAI's "Unsupported
 *  parameter: 'reasoning.effort' is not supported with this model." */
export function takesNoEffort(said: string, code?: string): boolean {
  return code === 'unsupported_parameter' || /unsupported parameter/i.test(said)
}
