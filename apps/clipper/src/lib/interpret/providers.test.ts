import { describe, expect, test } from 'vitest'
import {
  modelsRequest,
  OLLAMA,
  PROVIDER_IDS,
  PROVIDERS,
  readModels,
  readReply,
  reachable,
  ready,
  refusalIn,
  requestFor,
  type Setup,
} from './providers'

const PROMPT = { system: 'Fill these in.', user: 'Address: https://site.example/a' }

function setup(over: Partial<Setup> = {}): Setup {
  return { provider: 'openai', key: 'sk-x', address: OLLAMA, model: 'a-model', ...over }
}

/** The body a request would send, as the object it is. */
function body(one: Setup, json = true): Record<string, unknown> {
  return requestFor(one, PROMPT, json).body as Record<string, unknown>
}

describe('whether a provider is worth asking', () => {
  test('wants a model, whichever it is', () => {
    expect(ready(setup())).toBe(true)
    expect(ready(setup({ model: '  ' }))).toBe(false)
  })

  test('wants a key from the two that need one', () => {
    expect(ready(setup({ provider: 'claude', key: '' }))).toBe(false)
    expect(ready(setup({ provider: 'openai', key: '' }))).toBe(false)
  })

  test('wants none from a server that asks for none', () => {
    expect(ready(setup({ provider: 'compatible', key: '' }))).toBe(true)
  })

  test('wants an address from the one whose address is a choice', () => {
    expect(ready(setup({ provider: 'compatible', key: '', address: '' }))).toBe(false)
  })
})

describe('asking Claude', () => {
  const one = setup({ provider: 'claude', key: 'sk-ant-x' })
  const { url, headers } = requestFor(one, PROMPT, true)

  test('goes to the Messages API', () => {
    expect(url).toBe('https://api.anthropic.com/v1/messages')
  })

  test('carries the key, the version and the header a browser is asked for', () => {
    expect(headers['x-api-key']).toBe('sk-ant-x')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  test('puts the instruction in its own field and the page in the message', () => {
    expect(body(one).system).toBe(PROMPT.system)
    expect(body(one).messages).toEqual([{ role: 'user', content: PROMPT.user }])
  })

  test('states the ceiling the API has no default for', () => {
    expect(body(one).max_tokens).toBeGreaterThan(0)
  })

  test('sends nothing a model the account chose might refuse', () => {
    // No thinking, no effort, no JSON mode: the model is picked from what the
    // account has, and a field one of them rejects is a clip that fails for a
    // reason nobody chose.
    expect(Object.keys(body(one)).sort()).toEqual(['max_tokens', 'messages', 'model', 'system'])
  })

  test('lists its models where its own documentation says they are', () => {
    expect(modelsRequest(one).url).toBe('https://api.anthropic.com/v1/models')
    expect(modelsRequest(one).headers['x-api-key']).toBe('sk-ant-x')
  })

  test('reads the text block past whatever the model thought first', () => {
    const said = {
      content: [
        { type: 'thinking', thinking: 'let me look' },
        { type: 'text', text: '{"author": "A"}' },
      ],
    }

    expect(readReply('claude', said)).toBe('{"author": "A"}')
  })

  test('reads nothing out of an answer with no text in it', () => {
    expect(readReply('claude', { content: [{ type: 'thinking' }] })).toBe(null)
    expect(readReply('claude', { content: 'a string' })).toBe(null)
    expect(readReply('claude', null)).toBe(null)
  })
})

describe('asking anything that speaks chat completions', () => {
  const one = setup()

  test('goes to the address it was given, past a trailing slash', () => {
    expect(requestFor(one, PROMPT, true).url).toBe('https://api.openai.com/v1/chat/completions')
    expect(requestFor(setup({ provider: 'compatible' }), PROMPT, true).url).toBe(
      `${OLLAMA}/chat/completions`,
    )
    expect(
      requestFor(setup({ provider: 'compatible', address: `${OLLAMA}//` }), PROMPT, true).url,
    ).toBe(`${OLLAMA}/chat/completions`)
  })

  test('carries the key as a bearer token, and none where there is none', () => {
    expect(requestFor(one, PROMPT, true).headers.authorization).toBe('Bearer sk-x')
    expect(
      requestFor(setup({ provider: 'compatible', key: '' }), PROMPT, true).headers.authorization,
    ).toBe(undefined)
  })

  test('puts the instruction in a message of its own', () => {
    expect(body(one).messages).toEqual([
      { role: 'system', content: PROMPT.system },
      { role: 'user', content: PROMPT.user },
    ])
  })

  test('asks for JSON mode, and can be asked again without it', () => {
    expect(body(one, true).response_format).toEqual({ type: 'json_object' })
    expect('response_format' in body(one, false)).toBe(false)
  })

  test('lists its models beside the completions it answers', () => {
    expect(modelsRequest(one).url).toBe('https://api.openai.com/v1/models')
    expect(modelsRequest(setup({ provider: 'compatible' })).url).toBe(`${OLLAMA}/models`)
  })

  test('reads the one message a choice holds', () => {
    expect(readReply('openai', { choices: [{ message: { content: '{"a": 1}' } }] })).toBe(
      '{"a": 1}',
    )
  })

  test('reads nothing out of an answer with no choice in it', () => {
    expect(readReply('openai', { choices: [] })).toBe(null)
    expect(readReply('compatible', { choices: [{ message: {} }] })).toBe(null)
  })
})

describe('the models a provider lists', () => {
  test('come back in the order they were listed', () => {
    expect(readModels({ data: [{ id: 'one' }, { id: 'two' }] })).toEqual(['one', 'two'])
  })

  test('leave out a row that does not name one', () => {
    expect(readModels({ data: [{ id: 'one' }, {}, 'two'] })).toEqual(['one'])
  })

  test('are none where the answer is not a list of them', () => {
    expect(readModels({})).toEqual([])
    expect(readModels(null)).toEqual([])
  })
})

describe('why a provider refused', () => {
  test('is its own sentence where it wrote one', () => {
    expect(refusalIn({ error: { message: 'model not found' } })).toBe('model not found')
    expect(refusalIn({ error: 'model not found' })).toBe('model not found')
    expect(refusalIn({ message: 'model not found' })).toBe('model not found')
  })

  test('is one line of it, not a page of HTML', () => {
    const said = refusalIn({ error: { message: `a\nb${'x'.repeat(500)}` } })

    expect(said?.startsWith('a b')).toBe(true)
    expect(said?.length).toBe(200)
  })

  test('is nothing where it said nothing', () => {
    expect(refusalIn({ error: {} })).toBe(null)
    expect(refusalIn('Bad Gateway')).toBe(null)
  })
})

describe('the three providers between them', () => {
  test('are all offered, and each says what it is called', () => {
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].name.length, id).toBeGreaterThan(0)
  })

  test('suggest no model this extension made up', () => {
    // Claude's own is the one documented default; the other two are picked from
    // what the account or the machine actually lists.
    expect(PROVIDERS.claude.model).toBe('claude-opus-5')
    expect(PROVIDERS.openai.model).toBe('')
    expect(PROVIDERS.compatible.model).toBe('')
  })

  test('start a local server at the address Ollama answers on', () => {
    expect(PROVIDERS.compatible.base).toBe(OLLAMA)
    expect(OLLAMA.startsWith('http://localhost:')).toBe(true)
  })
})

