import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EmailSender } from '../src/types'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.restoreAllMocks()
})

/** Reads the code out of the logging mailer. */
async function requestCode(email: string): Promise<string> {
  const logged: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logged.push(String(message))
  })

  await call(env, '/v1/auth/code', { body: { email } })
  spy.mockRestore()

  const match = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!match) throw new Error('no code sent')
  return `${match[1]}${match[2]}`
}

describe('requesting a code', () => {
  test('accepts a valid address', async () => {
    const response = await call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } })
    expect(response.status).toBe(200)
    expect(response.json.ok).toBe(true)
  })

  test('rejects a malformed address', async () => {
    const response = await call(env, '/v1/auth/code', { body: { email: 'not-an-email' } })
    expect(response.status).toBe(400)
  })

  test('does not reveal whether the account exists', async () => {
    const fresh = await call(env, '/v1/auth/code', { body: { email: 'new@b.dev' } })
    await signIn(env, 'known@b.dev')
    const known = await call(env, '/v1/auth/code', { body: { email: 'known@b.dev' } })

    expect(known.status).toBe(fresh.status)
    expect(Object.keys(known.json)).toEqual(Object.keys(fresh.json))
  })

  test('will not send a second code straight away', async () => {
    await call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } })
    const again = await call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } })

    expect(again.status).toBe(200)
    expect(again.json.resendIn).toBeGreaterThan(0)
  })

  /** The table is one anybody can write a row to, and a code that ran out says
   *  nothing any more. Cleared as new ones arrive, the way sessions are: nothing
   *  else would ever take them away. */
  test('clears the codes that ran out as new ones are made', async () => {
    await call(env, '/v1/auth/code', { body: { email: 'gone@b.dev' } })
    env.db.prepare('update login_codes set expires_at = 1').run()

    await call(env, '/v1/auth/code', { body: { email: 'live@b.dev' } })

    const held = env.db.prepare('select email from login_codes').all() as { email: string }[]
    expect(held.map((one) => one.email)).toEqual(['live@b.dev'])
  })
})

/** The message not going out.
 *
 *  This is the bug the live service had: the send was the one call in a sign-in
 *  that leaves the building, it was awaited with nothing around it, and every
 *  provider refusal came back as a bare 500. Five of the six failures the zone
 *  recorded over three days were this route. See src/failed.ts.
 *
 *  Worse than the status, and the reason a second press did not help: the thirty
 *  second gap had already been written, so the next try answered `ok` with a
 *  `resendIn` and sent nothing at all. */
describe('a provider that will not take the message', () => {
  /** The environment again, with a sender that fails. `send` is handed the
   *  message, so a test can read the code out of one that never went. */
  function refusing(send: EmailSender['send']): void {
    env.close()
    env = testEnv({ MAIL_FROM: 'Nib <nib@nibeditor.com>', EMAIL: { send } })
  }

  /** Runs `work` with the log held, because a failed send writes one line to it. */
  async function quietly<T>(work: () => Promise<T>): Promise<T> {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      return await work()
    } finally {
      spy.mockRestore()
    }
  }

  test('is answered with a sentence and a status that means try again', async () => {
    refusing(() => Promise.reject(new Error('the sender is not answering')))

    const response = await quietly(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))

    expect(response.status).toBe(503)
    expect(response.json.error).toBe('could not send the mail - try again')
    expect(response.headers.get('retry-after')).toBe('5')
  })

  /** A send can fail after the message went: what was lost is the answer, not
   *  the mail. So the code stays good, because somebody holding one that no
   *  longer works is worse off than somebody who had to ask twice. */
  test('keeps the code it issued, so a message that did go still signs them in', async () => {
    let carried = ''
    refusing((message) => {
      carried = String(message.text)
      return Promise.reject(new Error('the answer was lost'))
    })

    await quietly(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))

    const found = /(\d{3}) (\d{3})/.exec(carried)
    expect(found).not.toBeNull()

    const verified = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: `${found?.[1]}${found?.[2]}` },
    })
    expect(verified.status).toBe(200)
  })

  test('gives up the gap, so the next press actually writes to the address', async () => {
    let asked = 0
    refusing(() => {
      asked++
      return Promise.reject(new Error('the sender is not answering'))
    })

    await quietly(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))
    const again = await quietly(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))

    // Without the gap being given up this is 200 with a `resendIn`, the provider
    // is never asked a second time, and nothing ever arrives.
    expect(asked).toBe(2)
    expect(again.status).toBe(503)
  })

  test('leaves no gap behind for an address that heard nothing', async () => {
    refusing(() => Promise.reject(new Error('the sender is not answering')))
    await quietly(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))

    const gap = env.db.prepare('select sent_at from login_codes where email = ?').get('a@b.dev')
    expect(gap).toEqual({ sent_at: 0 })
  })
})

