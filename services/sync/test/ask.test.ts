/** The account's OpenAI key, and the question flow that is the only thing allowed
 *  to read it.
 *
 *  Emil's rule is one sentence - "it stays in the account, but after you set it you
 *  can't read it anymore" - and most of this file is about the second half of it.
 *  What is stored is not the key, what any read answers is not the key, and the one
 *  function that opens it is the one the model's request goes through. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { opened, sealed } from '../src/ask/key'
import { call, signIn, testEnv, type TestEnv } from './harness'
import type { ShareView } from './harness'

const SECRET = 'a secret nobody in this repository knows'
const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz-4f2a'

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv({ OPENAI_KEY_SECRET: SECRET })
  token = await signIn(env, 'a@b.dev')
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

function put(key: string, as = token) {
  return call(env, '/v1/ask/key', { method: 'PUT', token: as, body: { key } })
}

function state(as = token) {
  return call(env, '/v1/settings', { token: as })
}

/** What is actually in the column, which is the only way to say that it is not the
 *  key. Read straight from the database: no route answers with it. */
function stored(): { openai_key: string | null; openai_key_tail: string | null } {
  return env.db.prepare('select openai_key, openai_key_tail from users').get() as {
    openai_key: string | null
    openai_key_tail: string | null
  }
}

/** The user's id, for the round trip below. */
function userId(): string {
  return (env.db.prepare('select id from users').get() as { id: string }).id
}

/** How many questions the account has been counted for this hour, which is what the
 *  ceiling is actually made of. Read straight from the database, so a test can say
 *  what sixty questions did without asking sixty of them. */
function asked(): number {
  const row = env.db
    .prepare('select count from limits where scope = ? and key = ?')
    .get('ask', userId()) as { count: number } | undefined

  return row?.count ?? 0
}

/* ── Encryption ───────────────────────────────────────────────────────── */

describe('a key at rest', () => {
  test('goes round trip', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    expect(box).not.toContain(KEY)
    expect(await opened(SECRET, 'u1', box)).toBe(KEY)
  })

  test('is different bytes every time, so two identical keys do not look identical', async () => {
    const one = await sealed(SECRET, 'u1', KEY)
    const two = await sealed(SECRET, 'u1', KEY)
    expect(one).not.toBe(two)
    expect(await opened(SECRET, 'u1', two)).toBe(KEY)
  })

  test('will not open under another account, so moving the column borrows nothing', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    expect(await opened(SECRET, 'u2', box)).toBeNull()
  })

  test('will not open under another secret', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    expect(await opened('something else', 'u1', box)).toBeNull()
  })

  test('will not open when somebody has edited the bytes', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    const [version, nonce, body] = box.split('.')
    expect(await opened(SECRET, 'u1', `${version}.${nonce}.${(body ?? '').slice(0, -4)}AAAA`)).toBe(
      null,
    )
    expect(await opened(SECRET, 'u1', `2.${nonce}.${body}`)).toBeNull()
    expect(await opened(SECRET, 'u1', 'nonsense')).toBeNull()
  })
})

/* ── Setting it, and never getting it back ────────────────────────────── */

