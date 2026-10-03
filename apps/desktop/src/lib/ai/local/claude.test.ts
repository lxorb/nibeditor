/** Claude Code's stream-json, as 2.1.280 printed it for "say ok" on 2026-09-30, trimmed
 *  to the fields that are read and with its ids made up. */

import { describe, expect, test } from 'vitest'
import { claudeReader } from './claude'
import type { Heard } from './heard'

const SAID = [
  '{"type":"system","subtype":"init","cwd":"C:\\\\ai","session_id":"s","tools":[],"mcp_servers":[],"model":"claude-opus-5-5[1m]","permissionMode":"auto"}',
  '{"type":"system","subtype":"status","status":"requesting","session_id":"s"}',
  '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-5-5","id":"m","type":"message","role":"assistant","content":[]}},"session_id":"s","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"s","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"o"}},"session_id":"s","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"k"}},"session_id":"s","parent_tool_use_id":null}',
  '{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"ok"}]},"parent_tool_use_id":null,"session_id":"s"}',
  '{"type":"stream_event","event":{"type":"message_stop"},"session_id":"s","parent_tool_use_id":null}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790819400,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.26,"resetsAt":1790819400}}},"session_id":"s"}',
  '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s","total_cost_usd":0.004}',
]

function readAll(lines: readonly string[]): Heard[] {
  const read = claudeReader()
  return lines.map(read)
}

describe('an answer', () => {
  test('arrives delta by delta, once, with the model named without its [1m]', () => {
    const heard = readAll(SAID)
    expect(heard.map((one) => one.text ?? '').join('')).toBe('ok')
    expect(heard.find((one) => one.model)?.model).toBe('claude-opus-5-5')
    expect(heard.some((one) => one.trouble)).toBe(false)
  })

  test('says where the plan stands', () => {
    const limit = readAll(SAID).find((one) => one.limit)?.limit
    expect(limit).toEqual({ state: 'fine', until: 1790819400_000, untilWords: null })
  })

  test('is the whole message where a version printed no deltas', () => {
    const plain = SAID.filter((line) => !line.includes('content_block_delta'))
    expect(
      readAll(plain)
        .map((one) => one.text ?? '')
        .join(''),
    ).toBe('ok')
  })

  test('never takes words from a subagent', () => {
    const read = claudeReader()
    expect(
      read(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"inner"}]},"parent_tool_use_id":"t"}',
      ),
    ).toEqual({})
  })

  test('reads past a line that is not an event', () => {
    const read = claudeReader()
    expect(read('Update available: 2.1.281')).toEqual({})
    expect(read('')).toEqual({})
  })
})

describe('a failure', () => {
  test('signed out is told apart', () => {
    const read = claudeReader()
    const heard = read(
      '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}',
    )
    expect(heard.trouble).toBe('Not logged in · Please run /login')
    expect(heard.signedOut).toBe(true)
  })

  test('the plan at its limit carries when it resets', () => {
    const read = claudeReader()
    expect(
      read(
        '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790819400,"rateLimitType":"five_hour"}}',
      ).limit,
    ).toEqual({ state: 'reached', until: 1790819400_000, untilWords: null })
    expect(
      read(
        '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1}}',
      ).limit?.state,
    ).toBe('near')
    expect(
      read('{"type":"result","is_error":true,"result":"You\'ve hit your limit · resets 3pm"}').limit
        ?.state,
    ).toBe('reached')
  })

  test('an error with no words is its subtype', () => {
    const read = claudeReader()
    expect(
      read('{"type":"result","subtype":"error_during_execution","is_error":true}').trouble,
    ).toBe('error_during_execution')
  })
})

describe('a session turn', () => {
  test('thinks, calls nib’s tools by their own names and hears their answers', () => {
    const read = claudeReader()
    expect(
      read(
        '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm."}}}',
      ).thinking,
    ).toBe('Hmm.')
    expect(
      read(
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"u1","name":"mcp__nib__read_note","input":{"path":"Herons.md"}}]}}',
      ).tool,
    ).toEqual({ id: 'u1', name: 'read_note', args: { path: 'Herons.md' } })
    expect(
      read(
        '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"u1","content":[{"type":"text","text":"Herons wade."}]}]}}',
      ).tool,
    ).toEqual({ id: 'u1', name: '', done: { text: 'Herons wade.', error: false } })
  })

  test('counts the request, and learns the window from the result', () => {
    const read = claudeReader()
    expect(
      read(
        '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":20,"cache_read_input_tokens":500,"cache_creation_input_tokens":10,"output_tokens":1}}}}',
      ).usage,
    ).toEqual({ input: 530, cached: 500, output: 1 })
    expect(
      read('{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":42}}}')
        .usage,
    ).toEqual({ input: 530, cached: 500, output: 42 })
    const end = read(
      '{"type":"result","subtype":"success","is_error":false,"modelUsage":{"claude-opus-5-5":{"contextWindow":1000000}}}',
    )
    expect(end.ended).toBe('end')
    expect(end.usage).toEqual({ input: 530, cached: 500, output: 42, window: 1000000 })
  })

  test('a compaction is said, and a failed turn ends in error', () => {
    const read = claudeReader()
    expect(read('{"type":"system","subtype":"compact_boundary"}').compacted).toBe(true)
    expect(read('{"type":"result","subtype":"error_during_execution","is_error":true}').ended).toBe(
      'error',
    )
  })
})
