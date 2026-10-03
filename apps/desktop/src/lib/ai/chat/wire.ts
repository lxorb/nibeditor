/** What every API's adapter is: a request built from a thread's steps, a reader for the
 *  stream that answers it, and the message that hands tool results back. One file per
 *  API (anthropic.ts, responses.ts, completions.ts), each pure, so each is tested against
 *  a recorded stream with no network. */

import type { Provider } from '../providers'
import type { Call, Step } from './transcript'
import type { Effort, ModelInfo, Part, ToolOutput, Usage } from './types'

/** A tool as the crate lists it: the `nib mcp` table's row. */
export interface ToolDef {
  name: string
  description: string
  inputSchema: unknown
  annotations?: { readOnlyHint?: boolean } & Record<string, unknown>
}

/** Everything one request is made of. */
export interface Ask {
  provider: Provider
  model: ModelInfo
  /** The level for this request. */
  effort: Effort
  /** The level the thread's cached prefix was written at, where a per-message effort
   *  changes it after (Claude only). */
  base?: Effort
  fast: boolean
  system: string
  tools: ToolDef[]
  steps: Step[]
  /** The wire's own messages this turn has added so far: earlier rounds of the loop. */
  added: unknown[]
  /** The provider's own web search, for this message. */
  web: boolean
  /** Whether to send per-message efforts (Claude's beta). */
  perMessage: boolean
}

/** How one response ended. `tool` means it asked for tools and waits for their answers;
 *  `pause` means the provider paused a long turn of its own and wants it sent again. */
export type Ending = 'end' | 'tool' | 'max_tokens' | 'refusal' | 'pause'

/** What a response came to, once read. */
export interface Answer {
  /** The wire's own messages for it, sent back as they came on the next request. */
  messages: unknown[]
  calls: Call[]
  ending: Ending
  /** The provider's category for a refusal, where it gave one. */
  refusal?: string
}

/** What one event changed. */
export interface Heard {
  /** The indexes of the parts that are new or grew. */
  changed: number[]
  model?: string
  usage?: Usage
  /** A complaint the provider put in the stream after a `200`. */
  trouble?: unknown
}

/** Reads one response's stream into parts as it arrives. */
export interface Reader {
  readonly parts: Part[]
  heard(event: unknown): Heard
  answer(): Answer
}

/** One API's adapter. */
export interface Wire {
  request(ask: Ask): { url: string; body: unknown; headers: Record<string, string> }
  reader(window: number | null): Reader
  /** The wire's own message(s) handing back tool answers. */
  results(results: { call: Call; output: ToolOutput }[]): unknown[]
}

/** A JSON value as a record, or an empty one. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** A string, or the empty one. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Arguments streamed as JSON text, read once they are whole. Arguments that do not
 *  parse are handed on as they are, so the crate refuses them in its own words. */
export function argsOf(json: string): unknown {
  if (!json.trim()) return {}
  try {
    return JSON.parse(json) as unknown
  } catch {
    // A call cut off mid-argument; see above.
    return json
  }
}

/** A tool's name as the crate knows it. The ChatGPT plan's tools sit in a namespace, and
 *  a model may say the namespace in the name. */
export function bareName(name: string): string {
  return name.replace(/^nib[.:_]{1,2}/, '')
}
