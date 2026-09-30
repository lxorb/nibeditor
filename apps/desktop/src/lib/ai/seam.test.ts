/** The seam every AI surface goes through: which provider a feature asks, and the three
 *  roads `complete()` takes - a key, a ChatGPT plan's token, a program on this machine -
 *  with the same streaming, stop and sentences on all three.
 *
 *  The crate is stood in for: `invoke` answers the commands a question makes, and a
 *  program's lines arrive on the channel the way `ai_cli_ask` sends them. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What the crate is asked, in order, and how each test has it answer. */
const asked: { command: string; args: Record<string, unknown> }[] = []
let lines: string[] = []
let ending = { kind: 'end', code: 0, timedOut: false, stopped: false, err: '' }
let hold = false
let missing = false
let held: { onmessage: (value: unknown) => void } | null = null

class FakeChannel {
  onmessage: (value: unknown) => void = () => undefined
}

async function fakeInvoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  asked.push({ command, args })
  if (command === 'chatgpt_token') return 'plan-token'
  if (command === 'ai_cli_stop') {
    held?.onmessage({ ...ending, stopped: true })
    return null
  }
  if (command !== 'ai_cli_ask') return null
  // The crate's own word for a program it could not find.
  if (missing) throw new Error('missing')

  const channel = args.output as FakeChannel
  // Lines arrive after the command has answered, as the crate's do.
  setTimeout(() => {
    if (hold) held = channel
    for (const line of lines) channel.onmessage({ kind: 'line', line })
    if (!hold) channel.onmessage(ending)
  }, 0)
  return null
}

vi.mock('../native', () => ({ Channel: FakeChannel, invoke: fakeInvoke }))
vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  invoke: fakeInvoke,
  isDesktop: true,
}))
vi.mock('./keys', () => ({ readKey: () => Promise.resolve('sk-key') }))

/** Every request the page made itself, and what the provider streams back. */
const fetched: { url: string; init: RequestInit }[] = []
let reply: () => Response = () => new Response('')

vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
  fetched.push({ url, init })
  return Promise.resolve(reply())
})

const { complete, wasStopped } = await import('./complete')
const { ai } = await import('./store.svelte')
const { plans } = await import('./local/status.svelte')

const CLAUDE_CODE = { id: 'claude-code', kind: 'claude-code' as const, name: '', model: '' }
const CHATGPT = { id: 'chatgpt', kind: 'chatgpt' as const, name: '', model: 'gpt-plan' }
const ASKED = [
  { role: 'system' as const, content: 'Be brief.' },
  { role: 'user' as const, content: 'What waits?' },
]

beforeEach(() => {
  asked.length = 0
  fetched.length = 0
  lines = []
  ending = { kind: 'end', code: 0, timedOut: false, stopped: false, err: '' }
  hold = false
  missing = false
  held = null
  for (const one of [...ai.providers]) ai.remove(one.id)
})

describe('which provider a feature asks', () => {
  test('the default, until a feature is given one of its own', () => {
    ai.add('openai')
    ai.update('openai', { model: 'gpt-5' })
    ai.add('claude-code')

    expect(ai.providerFor('ask')?.id).toBe('openai')
    ai.use('ask', 'claude-code')
    expect(ai.providerFor('ask')?.id).toBe('claude-code')
    expect(ai.providerFor('rewrite')?.id).toBe('openai')

    ai.use('ask', '')
    expect(ai.providerFor('ask')?.id).toBe('openai')
  })

  test('a provider taken away takes its features back to the default', () => {
    ai.add('openai')
    ai.update('openai', { model: 'gpt-5' })
    ai.add('codex')
    ai.use('summary', 'codex')
    ai.remove('codex')

    expect(ai.uses).toEqual({})
    expect(ai.providerFor('summary')?.id).toBe('openai')
  })

  test('a program on this machine needs no model to be asked', () => {
    ai.add('codex')
    expect(ai.providerFor('block')?.id).toBe('codex')
  })
})

