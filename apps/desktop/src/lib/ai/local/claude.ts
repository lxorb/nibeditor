/** Claude Code's stream-json, read line by line.
 *
 *  `claude -p --output-format stream-json --include-partial-messages` prints one event
 *  per line (measured against 2.1.280): `system/init` with the model, `stream_event`
 *  wrapping the Messages API's own events - `content_block_delta` with a `text_delta` is
 *  the answer arriving - then the whole `assistant` message, a `rate_limit_event` saying
 *  where the plan stands, and a `result` last, `is_error` set when it failed.
 *
 *  A version without partial messages prints the `assistant` message and no deltas, so
 *  that message is the answer where no delta came before it, and skipped where one did.
 *  An event of a subagent's (`parent_tool_use_id` set) is never the answer; with no tools
 *  there are none, and the rule costs nothing. */

import { eventIn, type Heard, type Limit, saysLimit, saysSignedOut } from './heard'

/** A reader for one run, which remembers whether the message being read streamed. */
export function claudeReader(): (line: string) => Heard {
  let streamed = false

  return (line) => {
    const event = eventIn(line)
    if (!event || event.parent_tool_use_id) return {}

    switch (event.type) {
      case 'system':
        return event.subtype === 'init' ? named(event.model) : {}

      case 'stream_event': {
        const inner = record(event.event)
        if (inner?.type === 'message_start') {
          streamed = false
          return named(record(inner.message)?.model)
        }
        const delta = record(inner?.delta)
        if (inner?.type !== 'content_block_delta' || delta?.type !== 'text_delta') return {}
        if (typeof delta.text !== 'string' || !delta.text) return {}
        streamed = true
        return { text: delta.text }
      }

      case 'assistant': {
        if (streamed) return {}
        const text = textOf(record(event.message)?.content)
        return text ? { text } : {}
      }

      case 'rate_limit_event': {
        const limit = limitIn(record(event.rate_limit_info))
        return limit ? { limit } : {}
      }

      case 'result': {
        if (event.is_error !== true) return {}
        const words =
          typeof event.result === 'string' && event.result
            ? event.result
            : typeof event.subtype === 'string'
              ? event.subtype
              : 'error'
        return {
          trouble: words,
          ...(saysSignedOut(words) ? { signedOut: true } : {}),
          ...(saysLimit(words)
            ? { limit: { state: 'reached', until: null, untilWords: null } }
            : {}),
        }
      }

      default:
        return {}
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

/** Where the plan stands, out of a `rate_limit_info`: `allowed`, `allowed_warning` or
 *  `rejected`, with the moment the window resets in seconds. */
function limitIn(info: Record<string, unknown> | null): Limit | null {
  if (!info) return null
  const state =
    info.status === 'rejected' ? 'reached' : info.status === 'allowed_warning' ? 'near' : 'fine'
  const until = typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null
  return { state, until, untilWords: null }
}
