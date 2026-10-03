/** The engine for Claude Code and Codex, against a stand-in for the crate: sessions are
 *  opened and talked to through `invoke`, and each program's lines arrive on the channel
 *  the way `ai_cli_open`'s do. What a program prints is the shape claude.ts and codex.ts
 *  read, measured on 2.1.280 and generated from the app-server's own protocol. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Draft, EngineEvent, Thread } from '../chat/types'
import type { Provider } from '../providers'

class FakeChannel {
  onmessage: (value: unknown) => void = () => undefined
}

interface Open {
  id: string
  opening: Record<string, unknown>
  channel: FakeChannel
  said: Record<string, unknown>[]
  closed: boolean
}

/** Every session opened, and how each test has the program answer a turn. */
let opened: Open[] = []
let answer: (open: Open, said: Record<string, unknown>) => string[] = () => []
let listed: unknown = null

const line = (channel: FakeChannel, text: string) => channel.onmessage({ kind: 'line', line: text })

async function fakeInvoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (command === 'ai_cli_models') return listed
  if (command === 'ai_cli_open') {
    opened.push({
      id: String(args.id),
      opening: args.opening as Record<string, unknown>,
      channel: args.output as FakeChannel,
      said: [],
      closed: false,
    })
    return null
  }
  const open = opened.find((one) => one.id === args.id)
  if (!open) throw new Error(`${String(args.id)} is not open`)
  if (command === 'ai_cli_close') {
    open.closed = true
    open.channel.onmessage({ kind: 'end', code: null, timedOut: false, stopped: true, err: '' })
    return null
  }
  if (command === 'ai_cli_say') {
    const said = args.say as Record<string, unknown>
    open.said.push(said)
    // Lines arrive after the command answered, as the crate's do.
    setTimeout(() => {
      for (const one of answer(open, said)) line(open.channel, one)
    }, 0)
  }
  return null
}

vi.mock('../../native', () => ({ Channel: FakeChannel }))
vi.mock('../../tauri', async (original) => ({
  ...(await original<typeof import('../../tauri')>()),
  invoke: fakeInvoke,
  isDesktop: true,
}))

const { createLocalEngine } = await import('./engine')

const CLAUDE: Provider = { id: 'cc', kind: 'claude-code', name: 'Claude Code', model: '' }
const CODEX: Provider = { id: 'cx', kind: 'codex', name: 'Codex', model: '' }

function thread(provider: Provider, extra: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    space: 'Notes',
    title: '',
    provider: provider.id,
    model: '',
    effort: 'auto',
    mode: 'ask',
    turns: [],
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
    created: 0,
    updated: 0,
    ...extra,
  }
}

const draft = (text: string): Draft => ({ text, attachments: [] })

function engine(provider: Provider, instructions = '') {
  return createLocalEngine(provider.kind === 'codex' ? 'codex' : 'claude-code', {
    provider: (id) => (id === provider.id ? provider : null),
    instructions: () => Promise.resolve(instructions),
  })
}

async function send(
  provider: Provider,
  on: Thread,
  text: string,
  built = engine(provider),
  signal = new AbortController().signal,
) {
  const events: EngineEvent[] = []
  await built.send(on, draft(text), (event) => events.push(event), signal)
  return events
}

const claudeTurn = (text: string, window = 200000) => [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5[1m]' }),
  JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        model: 'claude-opus-5-5',
        usage: { input_tokens: 100, cache_read_input_tokens: 20 },
      },
    },
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm.' } },
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'u1', name: 'mcp__nib__read_note', input: { path: 'Herons.md' } },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'Herons wade.' }] },
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'message_delta', usage: { output_tokens: 9 } },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    modelUsage: { 'claude-opus-5-5': { contextWindow: window } },
  }),
]

beforeEach(() => {
  opened = []
  listed = null
  answer = (_, said) => (said.kind === 'turn' ? claudeTurn('Herons wait.') : [])
})

