/** The Responses adapter against OpenAI's own recorded streams: a call, then its answer
 *  sent back the way this adapter sends it, which OpenAI accepted. */

import { describe, expect, test } from 'vitest'
import { events } from './recorded/read'
import { itemsOf, responses } from './responses'
import type { ModelInfo } from './types'
import type { Ask } from './wire'

const MODEL: ModelInfo = {
  id: 'gpt-5.4-mini',
  name: 'gpt-5.4-mini',
  window: null,
  efforts: ['auto', 'off', 'low', 'medium', 'high', 'xhigh'],
  images: true,
  fast: true,
}

function ask(change: Partial<Ask> = {}): Ask {
  return {
    provider: { id: 'openai', kind: 'openai', name: 'OpenAI', model: '' },
    model: MODEL,
    effort: 'low',
    fast: false,
    system: 'You are a terse assistant.',
    tools: [{ name: 'read_note', description: 'Reads a note.', inputSchema: { type: 'object' } }],
    steps: [{ role: 'user', text: 'Read the note Birds.md.', images: [] }],
    added: [],
    web: false,
    perMessage: false,
    ...change,
  }
}

function read(name: string) {
  const reader = responses.reader(400_000)
  const heard = events(name).map((one) => reader.heard(one))
  return { reader, heard, answer: reader.answer() }
}

describe('a recorded call', () => {
  test('is a running tool part with its whole arguments', () => {
    const { reader, answer } = read('responses-1')
    expect(reader.parts).toEqual([
      {
        kind: 'tool',
        id: 'call_whhAkk5hpS3jCjQyaLDk7f1G',
        verb: 'read_note',
        args: { path: 'Birds.md' },
        state: 'running',
      },
    ])
    expect(answer.ending).toBe('tool')
    expect(answer.calls).toEqual([
      { id: 'call_whhAkk5hpS3jCjQyaLDk7f1G', name: 'read_note', args: { path: 'Birds.md' } },
    ])
  })

  test('keeps the encrypted reasoning for the next request, without the ids nothing stored', () => {
    const { answer } = read('responses-1')
    const items = answer.messages as Record<string, unknown>[]
    expect(items.map((one) => one.type)).toEqual(['reasoning', 'function_call'])
    expect(typeof items[0]?.encrypted_content).toBe('string')
    for (const item of items) {
      expect(item).not.toHaveProperty('id')
      expect(item).not.toHaveProperty('status')
    }
  })
})

describe('the recorded answer to it', () => {
  test('streams its words and counts what it cost', () => {
    const { reader, answer, heard } = read('responses-2')
    expect(reader.parts).toEqual([
      { kind: 'text', text: 'It says herons stand still for a long time, then suddenly don’t.' },
    ])
    expect(answer.ending).toBe('end')
    const usage = heard.filter((one) => one.usage).at(-1)?.usage
    expect(usage).toEqual({ input: 129, cached: 0, output: 20, reasoning: 0, window: 400_000 })
    expect(heard.find((one) => one.model)?.model).toBe('gpt-5.4-mini-2026-03-17')
  })
})

describe('the request', () => {
  test('is stored nowhere and streamed, with reasoning, its summary and its carry-over', () => {
    const { url, body } = responses.request(ask())
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(body).toMatchObject({
      model: 'gpt-5.4-mini',
      instructions: 'You are a terse assistant.',
      store: false,
      stream: true,
      reasoning: { effort: 'low', summary: 'auto' },
      include: ['reasoning.encrypted_content'],
      tools: [
        {
          type: 'function',
          name: 'read_note',
          description: 'Reads a note.',
          parameters: { type: 'object' },
        },
      ],
    })
  })

  test('off is none, auto is nothing, fast is the priority tier on a key', () => {
    expect(responses.request(ask({ effort: 'off' })).body).toMatchObject({
      reasoning: { effort: 'none' },
    })
    const auto = responses.request(ask({ effort: 'auto', fast: true })).body as Record<
      string,
      unknown
    >
    expect(auto.reasoning).toEqual({ summary: 'auto' })
    expect(auto.service_tier).toBe('priority')
  })

  test('a plan’s tools sit in one namespace, and it is never asked for a tier', () => {
    const plan = responses.request(
      ask({ provider: { id: 'chatgpt', kind: 'chatgpt', name: 'ChatGPT', model: '' }, fast: true }),
    ).body as Record<string, unknown>
    expect(plan.tools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'nib',
        tools: [
          {
            type: 'function',
            name: 'read_note',
            description: 'Reads a note.',
            parameters: { type: 'object' },
          },
        ],
      }),
    ])
    expect(plan).not.toHaveProperty('service_tier')
    expect(plan).not.toHaveProperty('max_output_tokens')
    expect(plan).toMatchObject({ store: false, stream: true })
  })

  test('the answer to a call goes back as its output, pictures as data', () => {
    const items = responses.results([
      {
        call: { id: 'c1', name: 'read_note', args: {} },
        output: { text: 'words', images: [], error: false },
      },
      {
        call: { id: 'c2', name: 'browser_screenshot', args: {} },
        output: { text: 'a picture', images: [{ mime: 'image/png', data: 'AAAA' }], error: false },
      },
    ])
    expect(items).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: 'words' },
      {
        type: 'function_call_output',
        call_id: 'c2',
        output: [
          { type: 'input_text', text: 'a picture' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        ],
      },
    ])
  })

  test('a turn rebuilt from its parts is a message, its calls and their outputs', () => {
    expect(
      itemsOf([
        {
          role: 'assistant',
          text: 'Reading.',
          calls: [{ id: 'c1', name: 'read_note', args: { path: 'a.md' } }],
        },
        {
          role: 'tool',
          results: [
            { id: 'c1', name: 'read_note', output: { text: 'A', images: [], error: false } },
          ],
        },
      ]),
    ).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: 'Reading.' }] },
      { type: 'function_call', call_id: 'c1', name: 'read_note', arguments: '{"path":"a.md"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'A' },
    ])
  })
})