describe('setting the key', () => {
  test('answers that it is set and the last four characters, and nothing else', async () => {
    const { status, json } = await put(KEY)
    expect(status).toBe(200)
    expect(json).toEqual({ set: true, tail: '4f2a' })
  })

  test('stores something that is not the key', async () => {
    await put(KEY)
    const row = stored()
    expect(row.openai_key).toBeTruthy()
    expect(row.openai_key).not.toContain(KEY)
    expect(row.openai_key).not.toContain('sk-')
    expect(row.openai_key_tail).toBe('4f2a')
  })

  test('and what it stored opens back to the key, for the one caller that may', async () => {
    await put(KEY)
    expect(await opened(SECRET, userId(), stored().openai_key ?? '')).toBe(KEY)
  })

  test('replaces on a second write, because there is no editing what cannot be read', async () => {
    await put(KEY)
    const again = await put('sk-proj-something-completely-else-9999')
    expect(again.json).toEqual({ set: true, tail: '9999' })
    expect(await opened(SECRET, userId(), stored().openai_key ?? '')).toBe(
      'sk-proj-something-completely-else-9999',
    )
  })

  test('trims what was pasted, because a key off a web page brings a newline', async () => {
    await put(`  ${KEY}\n`)
    expect(await opened(SECRET, userId(), stored().openai_key ?? '')).toBe(KEY)
  })

  test('refuses something that is not a key, and stores nothing', async () => {
    for (const wrong of ['', 'sk-short', `${KEY} ${KEY}`]) {
      expect((await put(wrong)).status, wrong).toBe(400)
    }
    expect(stored().openai_key).toBeNull()
  })

  /** The one that matters most: a server with no secret refuses rather than
   *  falling back to plaintext. A key somebody believes is encrypted and is not is
   *  worse than no key at all. */
  test('refuses to store at all when the server has no secret', async () => {
    const bare = testEnv()
    const only = await signIn(bare, 'c@d.dev')
    const answer = await call(bare, '/v1/ask/key', {
      method: 'PUT',
      token: only,
      body: { key: KEY },
    })

    expect(answer.status).toBe(503)
    expect(answer.json.error).toBe('this server cannot keep a key yet')
    expect(
      (
        bare.db.prepare('select openai_key, openai_key_tail from users').get() as {
          openai_key: unknown
        }
      ).openai_key,
    ).toBeNull()
    bare.close()
  })
})

describe('reading the key', () => {
  test('is not something any route offers', async () => {
    await put(KEY)
    const { json, text } = await state()

    expect(json.key).toEqual({ set: true, tail: '4f2a' })
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('sk-')
  })

  test('says so when there is none', async () => {
    expect((await state()).json.key).toEqual({ set: false, tail: '' })
  })

  test('works even where the server could not decrypt one, because it decrypts nothing', async () => {
    await put(KEY)

    const bare = testEnv()
    // The same row, on a server with no secret: the tail is in the clear on purpose.
    bare.db.exec(
      `insert into users (id, email, created_at, settings, openai_key, openai_key_tail)
       values ('u', 'e@f.dev', 1, '{}', 'unreadable', '4f2a')`,
    )
    const one = await signIn(bare, 'g@h.dev')
    expect((await call(bare, '/v1/settings', { token: one })).json.key).toEqual({
      set: false,
      tail: '',
    })
    bare.close()
  })

  test('is gone once it is taken away', async () => {
    await put(KEY)
    const removed = await call(env, '/v1/ask/key', { method: 'DELETE', token })

    expect(removed.json).toEqual({ set: false, tail: '' })
    expect(stored()).toEqual({ openai_key: null, openai_key_tail: null })
    expect((await state()).json.key).toEqual({ set: false, tail: '' })
  })

  /** It used to be a setting, in the clear, and every read handed it back. */
  test('cannot be smuggled back in through the settings', async () => {
    const patched = await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      body: { glassesKey: KEY },
    })

    expect(patched.status).toBe(400)
    expect(patched.json.error).toBe('unknown setting glassesKey')
    expect((await state()).json.settings).toEqual({})
  })
})

/* ── The models the key may choose ────────────────────────────────────── */

/** OpenAI's model list, as the endpoint answers it, plus a count of how often it
 *  was asked. */
function fakeModels(): () => number {
  let asked = 0
  vi.stubGlobal('fetch', (url: string) => {
    asked++
    expect(url).toBe('https://api.openai.com/v1/models')
    return Promise.resolve(
      Response.json({
        data: [
          { id: 'gpt-6-astra' },
          { id: 'gpt-6-astra-2026-09-01' },
          { id: 'gpt-5.6-sol' },
          { id: 'gpt-5.6-sol-preview' },
          { id: 'text-embedding-4' },
          { id: 'whisper-1' },
        ],
      }),
    )
  })

  return () => asked
}