describe('a Claude Code thread', () => {
  test('streams thinking, a row per tool call and the words, with the program’s counts', async () => {
    const on = thread(CLAUDE)
    const events = await send(CLAUDE, on, 'what waits?')

    const answer = on.turns.at(-1)
    expect(answer?.parts.map((part) => part.kind)).toEqual(['thinking', 'tool', 'text'])
    expect(answer?.parts[1]).toMatchObject({ verb: 'read_note', state: 'ok' })
    expect(answer?.parts[2]).toEqual({ kind: 'text', text: 'Herons wait.' })
    expect(on.usage).toEqual({ input: 120, cached: 20, output: 9, reasoning: 0, window: 200000 })
    expect(events.find((one) => one.type === 'model')).toEqual({
      type: 'model',
      model: 'claude-opus-5-5',
    })
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'end' })
    expect(on.title).toBe('what waits?')
  })

  test('opens one session with nib’s tools in the thread’s mode, and keeps it', async () => {
    const built = engine(CLAUDE)
    const on = thread(CLAUDE, { model: 'opus', effort: 'high' })
    await send(CLAUDE, on, 'one', built)
    on.model = 'sonnet'
    on.effort = 'max'
    await send(CLAUDE, on, 'two', built)

    expect(opened).toHaveLength(1)
    expect(opened[0]?.opening).toEqual({
      tool: 'claude-code',
      agent: { id: 'cc', name: 'Claude Code' },
      mode: 'ask',
      model: 'opus',
      effort: 'high',
    })
    expect(opened[0]?.said.map((one) => one.kind)).toEqual(['turn', 'model', 'effort', 'turn'])
    expect(opened[0]?.said[1]).toEqual({ kind: 'model', model: 'sonnet' })
    expect(opened[0]?.said[2]).toEqual({ kind: 'effort', effort: 'max' })
    // The second message is the reader's words alone: the session has the rest.
    expect(opened[0]?.said[3]).toEqual({ kind: 'turn', text: 'two', images: [] })
  })

  test('a new mode is a new session, seeded with the instructions and the transcript', async () => {
    const built = engine(CLAUDE, 'File papers under Reading.')
    const on = thread(CLAUDE)
    await send(CLAUDE, on, 'one', built)
    on.mode = 'agent'
    await send(CLAUDE, on, 'two', built)

    expect(opened).toHaveLength(2)
    expect(opened[0]?.closed).toBe(true)
    expect(opened[1]?.opening.mode).toBe('agent')
    expect(opened[1]?.said[0]?.text).toBe(
      [
        '<instructions>\nFile papers under Reading.\n</instructions>',
        '<conversation>\n<user>\none\n</user>\n<assistant>\nHerons wait.\n</assistant>\n</conversation>',
        '<user>\ntwo\n</user>',
      ].join('\n\n'),
    )
  })

  test('a session that ended is opened again and seeded', async () => {
    const built = engine(CLAUDE)
    const on = thread(CLAUDE)
    await send(CLAUDE, on, 'one', built)
    opened[0]?.channel.onmessage({
      kind: 'end',
      code: null,
      timedOut: true,
      stopped: false,
      err: '',
    })
    await send(CLAUDE, on, 'two', built)
    expect(opened).toHaveLength(2)
    expect(String(opened[1]?.said[0]?.text)).toContain('<conversation>')
  })

  test('a stop interrupts the turn and keeps what arrived', async () => {
    answer = (_, said) =>
      said.kind === 'interrupt'
        ? ['{"type":"result","subtype":"error_during_execution","is_error":true}']
        : said.kind === 'turn'
          ? [
              '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Her"}}}',
            ]
          : []
    const stopper = new AbortController()
    const on = thread(CLAUDE)
    const sending = send(CLAUDE, on, 'long', engine(CLAUDE), stopper.signal)
    await vi.waitFor(() => expect(on.turns.at(-1)?.parts).toHaveLength(1))
    stopper.abort()
    const events = await sending

    expect(opened[0]?.said.at(-1)).toEqual({ kind: 'interrupt' })
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'stopped' })
    expect(on.turns.at(-1)?.parts).toEqual([
      { kind: 'text', text: 'Her' },
      { kind: 'notice', code: 'stopped', text: '' },
    ])
  })

  test('a plan at its limit is the reader’s plan, and said as the limit', async () => {
    answer = () => [
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790819400}}',
      '{"type":"result","is_error":true,"result":"You\'ve hit your limit"}',
    ]
    const on = thread(CLAUDE)
    const events = await send(CLAUDE, on, 'hi')
    expect(events.some((one) => one.type === 'limit')).toBe(true)
    const done = events.at(-1)
    expect(done).toMatchObject({ type: 'done', stop: 'error' })
    expect(done?.type === 'done' && done.error).toMatch(/Claude plan is at its limit/)
  })

  test('words steered into a running turn are a message, answered after it', async () => {
    let holding: Open | undefined
    answer = (open, said) => {
      if (said.kind !== 'turn') return []
      if (!holding) {
        holding = open
        return []
      }
      return [...claudeTurn('First.'), ...claudeTurn('Second.')]
    }
    const built = engine(CLAUDE)
    const on = thread(CLAUDE)
    const sending = send(CLAUDE, on, 'one', built)
    await vi.waitFor(() => expect(holding).toBeDefined())
    await built.steer(on, 'and shorter')
    await sending

    expect(on.turns.map((turn) => turn.role)).toEqual(['you', 'model', 'you', 'model'])
    expect(on.turns[2]).toMatchObject({ steered: true, draft: { text: 'and shorter' } })
    expect(on.turns.at(-1)?.parts.at(-1)).toEqual({ kind: 'text', text: 'Second.' })
  })

  test('lists the models Claude Code lists', async () => {
    listed = {
      models: [{ value: 'opus[1m]', displayName: 'Opus', supportedEffortLevels: ['low', 'max'] }],
    }
    const models = await engine(CLAUDE).models(CLAUDE)
    expect(models).toEqual([
      {
        id: 'opus[1m]',
        name: 'Opus',
        window: 1_000_000,
        efforts: ['auto', 'low', 'max'],
        images: true,
        fast: false,
      },
    ])
  })
})

