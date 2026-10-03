/** Claude Code's stream-json, read line by line: a question's answer, and a session's
 *  turns.
 *
 *  `claude -p --output-format stream-json --include-partial-messages` prints one event
 *  per line (measured against 2.1.280): `system/init` with the model, `stream_event`
 *  wrapping the Messages API's own events - `content_block_delta` with a `text_delta` is
 *  the answer arriving, a `thinking_delta` the thinking, `message_start` and
 *  `message_delta` the request's counts - then the whole `assistant` message (where a
 *  tool call is read, whole), a `user` message carrying each tool's answer, a
 *  `rate_limit_event` saying where the plan stands, and a `result` last, `is_error` set
 *  when it failed and `modelUsage` naming the model's window. A session prints the same
 *  for every turn, and `system/compact_boundary` where it compacted.
 *
 *  A version without partial messages prints the `assistant` message and no deltas, so
 *  that message is the answer where no delta came before it, and skipped where one did.
 *  An event of a subagent's (`parent_tool_use_id` set) is never the answer; with no tool
 *  but nib's there are none, and the rule costs nothing. */

import {
  type Counted,
  eventIn,
  type Heard,
  type Limit,
  saysLimit,
  saysSignedOut,
  type ToolHeard,
} from './heard'

/** The prefix Claude Code gives the tools of the server called `nib`. */
const NIB = 'mcp__nib__'

/** A reader for one run or session, which remembers whether the message being read
 *  streamed and what the request so far has counted. */
export function claudeReader(): (line: string) => Heard {
  let streamed = false
  let counted: Counted = {}

  return (line) => {
    const event = eventIn(line)
    if (!event || event.parent_tool_use_id) return {}

    switch (event.type) {
      case 'system':
        if (event.subtype === 'compact_boundary') return { compacted: true }
        return event.subtype === 'init' ? named(event.model) : {}

      case 'stream_event':
        return streamEvent(record(event.event))

      case 'assistant': {
        const content = record(event.message)?.content
        const tool = toolUse(content)
        if (tool) return { tool }
        if (streamed) return {}
        const text = textOf(content)
        return text ? { text } : {}
      }

      case 'user': {
        const tool = toolResult(record(event.message)?.content)
        return tool ? { tool } : {}
      }

      case 'rate_limit_event': {
        const limit = limitIn(record(event.rate_limit_info))
        return limit ? { limit } : {}
      }

      case 'result':
        return result(event)

      default:
        return {}
    }
  }

  function streamEvent(inner: Record<string, unknown> | null): Heard {
    if (inner?.type === 'message_start') {
      streamed = false
      const message = record(inner.message)
      counted = { ...countsIn(record(message?.usage)) }
      return { ...named(message?.model), ...(counted.input ? { usage: { ...counted } } : {}) }
    }
    if (inner?.type === 'message_delta') {
      const output = record(inner.usage)?.output_tokens
      if (typeof output !== 'number') return {}
      counted = { ...counted, output }
      return { usage: { ...counted } }
    }
    const delta = record(inner?.delta)
    if (inner?.type !== 'content_block_delta' || !delta) return {}
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking)
      return { thinking: delta.thinking }
    if (delta.type !== 'text_delta' || typeof delta.text !== 'string' || !delta.text) return {}
    streamed = true
    return { text: delta.text }
  }

  function result(event: Record<string, unknown>): Heard {
    const window = windowIn(record(event.modelUsage))
    const usage: Heard = window ? { usage: { ...counted, window } } : {}
    if (event.is_error !== true) return { ...usage, ended: 'end' }
    // A turn that was interrupted ends as `error_during_execution` too; the engine knows
    // whether it asked for that.
    const words =
      typeof event.result === 'string' && event.result
        ? event.result
        : typeof event.subtype === 'string'
          ? event.subtype
          : 'error'
    return {
      ...usage,
      ended: 'error',
      trouble: words,
      ...(saysSignedOut(words) ? { signedOut: true } : {}),
      ...(saysLimit(words) ? { limit: { state: 'reached', until: null, untilWords: null } } : {}),
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** The model an event names, without the `[1m]` a long-context model's name carries in
 *  Claude Code's own spelling. */
function named(model: unknown): Heard {
  if (typeof model !== 'string' || !model) return {}
  return { model: model.replace(/\[[^\]]*\]$/, '') }
}

/** The words of a message's content blocks. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const one = record(block)
      return one?.type === 'text' && typeof one.text === 'string' ? one.text : ''
    })
    .join('')
}

/** A call of one of nib's tools in an `assistant` message. */
function toolUse(content: unknown): ToolHeard | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    const one = record(block)
    if (one?.type !== 'tool_use' || typeof one.id !== 'string' || typeof one.name !== 'string')
      continue
    return { id: one.id, name: one.name.replace(NIB, ''), args: one.input ?? {} }
  }
  return null
}

/** A tool's answer in a `user` message. */
function toolResult(content: unknown): ToolHeard | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    const one = record(block)
    if (one?.type !== 'tool_result' || typeof one.tool_use_id !== 'string') continue
    const text =
      typeof one.content === 'string'
        ? one.content
        : Array.isArray(one.content)
          ? textOf(one.content)
          : ''
    return { id: one.tool_use_id, name: '', done: { text, error: one.is_error === true } }
  }
  return null
}

/** A request's counts as the Messages API gives them: what was sent is the fresh input,
 *  the cache read and the cache written. */
function countsIn(usage: Record<string, unknown> | null): Counted {
  if (!usage) return {}
  const number = (key: string) => (typeof usage[key] === 'number' ? usage[key] : 0)
  const cached = number('cache_read_input_tokens')
  const input = number('input_tokens') + cached + number('cache_creation_input_tokens')
  return { input, cached, output: number('output_tokens') }
}

/** The model's window, from a result's `modelUsage`. */
function windowIn(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null
  for (const one of Object.values(usage)) {
    const window = record(one)?.contextWindow
    if (typeof window === 'number' && window > 0) return window
  }
  return null
}

/** Where the plan stands, out of a `rate_limit_info`: `allowed`, `allowed_warning` or
 *  `rejected`, with the moment the window resets in seconds. */
function limitIn(info: Record<string, unknown> | null): Limit | null {
  if (!info) return null
  const state =
    info.status === 'rejected' ? 'reached' : info.status === 'allowed_warning' ? 'near' : 'fine'
  const until = typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null
  return { state, until, untilWords: null }
}
