/** How full a thread's window is (4.10): the provider's own counts after every answer,
 *  an estimate made on this machine for what has not been sent, and where compaction
 *  happens.
 *
 *  Never `count_tokens`: asking would send the note before anybody pressed send, which
 *  docs/ai.md rules out. So the draft is an estimate and says so (the ring's ≈), and the
 *  circle is only ever drawn against a window somebody said. */

import type { AutoCompact, Draft, Usage } from './types'

/** Nothing counted yet. */
export function noUsage(window: number | null): Usage {
  return { input: 0, cached: 0, output: 0, reasoning: 0, window }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Claude's `usage`. `input_tokens` leaves out what was read from or written to the
 *  cache, so the three are added for what was sent. A compaction iteration is spent
 *  but is not in the window afterwards, so only the message iterations count. */
export function anthropicUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  const read = count(usage.cache_read_input_tokens)
  const input = count(usage.input_tokens) + read + count(usage.cache_creation_input_tokens)
  return { input, cached: read, output: count(usage.output_tokens), reasoning: 0, window }
}

/** What Claude's `usage.iterations` spent on compaction, which the top-level counts
 *  leave out. */
export function compactionSpent(said: unknown): { input: number; output: number } {
  const iterations = record(said).iterations
  if (!Array.isArray(iterations)) return { input: 0, output: 0 }
  const spent = { input: 0, output: 0 }
  for (const one of iterations.map(record)) {
    if (one.type !== 'compaction') continue
    spent.input += count(one.input_tokens)
    spent.output += count(one.output_tokens)
  }
  return spent
}

/** The Responses API's `usage`: input with its cached part, output with its reasoning. */
export function responsesUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  return {
    input: count(usage.input_tokens),
    cached: count(record(usage.input_tokens_details).cached_tokens),
    output: count(usage.output_tokens),
    reasoning: count(record(usage.output_tokens_details).reasoning_tokens),
    window,
  }
}

/** Chat completions' `usage`, and OpenRouter's `cost` where it reports one. */
export function completionsUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  const cost = usage.cost
  return {
    input: count(usage.prompt_tokens),
    cached: count(record(usage.prompt_tokens_details).cached_tokens),
    output: count(usage.completion_tokens),
    reasoning: count(record(usage.completion_tokens_details).reasoning_tokens),
    window,
    ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}),
  }
}

/** Two requests of one turn as one: the window is the later one's, the spending both. */
export function added(before: Usage, after: Usage): Usage {
  const cost = (before.cost ?? 0) + (after.cost ?? 0)
  return {
    input: after.input,
    cached: after.cached,
    output: after.output,
    reasoning: before.reasoning + after.reasoning,
    window: after.window ?? before.window,
    ...(before.cost !== undefined || after.cost !== undefined ? { cost } : {}),
  }
}

/** How full the window is for the next request: what was sent and what came back,
 *  which the next request carries too. */
export function filled(usage: Usage): number {
  return usage.input + usage.output
}

/** A picture's guess: Claude counts about (width × height) / 750, which for the size a
 *  pasted screenshot is sent at is about this. */
const PICTURE = 1_600

/** The tokens some words come to, guessed on this machine: a token is about four
 *  characters of English and about one of a script without spaces between words. */
export function estimateText(words: string): number {
  let wide = 0
  for (const one of words) if (one.charCodeAt(0) > 0x2fff) wide++
  return Math.ceil((words.length - wide) / 4 + wide)
}

/** The draft and its chips, guessed: the ≈ on the ring's next-send band. */
export function estimate(draft: Draft): number {
  let tokens = estimateText(draft.text)
  for (const one of draft.attachments) {
    if (one.text) tokens += estimateText(one.text) + estimateText(one.label) + 8
    if (one.image) tokens += PICTURE
  }
  return tokens
}

/** Where compaction happens on its own: Claude Code's buffer below the top of a large
 *  window (967K of 1M), a fifth of a small one, a count the reader set, or never. */
export function compactsAt(window: number | null, auto: AutoCompact = 'auto'): number | null {
  if (auto === 'off') return null
  if (typeof auto === 'number') return window ? Math.min(auto, window) : auto
  if (!window) return null
  return window - Math.min(33_000, Math.round(window * 0.2))
}

/** How much of the circle is filled, 0 to 1, or null where no window is known: the
 *  ring then shows a count and no circle rather than a guess. */
export function fraction(usage: Usage, draft = 0): number | null {
  if (!usage.window) return null
  return Math.min(1, (filled(usage) + draft) / usage.window)
}

/** Whether the ring takes the warning colour: past four fifths. */
export function warns(usage: Usage, draft = 0): boolean {
  return (fraction(usage, draft) ?? 0) >= 0.8
}

/** Whether the next send should compact first. */
export function shouldCompact(usage: Usage, draft: number, auto: AutoCompact = 'auto'): boolean {
  const at = compactsAt(usage.window, auto)
  return at !== null && filled(usage) > 0 && filled(usage) + draft >= at
}
