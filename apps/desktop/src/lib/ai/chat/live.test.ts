/** The engine against OpenAI itself, read-only and only when asked: a key in
 *  `NIB_OPENAI_LIVE_KEY`, read at call time and never written anywhere. Skipped
 *  everywhere else, CI included, the way `cargo test real_claude -- --ignored` is.
 *
 *  It proves what a recording cannot: that a request built here is one the provider
 *  accepts - the replayed items, the namespace-free tools, the effort refused and
 *  stepped, the compaction swapped in. */

import { describe, expect, test, vi } from 'vitest'

const KEY = process.env.NIB_OPENAI_LIVE_KEY ?? ''

vi.mock('../keys', () => ({
  readKey: () => Promise.resolve(process.env.NIB_OPENAI_LIVE_KEY ?? ''),
}))

const { createApiEngine } = await import('./engine')
const { newThread } = await import('./threads')

import type { Provider } from '../providers'
import type { EngineEvent, Thread } from './types'
import type { Tools } from './tools'

const PROVIDERS: Provider[] = [
  { id: 'openai', kind: 'openai', name: 'OpenAI', model: '' },
  {
    id: 'compatible-live',
    kind: 'compatible',
    name: 'OpenAI as a server',
    model: '',
    baseUrl: 'https://api.openai.com',
  },
]

const tools: Tools = {
  list: () =>
    Promise.resolve({
      instructions: '',
      tools: [
        {
          name: 'read_note',
          description: 'Reads one of the reader’s notes by its path.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
    }),
  context: () => Promise.resolve('Space: Birds. In front: Birds.md.'),
  call: () =>
    Promise.resolve({
      text: 'Herons stand still for a long time. Then they do not.',
      images: [],
      error: false,
    }),
}

const engine = createApiEngine({
  provider: (id) => PROVIDERS.find((one) => one.id === id) ?? null,
  tools,
})

async function send(thread: Thread, text: string) {
  const heard: EngineEvent[] = []
  await engine.send(
    thread,
    { text, attachments: [] },
    (event) => heard.push(event),
    new AbortController().signal,
  )
  return heard.at(-1)
}

describe.skipIf(!KEY)('OpenAI, live', () => {
  test(
    'a call, its answer, a second message over the replayed turn, and an effort stepped',
    { timeout: 120_000 },
    async () => {
      const thread = newThread('space', 'openai', 'gpt-5.4-mini', 'max', 'agent')
      expect(
        await send(
          thread,
          'Read the note Birds.md, then tell me in one short sentence what it says.',
        ),
      ).toEqual({
        type: 'done',
        stop: 'end',
      })
      expect(thread.effort).toBe('xhigh')
      const model = thread.turns[1]
      expect(model?.parts.some((one) => one.kind === 'tool' && one.state === 'ok')).toBe(true)
      expect(model?.replay?.messages.length).toBeGreaterThan(1)
      expect(await send(thread, 'And in three words?')).toEqual({ type: 'done', stop: 'end' })
      expect(thread.usage.input).toBeGreaterThan(0)

      await engine.compact(thread)
      expect(thread.compaction?.kind).toBe('responses')
      expect(await send(thread, 'What did the note say?')).toEqual({ type: 'done', stop: 'end' })
    },
  )

  test(
    'chat completions with tools, as a compatible server speaks them',
    { timeout: 120_000 },
    async () => {
      const thread = newThread('space', 'compatible-live', 'gpt-4.1-mini', 'auto', 'agent')
      expect(await send(thread, 'Read Birds.md and say what it says, briefly.')).toEqual({
        type: 'done',
        stop: 'end',
      })
      expect(thread.turns[1]?.parts.some((one) => one.kind === 'tool' && one.state === 'ok')).toBe(
        true,
      )
      await engine.compact(thread)
      expect(thread.compaction?.kind).toBe('summary')
      expect(await send(thread, 'And again, in three words?')).toEqual({
        type: 'done',
        stop: 'end',
      })
    },
  )
})