const codexTurn = (text: string) => [
  JSON.stringify({ method: 'turn/started', params: { threadId: 'x', turn: { id: 'u' } } }),
  JSON.stringify({
    method: 'item/agentMessage/delta',
    params: { threadId: 'x', turnId: 'u', itemId: 'a', delta: text },
  }),
  JSON.stringify({
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: 'x',
      turnId: 'u',
      tokenUsage: {
        last: {
          inputTokens: 300,
          cachedInputTokens: 100,
          outputTokens: 20,
          reasoningOutputTokens: 5,
        },
        modelContextWindow: 272000,
      },
    },
  }),
  JSON.stringify({
    method: 'turn/completed',
    params: { threadId: 'x', turn: { id: 'u', status: 'completed' } },
  }),
]

describe('a Codex thread', () => {
  test('answers a turn with the window Codex counts', async () => {
    answer = (_, said) => (said.kind === 'turn' ? codexTurn('Herons wait.') : [])
    const on = thread(CODEX, { model: 'gpt-fake', effort: 'off', fast: true })
    const events = await send(CODEX, on, 'what waits?')

    expect(opened[0]?.opening).toMatchObject({
      tool: 'codex',
      mode: 'ask',
      model: 'gpt-fake',
      effort: 'off',
    })
    expect(on.turns.at(-1)?.parts).toEqual([{ kind: 'text', text: 'Herons wait.' }])
    expect(on.usage).toEqual({ input: 300, cached: 100, output: 20, reasoning: 5, window: 272000 })
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'end' })
  })

  test('steers the running turn and says Fast when it changes', async () => {
    let held = false
    answer = (_, said) => {
      if (said.kind === 'turn' && !held) {
        held = true
        return []
      }
      return said.kind === 'steer' ? codexTurn('Shorter.') : []
    }
    const built = engine(CODEX)
    const on = thread(CODEX)
    const sending = send(CODEX, on, 'long', built)
    await vi.waitFor(() => expect(held).toBe(true))
    await built.steer(on, 'shorter')
    await sending
    expect(opened[0]?.said.map((one) => one.kind)).toEqual(['turn', 'steer'])

    answer = (_, said) => (said.kind === 'turn' ? codexTurn('ok') : [])
    on.fast = true
    await send(CODEX, on, 'again', built)
    expect(opened[0]?.said.slice(2)).toEqual([
      { kind: 'fast', on: true },
      { kind: 'turn', text: 'again', images: [] },
    ])
  })

  test('a thread Codex would not start ends in its words', async () => {
    answer = () => []
    const on = thread(CODEX)
    const built = engine(CODEX)
    const sending = send(CODEX, on, 'hi', built)
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    opened[0]?.channel.onmessage({
      kind: 'end',
      code: null,
      timedOut: false,
      stopped: false,
      err: 'nib mcp has no token',
    })
    const events = await sending
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'error', error: 'nib mcp has no token' })
  })
})

describe('a question put to Codex', () => {
  test('is a thread with no tool, answered and closed', async () => {
    const { askLocal } = await import('./ask')
    answer = (_, said) => (said.kind === 'turn' ? codexTurn('Herons wait.') : [])
    const pieces: string[] = []
    const answered = await askLocal({
      provider: CODEX,
      model: '',
      messages: [{ role: 'user', content: 'What waits?' }],
      stream: (piece) => pieces.push(piece),
    })

    expect(answered).toBe('Herons wait.')
    expect(pieces).toEqual(['Herons wait.'])
    expect(opened[0]?.opening).toMatchObject({ tool: 'codex', mode: null, model: null })
    expect(opened[0]?.said[0]).toEqual({
      kind: 'turn',
      text: '<user>\nWhat waits?\n</user>',
      images: [],
    })
    expect(opened[0]?.closed).toBe(true)
  })

  test('at the plan’s limit says so in nib’s words', async () => {
    const { askLocal } = await import('./ask')
    answer = () => [
      JSON.stringify({
        method: 'turn/completed',
        params: {
          threadId: 'x',
          turn: {
            id: 'u',
            status: 'failed',
            error: {
              message: 'You hit your usage limit. Try again at 3:05 PM.',
              codexErrorInfo: 'usageLimitExceeded',
            },
          },
        },
      }),
    ]
    const asking = askLocal({
      provider: CODEX,
      model: '',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await expect(asking).rejects.toThrow(/ChatGPT plan is at its limit until 3:05 PM/)
  })
})
