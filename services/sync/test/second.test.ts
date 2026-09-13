import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import worker from '../src/index'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { sha256 } from '../src/crypto'
import {
  base32,
  codeAt,
  matches,
  newSecret,
  otpauth,
  RECOVERY_ROUNDS,
  recoveryCodes,
  recoveryCost,
  recoveryHash,
} from '../src/second'

/** The nightly job, run to the end: what it hands to `waitUntil` is what it is
 *  doing, so a test that wants the sweep awaits those. */
async function nightly(env: TestEnv): Promise<void> {
  const waiting: Promise<unknown>[] = []
  const context = {
    waitUntil: (work: Promise<unknown>) => waiting.push(work),
    passThroughOnException: () => undefined,
  }

  worker.scheduled({} as ScheduledEvent, env, context as unknown as ExecutionContext)
  await Promise.all(waiting)
}

interface SecondView {
  on?: boolean
  possible?: boolean
  codesLeft?: number
  holding?: string
  secret?: string
  uri?: string
  recovery?: string[]
  second?: boolean
  token?: string
  error?: string
  sessions?: { id: string; name: string; current: boolean; lastUsedAt: number | null }[]
  ended?: number
  ok?: boolean
}

/** The environment secret the factor is kept under. Absent in tests unless a
 *  test says otherwise, which is itself one of the cases. */
const KEPT = { OPENAI_KEY_SECRET: 'a secret for the tests' }

describe('what a recovery code costs to hash', () => {
  /** The cost is the whole of what hashing them buys: ten bytes behind a hundred
   *  thousand rounds is not a table a leaked database hands anybody. Asserted here
   *  because the test build turns the cost down to run, and a default that quietly
   *  became two hundred rounds would be the one change nobody would notice. */
  test('is a hundred thousand rounds, whatever a test asks for', () => {
    expect(RECOVERY_ROUNDS).toBe(100_000)
  })

  /** The cost used to be a module `let` behind an exported setter, which anything in
   *  the bundle could call at any moment - and a deploy carried it whether or not
   *  anything did. Now it is a question about the build, so there is nothing to call. */
  test('and nothing a running Worker can reach says otherwise', async () => {
    const module: Record<string, unknown> = await import('../src/second')

    expect(Object.keys(module)).not.toContain('costRecoveryLess')
    // Nothing exported takes a cost and answers nothing, which is the shape a setter
    // has: what is exported are two constants' worth of answers and the derivation.
    const setters = Object.entries(module).filter(
      ([name, held]) => typeof held === 'function' && /^(?:set|cost)/i.test(name),
    )
    expect(setters).toEqual([])
  })
})

describe('the codes themselves', () => {
  test('are base32 the way RFC 4648 writes it', () => {
    expect(base32(new TextEncoder().encode('f'))).toBe('MY')
    expect(base32(new TextEncoder().encode('fo'))).toBe('MZXQ')
    expect(base32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI')
  })

  test('are the six digits the standard names for a known secret', async () => {
    // RFC 6238's own test vector: the ASCII secret "12345678901234567890", at
    // 59 seconds, is 94287082.
    const secret = [...new TextEncoder().encode('12345678901234567890')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    expect(await codeAt(secret, Math.floor(59 / 30))).toBe('287082')
    expect(await codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804')
    expect(await codeAt(secret, Math.floor(1234567890 / 30))).toBe('005924')
  })

  test('match now and one step either side, and nothing further out', async () => {
    const secret = newSecret()
    const at = 1_700_000_000_000

    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000)), at)).toBe(true)
    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000) - 1), at)).toBe(true)
    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000) + 1), at)).toBe(true)
    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000) + 4), at)).toBe(false)
    expect(await matches(secret, '000000000', at)).toBe(false)
    expect(await matches(secret, '', at)).toBe(false)
  })

  test('are offered to an app as a URI it knows', () => {
    const uri = otpauth(newSecret(), 'a@b.dev')

    expect(uri.startsWith('otpauth://totp/nib%3Aa%40b.dev?secret=')).toBe(true)
    expect(uri).toContain('issuer=nib')
    expect(uri).toContain('digits=6')
  })

  test('and the recovery codes are ten, and all different', () => {
    const codes = recoveryCodes()

    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    // Ten bytes, in groups somebody can read off a screen without losing their
    // place. Five was forty bits, which is a table rather than a secret.
    expect(codes[0]).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/)
  })
})

