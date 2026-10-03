/** Codex's app-server, read notification by notification: a question's answer, and a
 *  session's turns.
 *
 *  The crate is the app-server's client (src-tauri/src/ai_cli/codex_app.rs) and hands on
 *  every notification about this thread, one per line, in the shapes
 *  `codex app-server generate-ts` gives (0.160.0): `turn/started`, then for each thing
 *  the turn makes `item/started` and `item/completed` - an `agentMessage` is the answer,
 *  streamed as `item/agentMessage/delta`; a `reasoning` streams its summary as
 *  `item/reasoning/summaryTextDelta`; an `mcpToolCall` is one of nib's tools - then
 *  `thread/tokenUsage/updated` with the counts and the model's window, `thread/goal/updated`
 *  and `thread/goal/cleared` with where the thread's own goal stands,
 *  `account/rateLimits/updated` with where the plan stands, and `turn/completed` with
 *  how the turn ended. A bare `error` says what went wrong on the way.
 *
 *  Each message hands on only the part of its text not handed on before, whether it came
 *  as deltas or whole at its completion, so the answer never says a word twice. */

import type { GoalState } from '../chat/types'
import { type Counted, eventIn, type Heard, type Limit, saysLimit, saysSignedOut } from './heard'

/** The share of a plan's window past which the plan counts as near its limit. */
const NEAR = 80

/** A reader for one thread, which remembers how much of each message it has handed on. */
export function codexReader(): (line: string) => Heard {
  const said = new Map<string, number>()

  /** The part of an agent message's text not handed on yet. */
  function more(id: string, text: string, whole: boolean): Heard {
    const before = said.get(id) ?? 0
    // A new message after an earlier one is a new paragraph of the same answer.
    const gap = before === 0 && said.size > 0 && !said.has(id) ? '\n\n' : ''
    const next = whole ? text.slice(before) : text
    said.set(id, whole ? text.length : before + text.length)
    return next ? { text: gap + next } : {}
  }

  return (line) => {
    const event = eventIn(line)
    const params = record(event?.params)
    if (!event || !params) return {}

    switch (event.method) {
      case 'item/agentMessage/delta':
        return typeof params.delta === 'string'
          ? more(text(params.itemId), params.delta, false)
          : {}

      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        return typeof params.delta === 'string' && params.delta ? { thinking: params.delta } : {}

      case 'item/started':
      case 'item/completed': {
        const item = record(params.item)
        const done = event.method === 'item/completed'
        if (item?.type === 'agentMessage' && done && typeof item.text === 'string')
          return more(text(item.id), item.text, true)
        if (item?.type === 'mcpToolCall') return toolIn(item, done)
        if (item?.type === 'contextCompaction' && done) return { compacted: true }
        return {}
      }

      case 'thread/compacted':
        return { compacted: true }

      case 'thread/goal/updated': {
        const goal = goalIn(record(params.goal)?.status)
        return goal ? { goal } : {}
      }

      case 'thread/goal/cleared':
        return { goal: 'cleared' }

      case 'thread/tokenUsage/updated': {
        const usage = record(params.tokenUsage)
        return { usage: countsIn(record(usage?.last), usage?.modelContextWindow) }
      }

      case 'account/rateLimits/updated': {
        const limit = limitIn(record(params.rateLimits))
        return limit ? { limit } : {}
      }

      case 'error':
        return params.willRetry === true ? {} : trouble(record(params.error))

      case 'turn/completed': {
        const turn = record(params.turn)
        if (turn?.status === 'completed') return { ended: 'end' }
        if (turn?.status === 'interrupted') return { ended: 'stopped' }
        return { ended: 'error', ...trouble(record(turn?.error)) }
      }

      default:
        return {}
    }
  }
}

/** Where Codex's own goal stands, in nib's words: `complete` is met, a limit or a block
 *  holds it the way a pause does, and `budgetLimited` is its own end. */
function goalIn(status: unknown): GoalState | null {
  switch (status) {
    case 'active':
      return 'pursuing'
    case 'complete':
      return 'met'
    case 'budgetLimited':
      return 'budget_limited'
    case 'paused':
    case 'blocked':
    case 'usageLimited':
      return 'paused'
    default:
      return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One of nib's tools, called: started, or answered. A tool of another server is not
 *  nib's and has no row; with `nib` the only server there is none. */
function toolIn(item: Record<string, unknown>, done: boolean): Heard {
  if (item.server !== 'nib' || typeof item.id !== 'string' || typeof item.tool !== 'string')
    return {}
  const tool = { id: item.id, name: item.tool, args: item.arguments ?? {} }
  if (!done) return { tool }
  const result = record(item.result)
  const failed = record(item.error)
  const words = Array.isArray(result?.content)
    ? result.content
        .map((one) => record(one))
        .map((one) => (one?.type === 'text' ? text(one.text) : ''))
        .join('\n')
    : text(failed?.message)
  return {
    tool: { ...tool, done: { text: words, error: item.status === 'failed' || !!failed } },
  }
}

/** The counts of the request that ended: OpenAI's input already holds the cached part. */
function countsIn(last: Record<string, unknown> | null, window: unknown): Counted {
  const number = (key: string) => (typeof last?.[key] === 'number' ? last[key] : 0)
  return {
    input: number('inputTokens'),
    cached: number('cachedInputTokens'),
    output: number('outputTokens'),
    reasoning: number('reasoningOutputTokens'),
    ...(typeof window === 'number' && window > 0 ? { window } : {}),
  }
}

/** Where the plan stands, out of a rate-limit snapshot: the fuller of its two windows. */
function limitIn(limits: Record<string, unknown> | null): Limit | null {
  if (!limits) return null
  const windows = [record(limits.primary), record(limits.secondary)].filter(
    (one): one is Record<string, unknown> => typeof one?.usedPercent === 'number',
  )
  const fullest = windows.sort((a, b) => Number(b.usedPercent) - Number(a.usedPercent))[0]
  if (!fullest && !limits.rateLimitReachedType) return null
  const used = Number(fullest?.usedPercent ?? 100)
  const state =
    limits.rateLimitReachedType || used >= 100 ? 'reached' : used >= NEAR ? 'near' : 'fine'
  const until = typeof fullest?.resetsAt === 'number' ? fullest.resetsAt * 1000 : null
  return { state, until, untilWords: null }
}

/** A turn's error, as Codex said it. */
function trouble(error: Record<string, unknown> | null): Heard {
  const words = text(error?.message)
  if (!words) return {}
  const limited = error?.codexErrorInfo === 'usageLimitExceeded' || saysLimit(words)
  return {
    trouble: words,
    ...(saysSignedOut(words) || error?.codexErrorInfo === 'unauthorized'
      ? { signedOut: true }
      : {}),
    ...(limited ? { limit: { state: 'reached', until: null, untilWords: againAt(words) } } : {}),
  }
}

/** When Codex says a plan may be used again, as it wrote it: "try again at 3:05 PM",
 *  "try again in 2 days 3 hours". */
export function againAt(words: string): string | null {
  const found = /try again (?:at|in) ([^.]+?)\.?$/i.exec(words.trim())
  return found?.[1]?.trim() ?? null
}