describe('Claude Code on this machine', () => {
  const SAYS = [
    '{"type":"system","subtype":"init","model":"claude-opus-5-5[1m]","tools":[]}',
    '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-5-5"}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Herons "}}}',
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"wait."}}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Herons wait."}',
  ]

  test('is asked through the crate, with the whole conversation as one prompt', async () => {
    lines = SAYS
    const pieces: string[] = []
    let named = ''

    const answer = await complete({
      provider: CLAUDE_CODE,
      model: '',
      messages: ASKED,
      stream: (piece) => pieces.push(piece),
      named: (model) => {
        named = model
      },
    })

    expect(answer).toBe('Herons wait.')
    expect(pieces).toEqual(['Herons ', 'wait.'])
    expect(named).toBe('claude-opus-5-5')
    expect(fetched).toEqual([])

    const call = asked.find((one) => one.command === 'ai_cli_ask')
    expect(call?.args.tool).toBe('claude-code')
    expect(call?.args.model).toBeNull()
    expect(call?.args.prompt).toBe(
      '<instructions>\nBe brief.\n</instructions>\n\n<user>\nWhat waits?\n</user>',
    )
  })

  test('a stop ends the program and throws as a stopped request does', async () => {
    lines = [SAYS[2] ?? '']
    hold = true
    const stopper = new AbortController()

    const asking = complete({
      provider: CLAUDE_CODE,
      model: '',
      messages: ASKED,
      stream: () => stopper.abort(),
      signal: stopper.signal,
    })

    const thrown = await asking.catch((error: unknown) => error)
    expect(wasStopped(thrown)).toBe(true)
    expect(asked.some((one) => one.command === 'ai_cli_stop')).toBe(true)
  })

  test('the plan at its limit is said in nib’s words, and kept for the pane', async () => {
    lines = [
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}',
      '{"type":"result","is_error":true,"result":"You\'ve hit your limit"}',
    ]
    ending = { ...ending, code: 1 }

    await expect(complete({ provider: CLAUDE_CODE, model: '', messages: ASKED })).rejects.toThrow(
      'Your Claude plan is at its limit for now.',
    )
    expect(plans.local['claude-code'].limit?.state).toBe('reached')
  })

  test('a program that is not installed says so', async () => {
    missing = true
    await expect(complete({ provider: CLAUDE_CODE, model: '', messages: ASKED })).rejects.toThrow(
      'Claude Code is not installed.',
    )
  })
})

describe('a ChatGPT plan', () => {
  const events = (...said: object[]) =>
    said.map((one) => `event: x\ndata: ${JSON.stringify(one)}\n\n`).join('')

  test('streams from the Responses API with the token of the hour and no system message', async () => {
    reply = () =>
      new Response(
        events(
          { type: 'response.created' },
          { type: 'response.output_text.delta', delta: 'Herons ' },
          { type: 'response.output_text.delta', delta: 'wait.' },
          { type: 'response.completed' },
        ),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )

    const answer = await complete({ provider: CHATGPT, model: 'gpt-plan', messages: ASKED })

    expect(answer).toBe('Herons wait.')
    expect(fetched[0]?.url).toBe('https://api.openai.com/v1/responses')
    const headers = fetched[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer plan-token')
    const body = JSON.parse(fetched[0]?.init.body as string) as Record<string, unknown>
    expect(body).toEqual({
      model: 'gpt-plan',
      instructions: 'Be brief.',
      input: [{ role: 'user', content: 'What waits?' }],
      store: false,
      stream: true,
    })
  })

  test('its limit is the reader’s plan, not a status code', async () => {
    reply = () =>
      new Response(
        JSON.stringify({
          error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit.' },
        }),
        { status: 429 },
      )

    await expect(
      complete({ provider: CHATGPT, model: 'gpt-plan', messages: ASKED }),
    ).rejects.toThrow('Your ChatGPT plan is at its limit for now.')
    expect(plans.chatgptLimit?.state).toBe('reached')
  })

  test('a response that failed mid-stream says why', async () => {
    reply = () =>
      new Response(
        events(
          { type: 'response.output_text.delta', delta: 'Her' },
          {
            type: 'response.failed',
            response: { error: { code: 'server_error', message: 'Broke.' } },
          },
        ),
        { status: 200 },
      )

    await expect(
      complete({ provider: CHATGPT, model: 'gpt-plan', messages: ASKED, stream: () => undefined }),
    ).rejects.toThrow('Broke.')
  })
})
