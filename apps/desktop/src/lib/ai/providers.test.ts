import { describe, expect, test } from 'vitest'
import {
  apiRoot,
  askUrl,
  bodyFor,
  deltaIn,
  headersFor,
  isLocal,
  type Message,
  modelsIn,
  modelsUrl,
  offeredKinds,
  type Provider,
  reachable,
  transcribes,
  troubleIn,
  usable,
} from './providers'

const claude: Provider = { id: 'anthropic', kind: 'anthropic', name: '', model: 'claude-test' }
const openai: Provider = { id: 'openai', kind: 'openai', name: '', model: 'gpt-test' }

const local = (baseUrl: string, model = 'llama'): Provider => ({
  id: 'compatible-1',
  kind: 'compatible',
  name: 'Ollama',
  baseUrl,
  model,
})

describe('where a provider lives', () => {
  test('the two fixed kinds know their own address', () => {
    expect(apiRoot(claude)).toBe('https://api.anthropic.com/v1')
    expect(apiRoot(openai)).toBe('https://api.openai.com/v1')
  })

  test('a typed address gets exactly one /v1', () => {
    for (const typed of [
      'http://localhost:11434',
      'http://localhost:11434/',
      'http://localhost:11434/v1',
      'http://localhost:11434/v1/',
      'http://localhost:11434/v1//',
    ]) {
      expect(apiRoot(local(typed)), typed).toBe('http://localhost:11434/v1')
    }
  })

  test('a version the server numbered itself is left alone', () => {
    expect(apiRoot(local('https://gateway.example/v2'))).toBe('https://gateway.example/v2')
  })

  /** The content policy names `http://localhost:*` and no other plain-http origin,
   *  and a policy reads `127.0.0.1` as a different host; see src/csp.ts and the
   *  comment on `LOOPBACK`. Typing either spelling has to reach the same server. */
  test('every way of writing this machine becomes the one the policy allows', () => {
    expect(apiRoot(local('http://127.0.0.1:11434'))).toBe('http://localhost:11434/v1')
    expect(apiRoot(local('http://127.0.0.1:11434/v1'))).toBe('http://localhost:11434/v1')
    expect(apiRoot(local('http://[::1]:1234'))).toBe('http://localhost:1234/v1')
    expect(apiRoot(local('HTTP://127.0.0.1:1234'))).toBe('http://localhost:1234/v1')
  })

  test('leaves an address that only begins like one alone', () => {
    // A host of somebody else's that starts with those digits, and the same
    // address over https, which the policy allows anywhere.
    expect(apiRoot(local('http://127.0.0.100:80'))).toBe('http://127.0.0.100:80/v1')
    expect(apiRoot(local('https://127.0.0.1:8443'))).toBe('https://127.0.0.1:8443/v1')
  })

  test('no address is no provider', () => {
    expect(apiRoot(local(''))).toBe('')
    expect(apiRoot(local('   '))).toBe('')
  })
})

describe('whether a provider can be asked', () => {
  test('needs an address and a model', () => {
    expect(usable(claude)).toBe(true)
    expect(usable({ ...claude, model: '' })).toBe(false)
    expect(usable(local('http://localhost:11434'))).toBe(true)
    expect(usable(local(''))).toBe(false)
  })
})

/** Whether asking this provider for its list of models can go anywhere yet.
 *
 *  The pane offers the list as the first thing that tells somebody their key
 *  works, and it offered it before there was a key: pressing it sent an
 *  unauthenticated request to Anthropic's own server and showed the 401 it came
 *  back with. A request nobody can be answered is a request that should not
 *  leave, on an app whose whole claim about models is that nothing goes anywhere
 *  it was not sent. A model on this machine is the other case: it wants no key,
 *  and the reader typed its address themselves. */
describe('whether there is any point asking for the models', () => {
  test('the hosted two want a key first', () => {
    expect(reachable(claude, false)).toBe(false)
    expect(reachable(openai, false)).toBe(false)
    expect(reachable(claude, true)).toBe(true)
    expect(reachable(openai, true)).toBe(true)
  })

  test('a model on this machine wants an address and nothing else', () => {
    expect(reachable(local('http://localhost:11434'), false)).toBe(true)
    expect(reachable(local(''), true)).toBe(false)
  })
})

describe('the two addresses a provider answers on', () => {
  test('Anthropic has messages and the others have completions', () => {
    expect(askUrl(claude)).toBe('https://api.anthropic.com/v1/messages')
    expect(askUrl(openai)).toBe('https://api.openai.com/v1/chat/completions')
    expect(askUrl(local('http://localhost:1234'))).toBe('http://localhost:1234/v1/chat/completions')
  })

  test('the model list is in the same place for all three', () => {
    expect(modelsUrl(openai)).toBe('https://api.openai.com/v1/models')
    expect(modelsUrl(local('http://localhost:1234'))).toBe('http://localhost:1234/v1/models')
  })
})

describe('what a request carries', () => {
  test('Anthropic wants its own header, its version and the browser opt-in', () => {
    const headers = headersFor(claude, 'sk-ant-x')
    expect(headers['x-api-key']).toBe('sk-ant-x')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headers.authorization).toBeUndefined()
  })

  test('OpenAI wants a bearer token', () => {
    expect(headersFor(openai, 'sk-x').authorization).toBe('Bearer sk-x')
  })

  test('a local model with no key gets no authorisation header at all', () => {
    // An empty one is worse than none: some servers refuse it outright.
    expect(headersFor(local('http://localhost:11434'), '')).not.toHaveProperty('authorization')
  })
})