describe('the models on offer', () => {
  test('are the families worth offering, in family order', async () => {
    fakeModels()
    await put(KEY)

    const { json } = await call(env, '/v1/ask/models', { token })
    expect(json.models).toEqual(['gpt-6-astra', 'gpt-5.6-sol'])
  })

  test('are asked for once a day rather than once a pane', async () => {
    const asked = fakeModels()
    await put(KEY)

    await call(env, '/v1/ask/models', { token })
    await call(env, '/v1/ask/models', { token })
    await call(env, '/v1/ask/models', { token })
    expect(asked()).toBe(1)
  })

  test('and are asked again once the day is up', async () => {
    const asked = fakeModels()
    await put(KEY)
    await call(env, '/v1/ask/models', { token })

    env.db.exec('update cached set until = 1')
    await call(env, '/v1/ask/models', { token })
    expect(asked()).toBe(2)
  })

  test('are forgotten when the key changes, because the list was the old key’s', async () => {
    const asked = fakeModels()
    await put(KEY)
    await call(env, '/v1/ask/models', { token })

    await put('sk-proj-another-key-entirely-1234')
    await call(env, '/v1/ask/models', { token })
    expect(asked()).toBe(2)
  })

  test('are empty with no key, and OpenAI is not asked at all', async () => {
    const asked = fakeModels()
    const { json } = await call(env, '/v1/ask/models', { token })

    expect(json.models).toEqual([])
    expect(asked()).toBe(0)
  })
})

/* ── Asking ───────────────────────────────────────────────────────────── */

interface Sent {
  model: string
  input: { role?: string; type?: string; name?: string; output?: string; content?: unknown }[]
  tools: { name: string }[]
  reasoning: { effort: string }
}

/** OpenAI's Responses endpoint, answering with whatever each round was told to.
 *  Every request it was sent is kept, because what the model was given - and in
 *  particular what it was *not* given - is most of what there is to check. */
function fakeAsking(rounds: unknown[]): Sent[] {
  const sent: Sent[] = []
  let round = 0

  vi.stubGlobal('fetch', async (url: string, options: { body: string }) => {
    expect(url).toBe('https://api.openai.com/v1/responses')
    sent.push(JSON.parse(options.body) as Sent)
    const answer = rounds[Math.min(round++, rounds.length - 1)]
    return Promise.resolve(Response.json(answer))
  })

  return sent
}

function said(text: string) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
}

function wants(name: string, args: Record<string, string>) {
  return {
    output: [{ type: 'function_call', call_id: 'c1', name, arguments: JSON.stringify(args) }],
  }
}

function question(body: unknown, as = token) {
  return call(env, '/v1/ask', { token: as, body })
}

async function noteIn(as: string, space: string, path: string, content: string): Promise<void> {
  await call(env, `/v1/spaces/${space}/notes`, { token: as, body: { path, content } })
}

async function firstSpace(as: string): Promise<string> {
  const { json } = await call(env, '/v1/spaces', { token: as })
  return json.spaces[0]?.id ?? ''
}

