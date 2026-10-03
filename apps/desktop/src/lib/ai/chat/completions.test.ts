/** Chat completions against OpenAI's own recorded stream: two calls arriving in pieces
 *  by index, and the usage asked for at the end. */

import { describe, expect, test } from 'vitest'
import { chatMessagesOf, completions } from './completions'
import { events } from './recorded/read'
import type { ModelInfo } from './types'
import type { Ask } from './wire'

const MODEL: ModelInfo = {
  id: 'llama',
  name: 'llama',
  window: 8_192,
  efforts: ['auto', 'low', 'high'],
  images: false,
  fast: false,
}

function ask(change: Partial<Ask> = {}): Ask {
  return {
    provider: {
      id: 'compatible-1',
      kind: 'compatible',
      name: 'Ollama',
      model: '',
      baseUrl: 'http://127.0.0.1:11434',
    },
    model: MODEL,
    effort: 'auto',
    fast: false,
    system: 'Be brief.',
    tools: [{ name: 'read_note', description: 'Reads a note.', inputSchema: { type: 'object' } }],
    steps: [{ role: 'user', text: 'hi', images: [] }],
    added: [],
    web: false,
    perMessage: false,
    ...change,
  }
}

describe('a recorded stream of calls', () => {
  test('is one tool part a call, each whole by the end', () => {
    const reader = completions.reader(MODEL.window)
    const heard = events('completions-1').map((one) => reader.heard(one))
    const answer = reader.answer()
    expect(answer.ending).toBe('tool')
    expect(answer.calls.map((one) => one.args)).toEqual([{ path: 'Birds.md' }, { path: 'Fish.md' }])
    expect(reader.parts.map((one) => (one.kind === 'tool' ? one.verb : one.kind))).toEqual([
      'read_note',
      'read_note',
    ])
    expect(heard.filter((one) => one.usage).at(-1)?.usage).toMatchObject({
      input: 51,
      output: 47,
      window: 8_192,
    })
    expect(answer.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: answer.calls.map((one) => ({
          id: one.id,
          type: 'function',
          function: { name: 'read_note', arguments: JSON.stringify(one.args) },
        })),
      },
    ])
  })

  test('thinking comes from whichever field the server writes it in', () => {
    const reader = completions.reader(null)
    reader.heard({ choices: [{ delta: { reasoning_content: 'Hm' } }] })
    reader.heard({ choices: [{ delta: { reasoning: ', yes.' } }] })
    reader.heard({ choices: [{ delta: { content: 'Yes.' }, finish_reason: 'stop' }] })
    expect(reader.parts.map((one) => one.kind)).toEqual(['thinking', 'text'])
    expect(reader.parts[0]).toMatchObject({ text: 'Hm, yes.' })
    expect(reader.answer().ending).toBe('end')
  })

  test('OpenRouter’s cost is counted where it reports one', () => {
    const reader = completions.reader(null)
    const said = reader.heard({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0004 },
    })
    expect(said.usage).toMatchObject({ input: 10, output: 2, cost: 0.0004 })
  })
})

describe('the request', () => {
  test('is the loopback address the policy allows, with usage and tools', () => {
    const { url, body } = completions.request(ask())
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_note',
            description: 'Reads a note.',
            parameters: { type: 'object' },
          },
        },
      ],
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  test('effort is reasoning_effort where one was picked', () => {
    expect(completions.request(ask({ effort: 'high' })).body).toMatchObject({
      reasoning_effort: 'high',
    })
  })

  test('a tool’s answer goes back as words, its pictures said', () => {
    expect(
      chatMessagesOf('', [
        {
          role: 'tool',
          results: [
            {
              id: 'c',
              name: 'x',
              output: { text: 'seen', images: [{ mime: 'image/png', data: 'A' }], error: false },
            },
          ],
        },
      ]),
    ).toEqual([{ role: 'tool', tool_call_id: 'c', content: 'seen\n[1 picture(s)]' }])
  })
})
