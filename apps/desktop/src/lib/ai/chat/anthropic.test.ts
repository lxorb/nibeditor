/** Claude's adapter against its streaming shapes: the parts as they arrive, the blocks
 *  sent back byte for byte, and the request each thread setting makes. */

import { describe, expect, test } from 'vitest'
import { anthropic, messagesOf, PER_MESSAGE_BETA } from './anthropic'
import { events } from './recorded/read'
import type { Ask } from './wire'
import type { ModelInfo } from './types'

const MODEL: ModelInfo = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5',
  window: 1_000_000,
  efforts: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
  images: true,
  fast: true,
  output: 128_000,
  thinking: true,
  compaction: true,
}

function ask(change: Partial<Ask> = {}): Ask {
  return {
    provider: { id: 'anthropic', kind: 'anthropic', name: 'Claude', model: '' },
    model: MODEL,
    effort: 'high',
    fast: false,
    system: 'Be brief.',
    tools: [{ name: 'read_note', description: 'Reads a note.', inputSchema: { type: 'object' } }],
    steps: [{ role: 'user', text: 'What is in Birds.md?', images: [] }],
    added: [],
    web: false,
    perMessage: false,
    ...change,
  }
}

function read(name: string) {
  const reader = anthropic.reader(MODEL.window)
  const heard = events(name).map((one) => reader.heard(one))
  return { reader, heard, answer: reader.answer() }
}

describe('a streamed message', () => {
  test('arrives as thinking, words and a call, in order', () => {
    const { reader } = read('anthropic-1')
    expect(reader.parts.map((one) => one.kind)).toEqual(['thinking', 'text', 'tool'])
    expect(reader.parts[0]).toMatchObject({ text: 'The reader wants the note read first.' })
    expect(reader.parts[1]).toMatchObject({ text: 'Reading it now.' })
    expect(reader.parts[2]).toMatchObject({
      verb: 'read_note',
      args: { path: 'Birds.md' },
      state: 'running',
    })
  })

  test('keeps every block whole for the next request, the thinking’s signature included', () => {
    const { answer } = read('anthropic-1')
    expect(answer.ending).toBe('tool')
    expect(answer.calls).toEqual([
      { id: 'toolu_01', name: 'read_note', args: { path: 'Birds.md' } },
    ])
    expect(answer.messages).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'The reader wants the note read first.',
            signature: 'EqQBCgIYAhIM',
          },
          { type: 'text', text: 'Reading it now.' },
          { type: 'tool_use', id: 'toolu_01', name: 'read_note', input: { path: 'Birds.md' } },
        ],
      },
    ])
  })

  test('counts the cache into what was sent, from the provider’s own numbers', () => {
    const { heard } = read('anthropic-1')
    const last = heard.filter((one) => one.usage).at(-1)?.usage
    expect(last).toMatchObject({
      input: 12 + 2048 + 1000,
      cached: 1000,
      output: 89,
      window: 1_000_000,
    })
    expect(heard[0]?.model).toBe('claude-opus-5-5')
  })

  test('an answer with no call ends the turn', () => {
    const { answer, reader } = read('anthropic-2')
    expect(answer.ending).toBe('end')
    expect(reader.parts).toEqual([{ kind: 'text', text: 'Herons stand still, then they do not.' }])
  })

  test('a complaint in the stream is handed up', () => {
    const reader = anthropic.reader(null)
    const said = reader.heard({
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    })
    expect(said.trouble).toBeTruthy()
  })
})

describe('the request', () => {
  test('thinks adaptively and summarised, at the thread’s effort, with tools and a cache point', () => {
    const { body, headers } = anthropic.request(ask())
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      cache_control: { type: 'ephemeral' },
      system: 'Be brief.',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      tools: [
        { name: 'read_note', description: 'Reads a note.', input_schema: { type: 'object' } },
      ],
      max_tokens: 32_000,
    })
    expect(headers).toEqual({})
  })

  test('auto sends no effort, fast asks for the fast tier, @web adds the search tool', () => {
    const { body, headers } = anthropic.request(ask({ effort: 'auto', fast: true, web: true }))
    expect(body).not.toHaveProperty('output_config')
    expect(body).toMatchObject({ speed: 'fast' })
    expect(headers['anthropic-beta']).toContain('fast-mode-2026-02-01')
    expect(JSON.stringify(body)).toContain('web_search_20260209')
  })

  test('a change of effort mid-thread is a message of its own, and the top level stays', () => {
    const { body, headers } = anthropic.request(
      ask({
        perMessage: true,
        base: 'high',
        effort: 'low',
        steps: [
          { role: 'user', text: 'one', images: [] },
          { role: 'assistant', text: 'two', calls: [] },
          { role: 'effort', effort: 'low' },
          { role: 'user', text: 'three', images: [] },
        ],
      }),
    )
    expect(body).toMatchObject({ output_config: { effort: 'high' } })
    const messages = (body as { messages: unknown[] }).messages
    expect(messages[2]).toEqual({ role: 'system', content: [], output_config: { effort: 'low' } })
    expect(headers['anthropic-beta']).toContain(PER_MESSAGE_BETA)
  })

  test('a model with no adaptive thinking is asked without it', () => {
    const { body } = anthropic.request(ask({ model: { ...MODEL, thinking: false, output: 8_000 } }))
    expect(body).not.toHaveProperty('thinking')
    expect(body).toMatchObject({ max_tokens: 8_000 })
  })

  test('a request carrying a compaction block says the beta', () => {
    const { headers, body } = anthropic.request(
      ask({
        steps: [
          { role: 'compacted', block: { type: 'compaction', content: 'so far', signature: 's' } },
          { role: 'user', text: 'next', images: [] },
        ],
      }),
    )
    expect(headers['anthropic-beta']).toContain('compact-2026-09-04')
    expect((body as { messages: unknown[] }).messages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'compaction', content: 'so far', signature: 's' }],
    })
  })
})

describe('a turn rebuilt from its parts', () => {
  test('is calls and their answers, pictures and errors included', () => {
    const messages = messagesOf([
      { role: 'user', text: 'look', images: [{ mime: 'image/png', data: 'AAAA' }] },
      {
        role: 'assistant',
        text: 'Looking.',
        calls: [{ id: 't1', name: 'read_note', args: { path: 'a.md' } }],
      },
      {
        role: 'tool',
        results: [
          { id: 't1', name: 'read_note', output: { text: 'gone', images: [], error: true } },
        ],
      },
      { role: 'assistant', text: '', calls: [] },
    ])
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'look' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 't1', name: 'read_note', input: { path: 'a.md' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            is_error: true,
            content: [{ type: 'text', text: 'gone' }],
          },
        ],
      },
    ])
  })
})