describe('turning it on', () => {
  let env: TestEnv
  let token: string

  beforeEach(async () => {
    env = testEnv(KEPT)
    token = await signIn(env, 'a@b.dev')
  })

  afterEach(() => env.close())

  test('is off to begin with, and says whether it can be kept', async () => {
    const said = await call<SecondView>(env, '/v1/second', { token })

    expect(said.json.on).toBe(false)
    expect(said.json.possible).toBe(true)
  })

  test('hands out a secret without turning anything on', async () => {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })

    expect(begun.json.secret).toMatch(/^[A-Z2-7]+$/)
    expect(begun.json.holding).toBeTruthy()

    // Nothing is on until a code out of the app proves it was set up, so
    // somebody who closes the pane here is not locked out.
    const said = await call<SecondView>(env, '/v1/second', { token })
    expect(said.json.on).toBe(false)
  })

  test('and turns on once a code proves the app has it', async () => {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const secret = secretOf(env)

    const done = await call<SecondView>(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })

    expect(done.status).toBe(200)
    expect(done.json.recovery).toHaveLength(10)

    const said = await call<SecondView>(env, '/v1/second', { token })
    expect(said.json.on).toBe(true)
    expect(said.json.codesLeft).toBe(10)
  })

  test('refuses a code that is not the app’s', async () => {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const done = await call<SecondView>(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: '000000' },
    })

    expect(done.status).toBe(400)
    expect(done.json.error).toBe('that code is not right')
  })

  test('and offers nothing at all where the service cannot keep a secret', async () => {
    const bare = testEnv()
    const other = await signIn(bare, 'a@b.dev')

    const said = await call<SecondView>(bare, '/v1/second', { token: other })
    expect(said.json.possible).toBe(false)

    const begun = await call<SecondView>(bare, '/v1/second', { token: other, body: {} })
    expect(begun.status).toBe(503)

    bare.close()
  })
})

