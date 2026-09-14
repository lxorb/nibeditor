/** Which road a recording takes, and what leaves the machine on it.
 *
 *  Two roads: the reader's own provider, and the account. Both of them are somebody
 *  else's server for most people and neither of them for somebody running whisper on
 *  this machine, so the one thing worth a test here is which of them is asked - and,
 *  where it is the provider, that what goes up is the shape that route takes.
 *
 *  Nothing here decodes audio: `wordsInFile` needs a browser's own decoder and the
 *  piece is already a WAV by the time it reaches any of this. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** What the device's keychain answers, which each test sets. */
let apiKey = ''
vi.mock('../ai/keys', () => ({ readKey: () => Promise.resolve(apiKey) }))

/** The account's own road, stubbed at the API rather than at `fetch`: what is under
 *  test is which road was taken. */
const askedAccount: number[] = []
vi.mock('../api', () => ({
  api: {
    askPiece: (_token: string, wav: Uint8Array) => {
      askedAccount.push(wav.byteLength)
      return Promise.resolve({ said: 'the account heard this', language: 'en' })
    },
  },
}))

/** Every request that left, and what a provider answers to it. */
interface Sent {
  url: string
  headers: Record<string, string>
  model: string
  format: string
  file: { size: number; type: string; name: string } | null
}

const sent: Sent[] = []
let answers: { status: number; body: string }[] = []

/** One field of a form as the text it was written as. A field can also be a file, and
 *  none of the ones read here is one. */
function said(form: FormData, name: string): string {
  const found = form.get(name)
  return typeof found === 'string' ? found : ''
}

vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
  const form = init.body as FormData
  const file = form.get('file')

  sent.push({
    url,
    headers: (init.headers ?? {}) as Record<string, string>,
    model: said(form, 'model'),
    format: said(form, 'response_format'),
    file:
      file instanceof Blob
        ? {
            size: file.size,
            type: file.type,
            name: file instanceof File ? file.name : '',
          }
        : null,
  })

  const next = answers.shift() ?? { status: 200, body: JSON.stringify({ text: 'heard' }) }
  return new Response(next.body, {
    status: next.status,
    headers: { 'content-type': 'application/json' },
  })
})

const { account } = await import('../account.svelte')
const { ai } = await import('../ai/store.svelte')
const { canTranscribe } = await import('../ai/hears')
const { heardPiece, transcribedBy, WHISPER } = await import('./transcribe')

/** A piece of sound, of a size a test can recognise again. */
const wav = new Uint8Array(new ArrayBuffer(2048))

function local(): void {
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'On this machine', baseUrl: 'http://localhost:23311', model: 'llama' })
  ai.setDefault(made.id)
}

function hosted(): void {
  const made = ai.add('openai')
  ai.update(made.id, { model: 'gpt-5' })
  ai.setDefault(made.id)
}

function claude(): void {
  const made = ai.add('anthropic')
  ai.update(made.id, { model: 'claude-4' })
  ai.setDefault(made.id)
}

beforeEach(() => {
  for (const one of [...ai.providers]) ai.remove(one.id)
  sent.length = 0
  askedAccount.length = 0
  answers = []
  apiKey = ''
  account.token = null
  account.user = null
})

/** An account, the way a signed-in one looks: `accountToken` is the token and the user
 *  together, so a token on its own is a session nothing has come back about yet. */
function signedIn(): void {
  account.token = 'a-session'
  account.user = { id: 'drive', email: 'drive@example.com', name: 'Drive' }
}

describe('whether there is anything to ask at all', () => {
  test('no provider and no account is nothing', () => {
    expect(canTranscribe()).toBe(false)
  })

  test('a provider of the reader’s own is enough, with no account anywhere', () => {
    local()
    expect(canTranscribe()).toBe(true)
  })

  test('and so is an account with no provider', () => {
    signedIn()
    expect(canTranscribe()).toBe(true)
  })

  /** Claude reads text and images and serves no audio route, so a reader who has set
   *  up only Claude has no transcriber and the row stays out of the menu. */
  test('but Claude alone is not, because there is no route to ask', () => {
    claude()
    expect(ai.ready).toBe(true)
    expect(canTranscribe()).toBe(false)
  })
})

/** Before any request has been made, so nothing is remembered yet: which model a server
 *  actually answers with is a thing this module learns, and the name it offers before it
 *  has learned anything is the name a meeting's note is headed with. */