describe('a question', () => {
  beforeEach(async () => {
    await put(KEY)
  })

  test('comes back as the answer, with the model the plugin named', async () => {
    const sent = fakeAsking([said('You decided on the firmware font.')])
    const { status, json } = await question({
      question: 'what did i decide about the font',
      model: 'gpt-6-astra',
      effort: 'low',
    })

    expect(status).toBe(200)
    expect(json.answer).toBe('You decided on the firmware font.')
    expect(sent[0]?.model).toBe('gpt-6-astra')
    expect(sent[0]?.reasoning.effort).toBe('low')
  })

  test('is asked with tools rather than with the notes', async () => {
    const sent = fakeAsking([said('nothing to say')])
    const space = await firstSpace(token)
    await noteIn(token, space, 'fonts.md', 'The firmware font only, no bitmaps.\n')

    await question({ question: 'fonts?', model: 'gpt-6-astra' })

    expect(sent[0]?.tools.map((one) => one.name)).toEqual(['search_notes', 'read_note'])
    // Two items: the prompt and the question. Not one note.
    expect(sent[0]?.input.map((one) => one.role)).toEqual(['developer', 'user'])
    expect(JSON.stringify(sent[0]?.input)).not.toContain('bitmaps')
  })

  test('searches the account’s own notes when the model asks', async () => {
    const sent = fakeAsking([
      wants('search_notes', { query: 'bitmaps' }),
      said('The firmware font.'),
    ])
    const space = await firstSpace(token)
    await noteIn(token, space, 'fonts.md', 'one\nThe firmware font only, no bitmaps.\n')

    const { json } = await question({ question: 'fonts?', model: 'gpt-6-astra' })
    expect(json.answer).toBe('The firmware font.')

    const answered = sent[1]?.input.find((one) => one.type === 'function_call_output')
    expect(answered?.output).toBe(
      JSON.stringify([{ note: 'fonts', line: 2, text: 'The firmware font only, no bitmaps.' }]),
    )
  })

  test('reads one whole note by the name a search gave', async () => {
    const sent = fakeAsking([wants('read_note', { name: 'fonts' }), said('read it')])
    const space = await firstSpace(token)
    await noteIn(token, space, 'fonts.md', '# Fonts\n\nOne font.\n')

    await question({ question: 'fonts?', model: 'gpt-6-astra' })
    const answered = sent[1]?.input.find((one) => one.type === 'function_call_output')
    expect(answered?.output).toBe('# Fonts\n\nOne font.\n')
  })

  /** The scope of the tools, which is the whole of what they are allowed to be. */
  test('never reaches a note belonging to somebody else', async () => {
    const sent = fakeAsking([
      wants('search_notes', { query: 'secret' }),
      wants('read_note', { name: 'theirs' }),
      said('nothing found'),
    ])

    const other = await signIn(env, 'z@z.dev')
    await noteIn(other, await firstSpace(other), 'theirs.md', 'a secret of their own\n')

    await question({ question: 'anything?', model: 'gpt-6-astra' })

    // The last request carries the whole conversation, so both answers are in it.
    const answers = (sent.at(-1)?.input ?? [])
      .filter((one) => one.type === 'function_call_output')
      .map((one) => one.output)
    expect(answers).toEqual(['nothing found', 'no such note'])
  })

  test('does reach a space somebody shared with the account', async () => {
    const sent = fakeAsking([wants('search_notes', { query: 'shared' }), said('found it')])

    const other = await signIn(env, 'y@y.dev')
    const theirs = (await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json
      .space.id
    await noteIn(other, theirs, 'plan.md', 'a shared line\n')
    await call(env, `/v1/spaces/${theirs}/share/invite`, {
      token: other,
      body: { email: 'a@b.dev', role: 'read' },
    })

    await question({ question: 'anything?', model: 'gpt-6-astra' })
    const answered = sent[1]?.input.find((one) => one.type === 'function_call_output')
    expect(answered?.output).toContain('a shared line')
  })

  test('says what OpenAI refused with, because somebody is standing there', async () => {
    fakeAsking([{ error: { message: 'that model is not available to this account' } }])
    const { status, json } = await question({ question: 'anything?', model: 'gpt-6-astra' })

    expect(status).toBe(502)
    expect(json.error).toBe('that model is not available to this account')
  })

  test('needs a key, a question and a model', async () => {
    fakeAsking([said('never asked')])
    expect((await question({ model: 'gpt-6-astra' })).status).toBe(400)
    expect((await question({ question: '  ', model: 'gpt-6-astra' })).status).toBe(400)
    expect((await question({ question: 'hi' })).status).toBe(400)
    expect((await question({ question: 'hi', model: 'm', effort: 'quite hard' })).status).toBe(400)

    await call(env, '/v1/ask/key', { method: 'DELETE', token })
    const none = await question({ question: 'hi', model: 'gpt-6-astra' })
    expect(none.status).toBe(400)
    expect(none.json.error).toContain('OpenAI key')
  })

  /** The account's own credit is what this spends, and a phone in a pocket is
   *  what a ceiling is for.
   *
   *  Counted rather than ground through. This asked sixty questions and then a sixty
   *  first, and sixty one round trips through the Worker and the database is most of
   *  a test timeout on a runner with the rest of the suite on it: the test timed out
   *  while the ceiling was doing exactly what it does now. The ceiling is a row in
   *  `limits`, so the row says what sixty questions did without sixty being asked -
   *  which is how the utterance ceiling below is tested too. Three questions are
   *  enough to say the whole of it: the count goes up with each one, the sixtieth is
   *  answered, and the sixty first is not. */
  test('stops after sixty in an hour', async () => {
    fakeAsking([said('yes')])

    // Every question counts, and what it counts against is the account's own row.
    expect((await question({ question: 'again', model: 'gpt-6-astra' })).status).toBe(200)
    expect(asked()).toBe(1)

    // Fifty nine asked this hour, without fifty nine round trips.
    env.db
      .prepare('update limits set count = ? where scope = ? and key = ?')
      .run(59, 'ask', userId())

    // The sixtieth is answered.
    expect((await question({ question: 'again', model: 'gpt-6-astra' })).status).toBe(200)
    expect(asked()).toBe(60)

    // And the sixty first is not.
    const over = await question({ question: 'again', model: 'gpt-6-astra' })
    expect(over.status).toBe(429)
    expect(over.json.error).toContain('a lot of questions')
  })
})

/* ── An utterance, as words ───────────────────────────────────────────── */

describe('what the microphone heard', () => {
  beforeEach(async () => {
    await put(KEY)
  })

  function heard(body: BodyInit, as = token) {
    return call(env, '/v1/ask/heard', {
      method: 'POST',
      token: as,
      raw: body,
      headers: { 'content-type': 'audio/wav' },
    })
  }

  /** Which model a transcription asked for. `FormData.get` answers a string or a
   *  file, and only one of those is a model name. */
  function modelIn(form: FormData): string {
    const value = form.get('model')
    return typeof value === 'string' ? value : ''
  }

  test('comes back as words', async () => {
    let model = ''
    vi.stubGlobal('fetch', async (url: string, options: { body: FormData }) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
      model = modelIn(options.body)
      return Promise.resolve(new Response('open page three\n'))
    })

    const { status, json } = await heard(new Uint8Array([1, 2, 3, 4]))
    expect(status).toBe(200)
    expect(json.said).toBe('open page three')
    expect(model).toBe('gpt-transcribe')
  })

  test('falls to the next model where the account has not got the first', async () => {
    const tried: string[] = []
    vi.stubGlobal('fetch', async (_url: string, options: { body: FormData }) => {
      const model = modelIn(options.body)
      tried.push(model)
      return Promise.resolve(
        model === 'whisper-1' ? new Response('next') : new Response('no', { status: 404 }),
      )
    })

    expect((await heard(new Uint8Array([1]))).json.said).toBe('next')
    expect(tried).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'])
  })

  /** Workers AI runs where this Worker runs; the account's own key is a second
   *  journey across the internet inside the one request somebody is standing there
   *  waiting on. Emil, on the glasses: *"it takes so long for a voice command that
   *  there's no reason to use it."* So the near model listens first, key or no key,
   *  and the key is what answers when it heard nothing at all. */
  test('listens on Workers AI first, and does not leave the building for it', async () => {
    const asked: string[] = []
    env.AI = {
      run(model: string) {
        asked.push(model)
        return Promise.resolve({ text: 'heard it anyway' })
      },
    }
    vi.stubGlobal('fetch', () => {
      throw new Error('the key is the fallback, not the first stop')
    })

    expect((await heard(new Uint8Array([1]))).json.said).toBe('heard it anyway')
    expect(asked).toEqual(['@cf/openai/whisper-large-v3-turbo'])
  })

  test('and spends the key only where the near models heard nothing', async () => {
    const asked: string[] = []
    env.AI = {
      run(model: string) {
        asked.push(model)
        return Promise.resolve({ text: '' })
      },
    }
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('through the key')))

    expect((await heard(new Uint8Array([1]))).json.said).toBe('through the key')
    expect(asked).toEqual(['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper'])
  })

  /** Half a second of "next" comes back as "text" often enough to matter. Whisper
   *  takes a prompt and leans towards it, so the plugin sends the phrases it is
   *  hoping to hear - the reader's own, whatever they rebound them to. */
  test('leans on the words the plugin said it was hoping for', async () => {
    let prompted: unknown = null
    env.AI = {
      run(_model: string, input: unknown) {
        prompted = (input as { initial_prompt?: unknown }).initial_prompt
        return Promise.resolve({ text: 'next' })
      },
    }

    const { json } = await call(env, '/v1/ask/heard?like=next%2C%20back%2C%20close', {
      method: 'POST',
      token,
      raw: new Uint8Array([1]),
      headers: { 'content-type': 'audio/wav' },
    })

    expect(json.said).toBe('next')
    expect(prompted).toBe('next, back, close')
  })

  test('and takes a list of commands rather than a paragraph of somebody else', async () => {
    let prompted = ''
    env.AI = {
      run(_model: string, input: unknown) {
        const said = (input as { initial_prompt?: unknown }).initial_prompt
        prompted = typeof said === 'string' ? said : ''
        return Promise.resolve({ text: 'next' })
      },
    }

    await call(env, `/v1/ask/heard?like=${'x'.repeat(900)}`, {
      method: 'POST',
      token,
      raw: new Uint8Array([1]),
      headers: { 'content-type': 'audio/wav' },
    })

    expect(prompted.length).toBe(300)
  })

  test('answers null where none of them heard anything', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 500 })))
    expect((await heard(new Uint8Array([1]))).json.said).toBeNull()
  })

  test('refuses silence and refuses a recording that is too long', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('never asked')))

    expect((await heard(new Uint8Array())).status).toBe(400)
    expect(
      (
        await call(env, '/v1/ask/heard', {
          method: 'POST',
          token,
          raw: new Uint8Array([1]),
          headers: { 'content-type': 'audio/wav', 'content-length': String(9 * 1024 * 1024) },
        })
      ).status,
    ).toBe(413)
  })
})