describe('verifying a code', () => {
  test('creates the account on first use', async () => {
    const code = await requestCode('new@b.dev')
    const response = await call(env, '/v1/auth/verify', { body: { email: 'new@b.dev', code } })

    expect(response.status).toBe(200)
    expect(response.json.user.email).toBe('new@b.dev')
    expect(response.json.token).toMatch(/^[0-9a-f]{64}$/)
  })

  test('signs the same person back in later', async () => {
    const first = await signIn(env, 'a@b.dev')
    const second = await signIn(env, 'a@b.dev')

    expect(first).not.toBe(second)

    const me = await call(env, '/v1/me', { token: second })
    expect(me.json.user.email).toBe('a@b.dev')
  })

  test('rejects the wrong code', async () => {
    await requestCode('a@b.dev')
    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: '000000' },
    })

    expect(response.status).toBe(400)
  })

  test('locks out after five wrong tries', async () => {
    await requestCode('a@b.dev')

    for (let attempt = 0; attempt < 5; attempt++) {
      await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code: '000000' } })
    }

    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: '000000' },
    })
    expect(response.status).toBe(429)
  })

  test('stops at a number of tries for one address, however many codes it was sent', async () => {
    // Five wrong tries spend a code, and a new code used to start the count again:
    // one every thirty seconds, from as many machines as a script has, was six
    // hundred guesses an hour at one account. See `mayTryCode`.
    for (let code = 0; code < 3; code++) {
      env.db.exec('delete from login_codes')
      await requestCode('a@b.dev')
      for (let attempt = 0; attempt < 5; attempt++) {
        const wrong = await call(env, '/v1/auth/verify', {
          body: { email: 'a@b.dev', code: '000000' },
          headers: { 'cf-connecting-ip': `203.0.113.${code}` },
        })
        expect(wrong.status).toBe(400)
      }
    }

    env.db.exec('delete from login_codes')
    const right = await requestCode('a@b.dev')
    const refused = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: right },
    })
    expect(refused.status).toBe(429)

    // Another address is its own count.
    expect(await signIn(env, 'c@d.dev')).toBeTruthy()
  })

  test('a used code cannot be replayed', async () => {
    const code = await requestCode('a@b.dev')
    await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code } })

    const replay = await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code } })
    expect(replay.status).toBe(400)
  })

  test('treats the address case-insensitively', async () => {
    const code = await requestCode('Mixed@B.dev')
    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'mixed@b.dev', code },
    })

    expect(response.status).toBe(200)
    expect(response.json.user.email).toBe('mixed@b.dev')
  })
})

/** Two devices signing in together with an address nobody has used yet.
 *
 *  Both read `select ... where email = ?` and both found nothing, so both went on
 *  to insert - and the second one was `UNIQUE constraint failed: users.email`
 *  coming back as a 500 on somebody's very first sign-in. The address is the
 *  account, so the second insert is not a mistake to report: it is the account,
 *  already made. */
describe('two sign-ins arriving together', () => {
  /** The other device's row, landing between this one's read and its write. */
  function theOtherDeviceGetsThereFirst(email: string): void {
    env.justBefore(/insert into users/, () => {
      env.db
        .prepare('insert into users (id, email, created_at) values (?, ?, ?)')
        .run('the-other-one', email, Date.now())
    })
  }

  test('make one account rather than a unique constraint failure', async () => {
    const code = await requestCode('both@b.dev')
    theOtherDeviceGetsThereFirst('both@b.dev')

    const response = await call(env, '/v1/auth/verify', { body: { email: 'both@b.dev', code } })

    expect(response.status).toBe(200)
    // The account to carry on with is the row in the table, not the id this
    // request made and could not write.
    expect(response.json.user.id).toBe('the-other-one')

    const many = env.db.prepare('select count(*) as many from users').get() as { many: number }
    expect(many.many).toBe(1)
  })

  /** Only the sign-in whose insert wrote the row seeds, because the guard inside
   *  `makeFirstSpace` reads a space the other request has not written yet and so
   *  is not something either of them can be held to. */
  test('do not give that one account two spaces called Notes', async () => {
    const code = await requestCode('both@b.dev')
    theOtherDeviceGetsThereFirst('both@b.dev')

    await call(env, '/v1/auth/verify', { body: { email: 'both@b.dev', code } })

    const spaces = env.db
      .prepare("select count(*) as many from spaces where name = 'Notes'")
      .get() as { many: number }
    expect(spaces.many).toBe(0)
  })
})

/** A client sends what it likes. None of it may reach a `.trim()` or a query
 *  and come back as a 500: the answer is 400 and a sentence saying what. */
describe('a body that is not what it should be', () => {
  const JSON_TYPE = { 'content-type': 'application/json' }

  test('is refused where an address was expected', async () => {
    expect((await call(env, '/v1/auth/code', { body: { email: 12 } })).status).toBe(400)
    expect((await call(env, '/v1/auth/code', { body: { email: { at: 'b.dev' } } })).status).toBe(
      400,
    )
    expect((await call(env, '/v1/auth/code', { body: [] })).status).toBe(400)
    expect((await call(env, '/v1/auth/code', { body: null })).status).toBe(400)
  })

  test('is refused when it is not JSON at all', async () => {
    const response = await call(env, '/v1/auth/code', { raw: 'not json', headers: JSON_TYPE })

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('send a JSON object')
  })

  test('is refused where a code was expected', async () => {
    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: 123456 },
    })

    expect(response.status).toBe(400)
    expect(response.json.error).toContain('must be text')
  })

  test('is refused where a name was expected', async () => {
    const token = await signIn(env, 'a@b.dev')

    expect((await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 5 } })).status).toBe(
      400,
    )
    expect(
      (await call(env, '/v1/me', { method: 'PATCH', token, raw: '{', headers: JSON_TYPE })).status,
    ).toBe(400)
  })
})