describe('signing in with it on', () => {
  let env: TestEnv
  let secret: string

  beforeEach(async () => {
    env = testEnv(KEPT)
    const token = await signIn(env, 'a@b.dev')

    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    secret = secretOf(env)
    await call(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })
  })

  afterEach(() => env.close())

  test('the emailed code is half of it', async () => {
    const half = await signInHalfWay(env)

    expect(half.json.second).toBe(true)
    expect(half.json.token).toBeUndefined()
    expect(half.json.holding).toBeTruthy()
  })

  test('and the second code finishes it', async () => {
    const half = await signInHalfWay(env)

    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step()) },
    })

    expect(done.status).toBe(200)
    expect(done.json.token).toBeTruthy()

    const me = await call<SecondView>(env, '/v1/sessions', { token: done.json.token ?? '' })
    expect(me.status).toBe(200)
  })

  test('a recovery code finishes it too, and is spent', async () => {
    // Fresh codes, so the test has one it knows. The next step's code rather
    // than this one's: signing in above spent the code it used, and the app
    // would be showing the next one by the time somebody pressed the button.
    const token = await signInWith(env, secret)
    const made = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    const code = made.json.recovery?.[0] ?? ''

    const half = await signInHalfWay(env)
    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code },
    })
    expect(done.json.token).toBeTruthy()

    // The same code again is nothing.
    const again = await signInHalfWay(env)
    const refused = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: again.json.holding, code },
    })
    expect(refused.status).toBe(400)
  })

  test('and a wrong second code is refused', async () => {
    const half = await signInHalfWay(env)
    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: '000000' },
    })

    expect(done.status).toBe(400)
    expect(done.json.error).toBe('that code is not right')
  })

  test('a half-finished sign-in cannot be finished twice', async () => {
    const half = await signInHalfWay(env)
    const code = await codeAt(secret, step())

    await call(env, '/v1/auth/second', { body: { holding: half.json.holding, code } })
    const again = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code },
    })

    expect(again.status).toBe(400)
  })

  test('and a code the app has already answered with is spent', async () => {
    // RFC 6238 §5.2: a code that has been accepted must not be accepted again.
    // Without that, a code read over somebody's shoulder or out of a phishing
    // page is a second sign-in for the ninety seconds it stays in the window.
    const code = await codeAt(secret, step())

    const first = await signInHalfWay(env)
    const got = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: first.json.holding, code },
    })
    expect(got.json.token).toBeTruthy()

    const second = await signInHalfWay(env)
    const again = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: second.json.holding, code },
    })

    expect(again.status).toBe(400)
  })

  test('but a wrong code does not throw the whole sign-in away', async () => {
    // The emailed half was answered; mistyping the second half is not a reason
    // to ask for another mail. The token is spent by a code that works.
    const half = await signInHalfWay(env)

    const wrong = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: '000000' },
    })
    expect(wrong.status).toBe(400)

    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step()) },
    })

    expect(done.status).toBe(200)
    expect(done.json.token).toBeTruthy()
  })

  test('and the list a route wrote was hashed at the cost this build hashes at', async () => {
    const token = await signInWith(env, secret)
    const made = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    // As it was handed over, dashes and all: that is the string that was hashed.
    const code = made.json.recovery?.[0] ?? ''

    const user = env.db.prepare("select id from users where email = 'a@b.dev'").get() as {
      id: string
    }
    const held = (
      env.db.prepare('select code_hash from recovery_codes').all() as { code_hash: string }[]
    ).map((one) => one.code_hash)

    // The cost is part of what the row says, and the row says what this build hashes
    // at - so a cost nothing can change at runtime is a cost the rows are proof of.
    expect(held).toContain(await recoveryHash(user.id, code, recoveryCost()))
    expect(held).not.toContain(await recoveryHash(user.id, code, recoveryCost() + 1))
  })

  test('and a recovery code is not a bare digest of five bytes at rest', async () => {
    // Forty bits under one round of SHA-256 is a table a GPU builds in minutes,
    // so a leaked database would be a way past the factor for every account at
    // once. The entropy is the fix; the derivation is what stops one table
    // serving every account.
    const token = await signInWith(env, secret)
    const made = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })

    const code = made.json.recovery?.[0] ?? ''
    expect(code.replace(/\W/g, '')).toHaveLength(20)

    const held = env.db.prepare('select code_hash from recovery_codes').all() as {
      code_hash: string
    }[]

    expect(held.map((one) => one.code_hash)).not.toContain(await sha256(code))
  })

  test('and turning it off takes a code', async () => {
    const token = await signInWith(env, secret)

    const refused = await call<SecondView>(env, '/v1/second', {
      method: 'DELETE',
      token,
      body: { code: '000000' },
    })
    expect(refused.status).toBe(400)

    const off = await call<SecondView>(env, '/v1/second', {
      method: 'DELETE',
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    expect(off.status).toBe(200)

    const said = await call<SecondView>(env, '/v1/second', { token })
    expect(said.json.on).toBe(false)
  })
})

describe('how many codes may be tried', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv(KEPT)
  })

  afterEach(() => env.close())

  /** Somebody with the factor on, and the secret their app would be showing. */
  async function enrolled(email: string): Promise<{ token: string; secret: string }> {
    const token = await signIn(env, email)
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const secret = secretOf(env)

    await call(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })

    return { token, secret }
  }

  /** One code tried against one account, from a machine. */
  function tryOne(token: string, code: string, machine: string) {
    return call<SecondView>(env, '/v1/second/recovery', {
      method: 'POST',
      token,
      body: { code },
      headers: { 'cf-connecting-ip': machine },
    })
  }

  test('stops at a number of tries for one account', async () => {
    const { token } = await enrolled('a@b.dev')

    for (let at = 0; at < 20; at++) await tryOne(token, '000000', '203.0.113.7')

    // Twenty wrong ones in, and the ceiling is what answers rather than the
    // factor: the right code is refused too.
    const refused = await tryOne(token, '000000', '203.0.113.7')
    expect(refused.status).toBe(400)
  })

  test('and at a number of tries from one machine, whoever they are about', async () => {
    // The per-account ceiling does nothing about a script with a list of
    // accounts: twenty each is as many guesses as it likes, from one machine, so
    // long as it keeps moving on to the next address.
    const mine = await enrolled('a@b.dev')

    for (const email of ['c@d.dev', 'e@f.dev', 'g@h.dev']) {
      const { token } = await enrolled(email)
      for (let at = 0; at < 20; at++) await tryOne(token, '000000', '203.0.113.9')
    }

    // This account has spent none of its own twenty and the code is its app's.
    const refused = await tryOne(mine.token, await codeAt(mine.secret, step() + 1), '203.0.113.9')
    expect(refused.status).toBe(400)

    // And from anywhere else the same code still works, so it is the machine
    // that ran out and not the account.
    const fine = await tryOne(mine.token, await codeAt(mine.secret, step() + 1), '203.0.113.10')
    expect(fine.status).toBe(200)
  })
})