/* ── An utterance with no OpenAI key at all ─────────────────── */

/** Emil has no OpenAI account at all, and the plugin answered "no way to listen" to
 *  somebody wearing a pair of glasses with a working microphone. The microphone is
 *  there, and so is a model - Whisper on Workers AI, on the same Worker that is
 *  already answering the request - so a key decides which model listens and nothing
 *  more.
 *
 *  Nothing on the glasses does this: the SDK hands a plugin raw PCM and there is no
 *  speech to text anywhere in `@evenrealities/even_hub_sdk` 0.0.15. */
describe('what the microphone heard with no key', () => {
  /** A WAV header saying what the glasses send: 16 kHz, sixteen bit, one channel,
   *  `seconds` of it. Built as a real header because the cap is measured in seconds
   *  off the header own fields, which is the whole point of reading them. */
  function wav(seconds: number): Uint8Array {
    const rate = 16_000
    const bytes = Math.round(seconds * rate * 2)
    const file = new Uint8Array(44 + bytes)
    const view = new DataView(file.buffer)
    const write = (at: number, text: string) => {
      for (let step = 0; step < text.length; step++) file[at + step] = text.charCodeAt(step)
    }

    write(0, 'RIFF')
    view.setUint32(4, 36 + bytes, true)
    write(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, 'data')
    view.setUint32(40, bytes, true)
    return file
  }

  /** The Workers AI binding, as a fake: which models were asked and with what, and
   *  a model with no answer here throws the way one that has been retired does. */
  function workersAi(answers: Record<string, unknown>) {
    const asked: { model: string; input: unknown }[] = []
    const AI = {
      run(model: string, input: unknown): Promise<unknown> {
        asked.push({ model, input })
        const answer = answers[model]
        if (answer === undefined) return Promise.reject(new Error('no such model'))
        return Promise.resolve(answer)
      },
    }

    return { AI, asked }
  }

  function heard(body: BodyInit, as = token) {
    return call(env, '/v1/ask/heard', {
      method: 'POST',
      token: as,
      raw: body,
      headers: { 'content-type': 'audio/wav' },
    })
  }

  test('listens on Workers AI, and never asks OpenAI for anything', async () => {
    const { AI, asked } = workersAi({
      '@cf/openai/whisper-large-v3-turbo': { text: ' open page four ' },
    })
    env.AI = AI
    vi.stubGlobal('fetch', () => {
      throw new Error('no key, so nothing may leave for OpenAI')
    })

    const { status, json } = await heard(wav(1.5))
    expect(status).toBe(200)
    expect(json.said).toBe('open page four')
    expect(asked.map((one) => one.model)).toEqual(['@cf/openai/whisper-large-v3-turbo'])
    // The turbo model takes the file as base64, not as bytes.
    expect(typeof (asked[0]?.input as { audio: unknown }).audio).toBe('string')
  })

  test('falls to the older Whisper where turbo will not take it', async () => {
    const { AI, asked } = workersAi({ '@cf/openai/whisper': { text: 'next one' } })
    env.AI = AI

    expect((await heard(wav(1))).json.said).toBe('next one')
    expect(asked.map((one) => one.model)).toEqual([
      '@cf/openai/whisper-large-v3-turbo',
      '@cf/openai/whisper',
    ])
    // And that one takes its bytes.
    expect(Array.isArray((asked[1]?.input as { audio: unknown }).audio)).toBe(true)
  })

  test('answers nothing rather than an error where neither model heard a word', async () => {
    const { AI } = workersAi({
      '@cf/openai/whisper-large-v3-turbo': { text: '   ' },
      '@cf/openai/whisper': {},
    })
    env.AI = AI

    const { status, json } = await heard(wav(1))
    expect(status).toBe(200)
    expect(json.said).toBeNull()
  })

  test('and where the binding is not there at all, which is a server not ready', async () => {
    const { status, json } = await heard(wav(1))
    expect(status).toBe(200)
    expect(json.said).toBeNull()
  })

  /** A spoken command is a second or two. Twelve seconds of anything arrived from a
   *  pocket or a room rather than from somebody talking to their glasses, and the
   *  seconds are read off the header so that the ceiling means the same thing at any
   *  sample rate. */
  test('refuses more audio than a spoken command, by its seconds', async () => {
    const { AI, asked } = workersAi({
      '@cf/openai/whisper-large-v3-turbo': { text: 'never asked' },
    })
    env.AI = AI

    expect((await heard(wav(11.5))).status).toBe(200)

    const long = await heard(wav(13))
    expect(long.status).toBe(413)
    expect(long.json.error).toContain('spoken command')
    expect(asked).toHaveLength(1)
  })

  test('counts every utterance against the same ceiling, key or no key', async () => {
    const { AI } = workersAi({ '@cf/openai/whisper-large-v3-turbo': { text: 'again' } })
    env.AI = AI
    // Six hundred already said this hour, without six hundred round trips.
    env.db
      .prepare('insert into limits (scope, key, count, until) values (?, ?, ?, ?)')
      .run('said', userId(), 600, Date.now() + 60 * 60 * 1000)

    const over = await heard(wav(1))
    expect(over.status).toBe(429)
    expect(over.json.error).toContain('a lot of listening')
  })

  test('a guest may not listen either', async () => {
    const { AI } = workersAi({ '@cf/openai/whisper-large-v3-turbo': { text: 'never asked' } })
    env.AI = AI
    expect((await heard(wav(1), 'not-a-session')).status).toBe(401)
  })
})