describe('sessions', () => {
  test('a token opens the account', async () => {
    const token = await signIn(env, 'a@b.dev')
    const me = await call(env, '/v1/me', { token })

    expect(me.status).toBe(200)
    expect(me.json.user.email).toBe('a@b.dev')
  })

  test('no token is refused', async () => {
    expect((await call(env, '/v1/me')).status).toBe(401)
  })

  test('a made-up token is refused', async () => {
    expect((await call(env, '/v1/me', { token: 'f'.repeat(64) })).status).toBe(401)
  })

  test('signing out ends the session', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/auth/signout', { method: 'POST', token })

    expect((await call(env, '/v1/me', { token })).status).toBe(401)
  })

  /** The scheme is a word, not a spelling: RFC 7235 says it is matched without
   *  regard to case, and a client that wrote it in lower case was holding a
   *  perfectly good session and being told to sign in again. */
  test('the scheme is read whatever its case', async () => {
    const token = await signIn(env, 'a@b.dev')

    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      const me = await call(env, '/v1/me', { headers: { authorization: `${scheme} ${token}` } })
      expect(me.status, scheme).toBe(200)
    }
  })

  test('a header that names no scheme is not a token', async () => {
    const token = await signIn(env, 'a@b.dev')

    for (const header of [token, `Basic ${token}`, 'Bearer', 'Bearer ']) {
      expect((await call(env, '/v1/me', { headers: { authorization: header } })).status).toBe(401)
    }
  })

  test('signing out reads the scheme the same way', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/auth/signout', {
      method: 'POST',
      headers: { authorization: `bearer ${token}` },
    })

    expect((await call(env, '/v1/me', { token })).status).toBe(401)
  })
})

/** The API is reached by the desktop app and by the web build on the app's own
 *  origin, and by nothing else. A token is not a cookie, so this is a second
 *  line rather than the only one - but it is the line the browser enforces. */
describe('who may call the API from a browser', () => {
  test('the app itself may', async () => {
    for (const origin of [
      'https://nibeditor.com',
      'http://localhost:1420',
      'tauri://localhost',
      'http://127.0.0.1:5173',
    ]) {
      const response = await call(env, '/v1/me', { headers: { origin } })
      expect(response.headers.get('access-control-allow-origin'), origin).toBe(origin)
    }
  })

  test('a page on someone else’s site may not', async () => {
    for (const origin of [
      'https://evil.example',
      'https://nibeditor.com.evil.example',
      'http://localhost.evil.example',
      'https://www.nibeditor.com',
    ]) {
      const response = await call(env, '/v1/me', { headers: { origin } })
      expect(response.headers.get('access-control-allow-origin'), origin).toBeNull()
    }
  })
})

describe('a display name', () => {
  test('starts empty', async () => {
    const token = await signIn(env, 'a@b.dev')
    const me = await call(env, '/v1/me', { token })
    expect(me.json.user.name).toBeNull()
  })

  test('can be set, and comes back with the account', async () => {
    const token = await signIn(env, 'a@b.dev')
    const set = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: '  Ada   Lovelace ' },
    })

    expect(set.status).toBe(200)
    expect(set.json.user.name).toBe('Ada Lovelace')
    expect((await call(env, '/v1/me', { token })).json.user.name).toBe('Ada Lovelace')
  })

  test('comes back on the next sign-in as well', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })

    const code = await requestCode('a@b.dev')
    const again = await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code } })
    expect(again.json.user.name).toBe('Ada')
  })

  test('an empty name clears it', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    const cleared = await call(env, '/v1/me', { method: 'PATCH', token, body: { name: '   ' } })

    expect(cleared.json.user.name).toBeNull()
  })

  test('control characters are dropped from a name', async () => {
    const token = await signIn(env, 'a@b.dev')
    const set = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: 'Ada\u0000 Love\u001blace\u007f' },
    })

    expect(set.status).toBe(200)
    expect(set.json.user.name).toBe('Ada Lovelace')
  })

  test('a name of nothing but control characters clears it', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    const cleared = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: '\u0001\u0002' },
    })

    expect(cleared.json.user.name).toBeNull()
  })

  test('a name longer than sixty characters is refused', async () => {
    const token = await signIn(env, 'a@b.dev')
    const response = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: 'x'.repeat(61) },
    })

    expect(response.status).toBe(400)
  })

  test('needs a session', async () => {
    const response = await call(env, '/v1/me', { method: 'PATCH', body: { name: 'Ada' } })
    expect(response.status).toBe(401)
  })
})