describe('the body one question is asked with', () => {
  const messages: Message[] = [
    { role: 'system', content: 'Be brief.' },
    { role: 'system', content: 'The note says herons.' },
    { role: 'user', content: 'Why?' },
  ]

  test('Anthropic keeps the system prompt out of the conversation', () => {
    const body = JSON.parse(bodyFor(claude, messages, true)) as Record<string, unknown>

    expect(body.system).toBe('Be brief.\n\nThe note says herons.')
    expect(body.messages).toEqual([{ role: 'user', content: 'Why?' }])
    expect(body.max_tokens).toBe(4096)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('claude-test')
  })

  test('the OpenAI shape keeps it in', () => {
    const body = JSON.parse(bodyFor(openai, messages, false)) as Record<string, unknown>

    expect(body.messages).toEqual(messages)
    expect(body.stream).toBe(false)
    expect(body).not.toHaveProperty('system')
  })

  test('a question with no system prompt sends no empty one', () => {
    const body = JSON.parse(bodyFor(claude, [{ role: 'user', content: 'Hello' }], true)) as Record<
      string,
      unknown
    >

    expect(body).not.toHaveProperty('system')
  })
})

describe('the words one event carries', () => {
  test('Anthropic sends them as a typed delta', () => {
    expect(
      deltaIn('anthropic', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a' },
      }),
    ).toBe('a')
  })

  test('the OpenAI shape sends them on a choice', () => {
    expect(deltaIn('openai', { choices: [{ delta: { content: 'b' } }] })).toBe('b')
    expect(deltaIn('compatible', { choices: [{ delta: { content: 'c' } }] })).toBe('c')
  })

  test('an event with no words in it carries none', () => {
    for (const event of [
      {},
      null,
      'ping',
      { type: 'message_start' },
      { type: 'content_block_delta', delta: {} },
      { choices: [] },
      { choices: [{ delta: {} }] },
      { choices: [{ finish_reason: 'stop' }] },
    ]) {
      expect(deltaIn('openai', event), JSON.stringify(event)).toBe('')
      expect(deltaIn('anthropic', event), JSON.stringify(event)).toBe('')
    }
  })
})

describe('what a provider says went wrong', () => {
  test('reads the message out of either shape', () => {
    expect(troubleIn({ error: { message: 'no such model' } })).toBe('no such model')
    expect(troubleIn({ error: 'invalid_api_key' })).toBe('invalid_api_key')
  })

  test('finds no complaint in an ordinary answer', () => {
    expect(troubleIn({ choices: [] })).toBeNull()
    expect(troubleIn(null)).toBeNull()
    expect(troubleIn({ error: {} })).toBeNull()
    expect(troubleIn({ error: { message: '' } })).toBeNull()
  })
})

describe('the models a provider listed', () => {
  test('are the ids, sorted, without repeats', () => {
    expect(modelsIn({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
  })

  test('are nothing at all when the answer is not a list of them', () => {
    for (const body of [null, {}, { data: 'nope' }, { data: [{}, { id: 5 }, { id: '' }] }]) {
      expect(modelsIn(body), JSON.stringify(body)).toEqual([])
    }
  })
})

describe('the plans', () => {
  const plan: Provider = { id: 'chatgpt', kind: 'chatgpt', name: '', model: 'gpt-plan' }
  const program: Provider = { id: 'codex', kind: 'codex', name: '', model: '' }

  test('are offered on a desktop only, first, and Claude Code only where the build has it', () => {
    expect(offeredKinds(false, true)).toEqual(['anthropic', 'openai', 'compatible'])
    expect(offeredKinds(true, true).slice(0, 3)).toEqual(['claude-code', 'chatgpt', 'codex'])
    expect(offeredKinds(true, false)).not.toContain('claude-code')
  })

  test('a ChatGPT plan is spent through the Responses API alone', () => {
    expect(askUrl(plan)).toBe('https://api.openai.com/v1/responses')
    expect(deltaIn('chatgpt', { type: 'response.output_text.delta', delta: 'hi' })).toBe('hi')
    expect(deltaIn('chatgpt', { type: 'response.completed' })).toBe('')
    expect(troubleIn({ type: 'response.failed', response: { error: { message: 'no' } } })).toBe(
      'no',
    )
    expect(troubleIn({ type: 'error', message: 'rate limited' })).toBe('rate limited')
  })

  test('a plan’s catalogue offers the models meant to be listed, by their slugs', () => {
    expect(
      modelsIn({
        models: [
          { slug: 'gpt-b', display_name: 'B', visibility: 'list' },
          { slug: 'gpt-hidden', visibility: 'hide' },
          { slug: 'gpt-a', display_name: 'A', visibility: 'list' },
        ],
      }),
    ).toEqual(['gpt-a', 'gpt-b'])
  })

  test('a program on this machine has no address and hears nothing; no plan transcribes', () => {
    expect(isLocal('codex')).toBe(true)
    expect(isLocal('chatgpt')).toBe(false)
    expect(apiRoot(program)).toBe('')
    expect(usable(program)).toBe(true)
    expect(reachable(program, false)).toBe(true)
    expect(transcribes(program)).toBe(false)
    expect(transcribes(plan)).toBe(false)
    expect(transcribes(openai)).toBe(true)
  })
})