/* ── A guest cannot ask ───────────────────────────────────────────────── */

describe('a guest', () => {
  /** A session a share link handed out, with no account behind it. */
  async function guest(): Promise<string> {
    const space = await firstSpace(token)
    await noteIn(token, space, 'plan.md', '# Plan\n')

    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'read', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''

    const followed = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { device: 'iPhone' },
    })
    return followed.json.token
  }

  /** Not a check in the ask routes: the session guard opens only what
   *  `guestMayReach` names, and everything account-wide is left out of it. A key and
   *  a set of notes are as account-wide as it gets. */
  test('cannot ask, cannot set a key, cannot list models', async () => {
    const as = await guest()
    fakeAsking([said('never asked')])

    expect((await question({ question: 'hi', model: 'gpt-6-astra' }, as)).status).toBe(403)
    expect((await put(KEY, as)).status).toBe(403)
    expect((await call(env, '/v1/ask/models', { token: as })).status).toBe(403)
    expect((await call(env, '/v1/ask/key', { method: 'DELETE', token: as })).status).toBe(403)
    expect((await state(as)).status).toBe(403)
  })
})

/* ── A piece of a recording ──────────────────────────────────────────── */

/** The recorder sends the same WAV the glasses do and asks the same question of the
 *  same models; what differs is the length. A spoken command is a second or two, a
 *  piece of a recording is a minute, and a route that refused the second at twelve
 *  seconds would be a route the recorder could not use at all.
 *
 *  See apps/desktop/src/lib/recorder/transcribe.ts, which is what cuts a recording
 *  into pieces this size, and heard.ts for why the two ceilings are two numbers. */