describe('what the note says wrote it', () => {
  test('is Whisper on the account’s road', () => {
    signedIn()
    expect(transcribedBy()).toBe(WHISPER)
  })

  test('and the model’s own name where the reader chose one', () => {
    hosted()
    expect(transcribedBy()).toBe('gpt-4o-mini-transcribe')

    for (const one of [...ai.providers]) ai.remove(one.id)
    local()
    expect(transcribedBy()).toBe('whisper-1')
  })
})

describe('a recording with a provider set up', () => {
  test('goes to the provider’s own route and never to the account', async () => {
    local()

    const heard = await heardPiece(wav)
    expect(heard.text).toBe('heard')
    expect(askedAccount).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('http://localhost:23311/v1/audio/transcriptions')
  })

  test('carries the sound as a file, and names no content type of its own', async () => {
    local()
    await heardPiece(wav)

    // The boundary of a multipart body is the browser's to write, so naming the type
    // here would describe a body the server could not read.
    expect(sent[0]?.headers['content-type']).toBeUndefined()
    expect(sent[0]?.file).toEqual({ size: wav.byteLength, type: 'audio/wav', name: 'said.wav' })
  })

  test('asks a server on this machine for whisper, and for the language with it', async () => {
    local()
    await heardPiece(wav)

    expect(sent[0]?.model).toBe('whisper-1')
    // `whisper-1` is the one model that says which language it heard, and it says so
    // under this shape.
    expect(sent[0]?.format).toBe('verbose_json')
  })

  test('and says which language, where the model said', async () => {
    local()
    answers = [{ status: 200, body: JSON.stringify({ text: 'guten Morgen', language: 'german' }) }]

    expect(await heardPiece(wav)).toEqual({ text: 'guten Morgen', language: 'german' })
  })

  test('asks OpenAI for its own newer model, which says no language', async () => {
    hosted()
    apiKey = 'sk-test'
    await heardPiece(wav)

    expect(sent[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(sent[0]?.model).toBe('gpt-4o-mini-transcribe')
    expect(sent[0]?.format).toBe('json')
    expect(sent[0]?.headers.authorization).toBe('Bearer sk-test')
  })

  /** The list of model names is a guess about somebody else's server, so a server that
   *  has never heard of the first one is asked for the next. Only that: a key refused is
   *  not a reason to try another name. */
  test('walks past a model the server does not have, and remembers the one it does', async () => {
    hosted()
    apiKey = 'sk-test'
    answers = [
      { status: 404, body: JSON.stringify({ error: { message: 'The model does not exist' } }) },
      { status: 200, body: JSON.stringify({ text: 'heard' }) },
    ]

    expect((await heardPiece(wav)).text).toBe('heard')
    expect(sent.map((one) => one.model)).toEqual(['gpt-4o-mini-transcribe', 'whisper-1'])

    // And the next piece asks for the one that answered, once: a meeting sends a piece
    // every twenty seconds and must not spend a request finding this out again.
    sent.length = 0
    await heardPiece(wav)
    expect(sent.map((one) => one.model)).toEqual(['whisper-1'])
  })

  test('says a refused key out loud rather than trying another name', async () => {
    hosted()
    apiKey = 'sk-wrong'
    answers = Array.from({ length: 6 }, () => ({
      status: 401,
      body: JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
    }))

    await expect(heardPiece(wav)).rejects.toThrow(/Incorrect API key/)
    // Three tries, which is what a piece gets, and one name throughout: a refusal that
    // is not about the model never reaches the next name.
    expect(sent).toHaveLength(3)
    expect(new Set(sent.map((one) => one.model)).size).toBe(1)
  })

  /** A hosted provider with no key on this device cannot be asked anything, and the
   *  recording does not go to the account instead: the reader chose that server. */
  test('a hosted provider with no key is not asked, and the account is not asked either', async () => {
    hosted()
    signedIn()

    await expect(heardPiece(wav)).rejects.toThrow(/not set up/)
    expect(sent).toEqual([])
    expect(askedAccount).toEqual([])
  })
})

describe('a recording with no provider at all', () => {
  test('goes to the account, which is what most readers have', async () => {
    signedIn()

    expect(await heardPiece(wav)).toEqual({ text: 'the account heard this', language: 'en' })
    expect(askedAccount).toEqual([wav.byteLength])
    expect(sent).toEqual([])
  })

  test('and says what to do about it when there is no account either', async () => {
    await expect(heardPiece(wav)).rejects.toThrow(/Add an AI provider or sign in/)
    expect(sent).toEqual([])
    expect(askedAccount).toEqual([])
  })
})
