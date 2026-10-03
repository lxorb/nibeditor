/** Codex's app-server notifications, in the shapes `codex app-server generate-ts` gives
 *  them (0.160.0), as the crate hands them on for one thread. */

import { describe, expect, test } from 'vitest'
import { againAt, codexReader } from './codex'

const said = (method: string, params: object) => JSON.stringify({ method, params })
const turn = { threadId: 't', turnId: 'u' }

describe('an answer', () => {
  test('streams as deltas and is not said again when its item completes', () => {
    const read = codexReader()
    const heard = [
      said('turn/started', { threadId: 't', turn: { id: 'u', status: 'inProgress' } }),
      said('item/started', { ...turn, item: { type: 'agentMessage', id: 'a', text: '' } }),
      said('item/agentMessage/delta', { ...turn, itemId: 'a', delta: 'Herons ' }),
      said('item/agentMessage/delta', { ...turn, itemId: 'a', delta: 'wait.' }),
      said('item/completed', {
        ...turn,
        item: { type: 'agentMessage', id: 'a', text: 'Herons wait.' },
      }),
      said('turn/completed', { threadId: 't', turn: { id: 'u', status: 'completed' } }),
    ].map(read)

    expect(heard.map((one) => one.text ?? '').join('')).toBe('Herons wait.')
    expect(heard.at(-1)?.ended).toBe('end')
  })

  test('is the whole message where no delta came, and a second one is a new paragraph', () => {
    const read = codexReader()
    const text = [
      said('item/completed', { ...turn, item: { type: 'agentMessage', id: 'a', text: 'One.' } }),
      said('item/completed', { ...turn, item: { type: 'agentMessage', id: 'b', text: 'Two.' } }),
    ]
      .map(read)
      .map((one) => one.text ?? '')
      .join('')
    expect(text).toBe('One.\n\nTwo.')
  })

  test('thinks in its reasoning summary', () => {
    const read = codexReader()
    expect(
      read(said('item/reasoning/summaryTextDelta', { ...turn, itemId: 'r', delta: 'Hmm.' }))
        .thinking,
    ).toBe('Hmm.')
  })

  test('calls nib’s tools and hears their answers', () => {
    const read = codexReader()
    const item = {
      type: 'mcpToolCall',
      id: 'c',
      server: 'nib',
      tool: 'read_note',
      arguments: { path: 'Herons.md' },
    }
    expect(
      read(said('item/started', { ...turn, item: { ...item, status: 'inProgress' } })).tool,
    ).toEqual({
      id: 'c',
      name: 'read_note',
      args: { path: 'Herons.md' },
    })
    const done = read(
      said('item/completed', {
        ...turn,
        item: {
          ...item,
          status: 'completed',
          result: { content: [{ type: 'text', text: 'Herons wade.' }] },
        },
      }),
    ).tool
    expect(done?.done).toEqual({ text: 'Herons wade.', error: false })

    const other = { ...item, server: 'somebody-else' }
    expect(read(said('item/started', { ...turn, item: other }))).toEqual({})
  })

  test('counts what the request took, and the model’s window', () => {
    const read = codexReader()
    const last = {
      totalTokens: 530,
      inputTokens: 500,
      cachedInputTokens: 100,
      cacheWriteInputTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
    }
    expect(
      read(
        said('thread/tokenUsage/updated', {
          ...turn,
          tokenUsage: { total: last, last, modelContextWindow: 272000 },
        }),
      ).usage,
    ).toEqual({ input: 500, cached: 100, output: 30, reasoning: 10, window: 272000 })
  })

  test('a compaction is said', () => {
    const read = codexReader()
    expect(
      read(said('item/completed', { ...turn, item: { type: 'contextCompaction', id: 'x' } }))
        .compacted,
    ).toBe(true)
  })
})

describe('the plan', () => {
  test('stands where its fuller window says', () => {
    const read = codexReader()
    const limit = (primary: number, secondary: number) =>
      read(
        said('account/rateLimits/updated', {
          rateLimits: {
            primary: { usedPercent: primary, windowDurationMins: 300, resetsAt: 1790819400 },
            secondary: { usedPercent: secondary, windowDurationMins: 10080, resetsAt: 1790900000 },
          },
        }),
      ).limit
    expect(limit(10, 20)).toEqual({ state: 'fine', until: 1790900000_000, untilWords: null })
    expect(limit(85, 20)?.state).toBe('near')
    expect(limit(100, 20)?.state).toBe('reached')
  })
})

describe('a failure', () => {
  const LIMIT =
    "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:05 PM."

  test('the plan at its limit says when, as Codex wrote it', () => {
    const heard = codexReader()(
      said('turn/completed', {
        threadId: 't',
        turn: {
          id: 'u',
          status: 'failed',
          error: { message: LIMIT, codexErrorInfo: 'usageLimitExceeded' },
        },
      }),
    )
    expect(heard.ended).toBe('error')
    expect(heard.trouble).toBe(LIMIT)
    expect(heard.limit).toEqual({ state: 'reached', until: null, untilWords: '3:05 PM' })
  })

  test('an error is read, one Codex will retry is not, and signed out is told apart', () => {
    const read = codexReader()
    const error = { message: 'Not logged in. Run codex login.', codexErrorInfo: null }
    expect(read(said('error', { ...turn, error, willRetry: true }))).toEqual({})
    expect(read(said('error', { ...turn, error, willRetry: false })).signedOut).toBe(true)
  })

  test('an interrupted turn stopped', () => {
    expect(
      codexReader()(
        said('turn/completed', { threadId: 't', turn: { id: 'u', status: 'interrupted' } }),
      ).ended,
    ).toBe('stopped')
  })

  test('when to try again, in either of its spellings', () => {
    expect(againAt('Try again in 2 days 3 hours.')).toBe('2 days 3 hours')
    expect(againAt("You've hit your usage limit. Try again later.")).toBeNull()
  })

  test('reads past a line that is not a notification', () => {
    expect(codexReader()('WARNING: proceeding')).toEqual({})
  })
})