describe('a piece of a recording', () => {
  /** A WAV header saying 16 kHz mono, `seconds` of it, the way the recorder writes
   *  one; see recorder/wav.ts. The ceiling is measured off these fields. */
  function wav(seconds: number): Uint8Array {
    const rate = 16_000
    const bytes = Math.round(seconds * rate * 2)
    const file = new Uint8Array(44 + bytes)
    const view = new DataView(file.buffer)
    const write = (at: number, text: string) => {
      for (let step = 0; step < text.length; step++) file[at + step] = text.charCodeAt(step)
    }

    write(0, 'RIFF')
    view.setUint32(4, 36 + bytes, true)
    write(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, 'data')
    view.setUint32(40, bytes, true)
    return file
  }

  function piece(body: BodyInit, of = '1') {
    return call(env, `/v1/ask/heard?piece=${of}`, {
      method: 'POST',
      token,
      raw: body,
      headers: { 'content-type': 'audio/wav' },
    })
  }

  test('may be far longer than a spoken command', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'and then we agreed on the fonts' }) }

    const { status, json } = await piece(wav(30))
    expect(status).toBe(200)
    expect(json.said).toBe('and then we agreed on the fonts')
  })

  test('but not longer than one request should hold', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'never asked' }) }

    const over = await piece(wav(130))
    expect(over.status).toBe(413)
    expect(over.json.error).toContain('too long')
  })

  /** Without the flag it is a spoken command again, and the old ceiling stands: one
   *  route, two callers, and neither reaches the other's rules by accident. */
  test('and the glasses keep their own ceiling', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'never asked' }) }

    const over = await piece(wav(30), '0')
    expect(over.status).toBe(413)
    expect(over.json.error).toContain('spoken command')
  })

  /** A transcript in a note says what language it is in; a spoken command has no use
   *  for one and reads the same field as empty. Only the turbo model says. */
  test('comes back with the language the model settled on', async () => {
    env.AI = {
      run: () =>
        Promise.resolve({
          text: 'Guten Morgen',
          transcription_info: { language: 'de', language_probability: 0.99 },
        }),
    }

    const { json } = await piece(wav(20))
    expect(json.said).toBe('Guten Morgen')
    expect(json.language).toBe('de')
  })

  test('and with no language where the model did not name one', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'morning' }) }
    expect((await piece(wav(20))).json.language).toBe('')
  })
})

/** Meeting notes went on 2026-10-03, and the route that summarised one went with them:
 *  nothing is offered that the app no longer asks for. */
test('there is no summary route any more', async () => {
  await put(KEY)
  const gone = await call(env, '/v1/ask/summary', { token, body: { text: 'words', model: 'm' } })
  expect(gone.status).toBe(404)
})