describe('what an abandoned enrolment leaves behind', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv(KEPT)
  })

  afterEach(() => env.close())

  test('is swept by the nightly job, secret and all', async () => {
    // The secret a pending enrolment holds is the one thing here kept in the
    // clear, because until a code proves the app has it there is nothing to
    // encrypt it against. Ten minutes is what the row promises; nothing was
    // taking it away, so an enrolment somebody closed the pane on left a working
    // secret in the table for good.
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/second', { token, body: {} })

    expect(secretOf(env)).toMatch(/^[0-9a-f]{40}$/)

    env.db.exec("update cached set until = 0 where scope = 'second-pending'")
    await nightly(env)

    expect(secretOf(env)).toBe('')
  })
})

describe('the sessions a reader can see', () => {
  let env: TestEnv
  let token: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')
  })

  afterEach(() => env.close())

  test('name the device that opened them, and say which is this one', async () => {
    const listed = await call<SecondView>(env, '/v1/sessions', { token })

    expect(listed.json.sessions).toHaveLength(1)
    expect(listed.json.sessions?.[0]?.current).toBe(true)
  })

  test('and one of them can be ended', async () => {
    const other = await signIn(env, 'a@b.dev')
    const listed = await call<SecondView>(env, '/v1/sessions', { token })
    const theirs = listed.json.sessions?.find((one) => !one.current)

    const gone = await call<SecondView>(env, `/v1/sessions/${theirs?.id ?? ''}`, {
      method: 'DELETE',
      token,
    })

    expect(gone.json.ok).toBe(true)

    const after = await call<SecondView>(env, '/v1/sessions', { token: other })
    expect(after.status).toBe(401)
  })

  test('or every one but this', async () => {
    await signIn(env, 'a@b.dev')
    await signIn(env, 'a@b.dev')

    const ended = await call<SecondView>(env, '/v1/sessions', { method: 'DELETE', token })
    expect(ended.json.ended).toBe(2)

    const mine = await call<SecondView>(env, '/v1/sessions', { token })
    expect(mine.json.sessions).toHaveLength(1)
  })

  test('and somebody else’s session is not theirs to end', async () => {
    const other = await signIn(env, 'c@d.dev')
    const listed = await call<SecondView>(env, '/v1/sessions', { token })
    const mine = listed.json.sessions?.[0]?.id ?? ''

    const gone = await call<SecondView>(env, `/v1/sessions/${mine}`, {
      method: 'DELETE',
      token: other,
    })

    expect(gone.json.ok).toBe(false)

    const still = await call<SecondView>(env, '/v1/sessions', { token })
    expect(still.status).toBe(200)
  })
})

/** The secret the pending enrolment holds, read out of the table the way only a
 *  test may: the route hands back base32 and the check wants hex. */
function secretOf(env: TestEnv): string {
  const row = env.db
    .prepare("select value from cached where scope = 'second-pending' order by until desc limit 1")
    .get() as { value: string } | undefined

  return (row?.value ?? '').split(':')[1] ?? ''
}

function step(): number {
  return Math.floor(Date.now() / 30_000)
}

/** The emailed half of a sign-in for an account that asks for two.
 *
 *  The pending row goes first: a second code asked for within thirty seconds is
 *  answered without a mail being sent, which is the resend gap doing its job and
 *  not what any of these tests are about. */
async function signInHalfWay(env: TestEnv) {
  const { mail } = await import('./harness')
  env.db.exec('delete from login_codes')

  // The mail is captured whole, so the six digits come out of it the way the
  // harness's own sign-in reads them.
  const logged = await mail(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))
  const said = /(\d{3}) (\d{3})/.exec(logged)

  return await call<SecondView>(env, '/v1/auth/verify', {
    body: { email: 'a@b.dev', code: `${said?.[1] ?? ''}${said?.[2] ?? ''}` },
  })
}

/** A whole sign-in, both halves, for a test that needs a session. */
async function signInWith(env: TestEnv, secret: string): Promise<string> {
  const half = await signInHalfWay(env)
  const done = await call<SecondView>(env, '/v1/auth/second', {
    body: { holding: half.json.holding, code: await codeAt(secret, step()) },
  })

  return done.json.token ?? ''
}