/** The compatible provider's address is typed by hand, and what goes to it is the
 *  key and the page. So a typo is somebody else's server being handed both. */
describe('an address the key may be sent to', () => {
  test('is https, wherever it points', () => {
    for (const address of [
      'https://api.example.com/v1',
      'https://api.example.com:8443/v1',
      'https://127.0.0.1:1234/v1',
    ]) {
      expect(reachable(address), address).toBe(true)
    }
  })

  test('or this machine, which is where a model with no certificate answers', () => {
    for (const address of [OLLAMA, 'http://localhost:8080/v1', 'http://127.0.0.1:11434/v1']) {
      expect(reachable(address), address).toBe(true)
    }
  })

  test('and never plain http to somebody else', () => {
    for (const address of [
      'http://api.example.com/v1',
      'http://192.168.1.7:11434/v1',
      'http://localhost.evil.example/v1',
    ]) {
      expect(reachable(address), address).toBe(false)
    }
  })

  test('nor anything that is not an address at all', () => {
    for (const address of ['', '   ', 'api.example.com', 'ftp://example.com', 'javascript:1']) {
      expect(reachable(address), address).toBe(false)
    }
  })

  /** And the request itself: `ready` is what every caller asks before sending, so an
   *  address the key may not go to is a provider that is not set up. */
  test('so a provider pointed anywhere else is not asked anything', () => {
    const setup = { provider: 'compatible' as const, key: 'sk-test', model: 'llama', address: '' }

    expect(ready({ ...setup, address: OLLAMA })).toBe(true)
    expect(ready({ ...setup, address: 'https://api.example.com/v1' })).toBe(true)
    expect(ready({ ...setup, address: 'http://api.example.com/v1' })).toBe(false)
    expect(ready({ ...setup, address: 'not an address' })).toBe(false)
  })
})
